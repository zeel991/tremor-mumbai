// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {TremorSystem, IWETH9} from "./TremorSystem.sol";
import {TremorHook} from "../src/hook/TremorHook.sol";

/// @notice Deploy the whole system to a local anvil mainnet fork and write deployments/fork.json (spec §10 F1).
///         Prerequisite: the broadcaster holds >= 150,000 UNI (demo/setup-fork.sh funds it from the Uniswap timelock).
///         forge script script/DeployFork.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>
contract DeployFork is Script, TremorSystem {
    using PoolIdLibrary for PoolKey;

    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 internal constant SETS = 50e18;
    uint256 internal constant BUYBACK = 5e18;

    address internal owner;

    function _deployHook(address market, address owner_) internal override returns (TremorHook hook) {
        bytes memory args = abi.encode(IPoolManager(POOL_MANAGER), market, UNI_ETH_FEED, owner_, PENALTY_BLOCKS);
        bytes32 initHash = keccak256(abi.encodePacked(type(TremorHook).creationCode, args));
        bytes32 salt;
        address predicted;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initHash))))
            );
            if (uint160(predicted) & 0x3FFF == HOOK_FLAGS && predicted.code.length == 0) break;
        }
        hook = new TremorHook{salt: salt}(IPoolManager(POOL_MANAGER), market, UNI_ETH_FEED, owner_, PENALTY_BLOCKS);
        require(address(hook) == predicted, "hook address mismatch");
        console2.log("hook mined with salt", uint256(salt), "at", address(hook));
    }

    function run() external {
        owner = msg.sender;
        vm.startBroadcast();
        IWETH9(WETH).deposit{value: 400 ether}();
        Sys memory s = _deployCore(owner);
        _createWindows(s);
        _initPool(s);
        _seedLiquidity(s, 1e21);
        IERC20(WETH).approve(address(s.vault), 3 * (SETS + BUYBACK));
        s.vault.deposit(3 * (SETS + BUYBACK), owner); // the writer's capital, as vault shares
        _openWindows(s, SETS, BUYBACK);
        vm.stopBroadcast();

        _write(s);
    }

    function _write(Sys memory s) internal {
        string memory j = "fork";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeString(j, "rpc", "http://127.0.0.1:8545");
        vm.serializeUint(j, "forkBlock", block.number);
        vm.serializeAddress(j, "weth", WETH);
        vm.serializeAddress(j, "uni", UNI);
        vm.serializeAddress(j, "aqua", AQUA);
        vm.serializeAddress(j, "poolManager", POOL_MANAGER);
        vm.serializeAddress(j, "uniEthFeed", UNI_ETH_FEED);
        vm.serializeAddress(j, "multicall3", MULTICALL3);
        vm.serializeAddress(j, "refV3Pool", REF_V3_POOL);
        vm.serializeAddress(j, "creForwarder", CRE_MOCK_FORWARDER);
        vm.serializeAddress(j, "market", address(s.market));
        vm.serializeAddress(j, "router", address(s.router));
        vm.serializeAddress(j, "vault", address(s.vault));
        vm.serializeAddress(j, "hook", address(s.hook));
        vm.serializeAddress(j, "receiver", address(s.receiver));
        vm.serializeAddress(j, "poolOperator", address(s.operator));
        vm.serializeBytes32(j, "poolId", PoolId.unwrap(s.key.toId()));
        vm.serializeUint(j, "epochOrigin", EPOCH_ORIGIN);

        string memory k = "poolKey";
        vm.serializeAddress(k, "currency0", Currency.unwrap(s.key.currency0));
        vm.serializeAddress(k, "currency1", Currency.unwrap(s.key.currency1));
        vm.serializeUint(k, "fee", s.key.fee);
        vm.serializeInt(k, "tickSpacing", s.key.tickSpacing);
        string memory keyJson = vm.serializeAddress(k, "hooks", address(s.key.hooks));
        vm.serializeString(j, "poolKey", keyJson);

        string memory w = "windows";
        vm.serializeUint(w, "live", s.live);
        vm.serializeUint(w, "oct2025", s.oct2025);
        string memory winJson = vm.serializeUint(w, "feb2025", s.feb2025);
        string memory out = vm.serializeString(j, "windows", winJson);

        vm.writeJson(out, "./deployments/fork.json");
        console2.log("wrote deployments/fork.json");
    }
}
