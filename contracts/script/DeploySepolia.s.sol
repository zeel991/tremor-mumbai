// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {VarianceMarket} from "../src/VarianceMarket.sol";
import {TremorAquaSwapVMRouter} from "../src/aqua/TremorAquaSwapVMRouter.sol";
import {TremorVault} from "../src/aqua/TremorVault.sol";
import {TremorHook} from "../src/hook/TremorHook.sol";
import {TremorReceiver} from "../src/hook/TremorReceiver.sol";
import {PoolOperator} from "../src/helpers/PoolOperator.sol";
import {TestToken} from "../src/testnet/TestToken.sol";
import {FixedPriceFeed} from "../src/testnet/FixedPriceFeed.sol";

interface IWETH9 {
    function deposit() external payable;
}

/// @notice Deploy Tremor to Sepolia and write deployments/sepolia.json.
///
/// Differences from the mainnet-fork deployment (see docs/spec.md §17):
///   - Settlement feed: Chainlink ETH/USD on Sepolia (there is no UNI/ETH feed on Sepolia).
///   - Pool token: a test UNI (tUNI); the hook's UNI->WETH conversion guard reads a test price feed set to the
///     mainnet UNI/ETH price at deploy time.
///   - Smaller sizes: S = 0.001 WETH per LONG+SHORT pair; LAMBDA and KAPPA (absolute WETH units) scaled by the
///     same factor, so prices and spreads match the fork deployment in relative terms.
///   - The receiver's epoch origin is set so the first measurement epoch closes EPOCH_OFFSET after deploy,
///     letting a CRE report set the hook fee during testing instead of a week later.
///   - Only a live window: historical replay windows need mainnet price history.
///
/// Env: UNI_ETH_PRICE (WAD, WETH per UNI, required), LIQ_WETH (default 0.02 ether),
///      SETS (default 50e18), EPOCH_OFFSET (default 2 hours).
/// forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast --slow --private-key $DEPLOYER_PK
contract DeploySepolia is Script {
    using PoolIdLibrary for PoolKey;

    // Sepolia (each checked to have code: Aqua is byte-identical to mainnet)
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address internal constant CRE_MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint160 internal constant HOOK_FLAGS = 0x44; // afterSwap | afterSwapReturnDelta

    uint256 internal constant S = 1e15; // 0.001 WETH per LONG+SHORT pair
    uint256 internal constant SCALE = 1e3; // fork S (1e18) / S
    uint256 internal constant V_CAP = 2.25e18; // 150% vol
    uint256 internal constant V_FWD = 0.33e18; // ~57% vol
    uint256 internal constant BUYBACK = 5e15;

    struct Out {
        TestToken tuni;
        FixedPriceFeed uniFeed;
        VarianceMarket market;
        TremorAquaSwapVMRouter router;
        TremorVault vault;
        TremorHook hook;
        TremorReceiver receiver;
        PoolOperator operator;
        PoolKey key;
        uint256 live;
        uint256 epochOrigin;
        uint256 deployBlock;
    }

    function run() external {
        require(block.chainid == 11_155_111, "not Sepolia");
        uint256 price = vm.envUint("UNI_ETH_PRICE");
        uint256 liqWeth = vm.envOr("LIQ_WETH", uint256(0.02 ether));
        uint256 sets = vm.envOr("SETS", uint256(50e18));
        uint256 offset = vm.envOr("EPOCH_OFFSET", uint256(2 hours));
        address owner = msg.sender;

        Out memory o;
        o.deployBlock = block.number;
        uint256 collateral = (sets * S) / 1e18 + BUYBACK;

        vm.startBroadcast();
        IWETH9(WETH).deposit{value: liqWeth + collateral}();

        o.tuni = new TestToken("Tremor Test UNI", "tUNI", owner);
        require(address(o.tuni) < WETH, "tUNI must sort below WETH (currency0 = UNI)");
        o.uniFeed = new FixedPriceFeed("tUNI / WETH (test, set from mainnet UNI/ETH)", int256(price), owner);

        o.market = new VarianceMarket(WETH, ETH_USD_FEED, false, 0.05e18, 0.01e18, 2e15 / SCALE, 1e15 / SCALE, 1 hours);
        o.router = new TremorAquaSwapVMRouter(AQUA, WETH, owner, "Tremor SwapVM", "1");
        o.vault = new TremorVault(owner, AQUA, address(o.router), address(o.market));
        o.hook = _deployHook(address(o.market), address(o.uniFeed), owner);
        o.epochOrigin = block.timestamp + offset - 7 days;
        o.receiver = new TremorReceiver(CRE_MOCK_FORWARDER, address(o.hook), address(o.market), o.epochOrigin, 0.5e18, 1 days);
        o.operator = new PoolOperator(IPoolManager(POOL_MANAGER));
        o.key = PoolKey({
            currency0: Currency.wrap(address(o.tuni)),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(o.hook))
        });

        // pool at the test feed price, full-range liquidity worth liqWeth on the WETH side
        uint256 sqrtPWad = FPM.sqrt(price * 1e18); // sqrt(WETH per UNI) * 1e18
        IPoolManager(POOL_MANAGER).initialize(o.key, uint160(FPM.mulDiv(sqrtPWad, uint256(1) << 96, 1e18)));
        o.hook.setPoolKey(o.key);
        o.hook.setReceiver(address(o.receiver));
        uint256 liquidity = FPM.mulDiv(liqWeth, 1e18, sqrtPWad);
        o.tuni.mint(owner, FPM.mulDiv(liquidity, 1e18, sqrtPWad) * 2 + 1_000_000e18);
        IERC20(address(o.tuni)).approve(address(o.operator), type(uint256).max);
        IERC20(WETH).approve(address(o.operator), type(uint256).max);
        o.operator.addLiquidity(o.key, -887_220, 887_220, int256(liquidity));

        // the live window: now -> now + 7 days, written into one Aqua strategy
        // starts 10 minutes after the script runs: on a live chain later transactions mine in later blocks, and a
        // start in the past is rejected (PastWindow). Quotes before t0 use zero elapsed time.
        uint64 t0 = uint64(block.timestamp + 10 minutes);
        o.live = o.market.createWindow(t0, t0 + 7 days, S, V_CAP, V_FWD);
        IERC20(WETH).transfer(address(o.vault), collateral);
        o.vault.openWindow(o.live, sets, BUYBACK, t0 + 7 days, keccak256("tremor-sepolia-live"));
        o.hook.setCover(address(o.vault), address(o.router), o.live);
        o.receiver.setCoverWindow(o.live);
        o.receiver.setStartBlock(uint64(block.number));
        vm.stopBroadcast();

        _write(o);
    }

    function _deployHook(address market, address uniFeed, address owner_) internal returns (TremorHook hook) {
        bytes memory args = abi.encode(IPoolManager(POOL_MANAGER), market, uniFeed, owner_);
        bytes32 initHash = keccak256(abi.encodePacked(type(TremorHook).creationCode, args));
        bytes32 salt;
        address predicted;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initHash)))));
            if (uint160(predicted) & 0x3FFF == HOOK_FLAGS && predicted.code.length == 0) break;
        }
        hook = new TremorHook{salt: salt}(IPoolManager(POOL_MANAGER), market, uniFeed, owner_);
        require(address(hook) == predicted, "hook address mismatch");
        console2.log("hook mined with salt", uint256(salt), "at", address(hook));
    }

    function _write(Out memory o) internal {
        string memory j = "sepolia";
        vm.serializeString(j, "network", "sepolia");
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeString(j, "rpc", "https://ethereum-sepolia-rpc.publicnode.com");
        vm.serializeString(j, "explorer", "https://sepolia.etherscan.io");
        vm.serializeUint(j, "forkBlock", o.deployBlock);
        vm.serializeAddress(j, "weth", WETH);
        vm.serializeAddress(j, "uni", address(o.tuni));
        vm.serializeAddress(j, "aqua", AQUA);
        vm.serializeAddress(j, "poolManager", POOL_MANAGER);
        vm.serializeAddress(j, "uniEthFeed", address(o.uniFeed));
        vm.serializeAddress(j, "settlementFeed", ETH_USD_FEED);
        vm.serializeAddress(j, "multicall3", MULTICALL3);
        vm.serializeAddress(j, "creForwarder", CRE_MOCK_FORWARDER);
        vm.serializeAddress(j, "market", address(o.market));
        vm.serializeAddress(j, "router", address(o.router));
        vm.serializeAddress(j, "vault", address(o.vault));
        vm.serializeAddress(j, "hook", address(o.hook));
        vm.serializeAddress(j, "receiver", address(o.receiver));
        vm.serializeAddress(j, "poolOperator", address(o.operator));
        vm.serializeBytes32(j, "poolId", PoolId.unwrap(o.key.toId()));
        vm.serializeUint(j, "epochOrigin", o.epochOrigin);

        string memory k = "poolKey";
        vm.serializeAddress(k, "currency0", Currency.unwrap(o.key.currency0));
        vm.serializeAddress(k, "currency1", Currency.unwrap(o.key.currency1));
        vm.serializeUint(k, "fee", o.key.fee);
        vm.serializeInt(k, "tickSpacing", o.key.tickSpacing);
        string memory keyJson = vm.serializeAddress(k, "hooks", address(o.key.hooks));
        vm.serializeString(j, "poolKey", keyJson);

        string memory w = "windows";
        string memory winJson = vm.serializeUint(w, "live", o.live);
        string memory out = vm.serializeString(j, "windows", winJson);

        vm.writeJson(out, "./deployments/sepolia.json");
        console2.log("wrote deployments/sepolia.json");
    }
}
