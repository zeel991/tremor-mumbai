// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {VarianceMarket} from "../src/VarianceMarket.sol";
import {TremorAquaSwapVMRouter} from "../src/aqua/TremorAquaSwapVMRouter.sol";
import {TremorVault} from "../src/aqua/TremorVault.sol";
import {TremorHook} from "../src/hook/TremorHook.sol";
import {TremorReceiver} from "../src/hook/TremorReceiver.sol";
import {PoolOperator} from "../src/helpers/PoolOperator.sol";

interface IWETH9 {
    function deposit() external payable;
}

interface IFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Shared wiring for the fork tests and the fork deploy script (docs/spec.md §4, §10 F1).
abstract contract TremorSystem {
    // Ethereum mainnet (all verified to have code; docs/spec.md §4)
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant UNI = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant UNI_ETH_FEED = 0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e;
    address internal constant CRE_MOCK_FORWARDER = 0xA3D1AD4Ac559a6575a114998AffB2fB2Ec97a7D9;
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address internal constant REF_V3_POOL = 0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801;

    uint160 internal constant HOOK_FLAGS = 0x44; // afterSwap | afterSwapReturnDelta
    uint256 internal constant EPOCH_ORIGIN = 1_730_678_400; // Mon 2024-11-04 00:00 UTC
    uint64 internal constant OCT_2025 = 1_759_708_800; // Mon 2025-10-06 00:00 UTC
    uint64 internal constant FEB_2025 = 1_740_355_200; // Mon 2025-02-24 00:00 UTC

    // parameters (docs/spec.md §11)
    uint256 internal constant S = 1e18;
    uint256 internal constant V_CAP = 2.25e18;
    uint256 internal constant V_FWD = 0.33e18;

    struct Sys {
        VarianceMarket market;
        TremorAquaSwapVMRouter router;
        TremorVault vault;
        TremorHook hook;
        TremorReceiver receiver;
        PoolOperator operator;
        PoolKey key;
        uint256 live;
        uint256 oct2025;
        uint256 feb2025;
    }

    /// @dev must deploy TremorHook(pm, market, feed, owner) at an address whose low 14 bits == HOOK_FLAGS
    function _deployHook(address market, address owner) internal virtual returns (TremorHook);

    function _deployCore(address owner) internal returns (Sys memory s) {
        s.market = new VarianceMarket(WETH, UNI_ETH_FEED, true, 0.05e18, 0.01e18, 2e15, 1e15, 1 hours, 7 days);
        s.router = new TremorAquaSwapVMRouter(AQUA, WETH, owner, "Tremor SwapVM", "1");
        s.vault = new TremorVault(owner, AQUA, address(s.router), address(s.market));
        s.hook = _deployHook(address(s.market), owner);
        s.receiver = new TremorReceiver(CRE_MOCK_FORWARDER, address(s.hook), address(s.market), EPOCH_ORIGIN, 0.5e18, 1 days, true);
        s.operator = new PoolOperator(IPoolManager(POOL_MANAGER));
        s.key = PoolKey({
            currency0: Currency.wrap(UNI),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(s.hook))
        });
    }

    /// @dev windows: live [now, now+7d), the two real violent weeks (settled from real Chainlink rounds)
    function _createWindows(Sys memory s) internal {
        uint64 nowTs = uint64(block.timestamp);
        s.live = s.market.createWindow(nowTs, nowTs + 7 days, S, V_CAP, V_FWD);
        s.oct2025 = s.market.createWindow(OCT_2025, OCT_2025 + 7 days, S, V_CAP, V_FWD);
        s.feb2025 = s.market.createWindow(FEB_2025, FEB_2025 + 7 days, S, V_CAP, V_FWD);
    }

    /// @dev sqrtPriceX96 for currency1/currency0 = WETH per UNI = Chainlink UNI/ETH (both 18 decimals)
    function _sqrtPriceFromFeed() internal view returns (uint160) {
        (, int256 p,,,) = IFeed(UNI_ETH_FEED).latestRoundData();
        return uint160(FPM.sqrt(FPM.mulDiv(uint256(p), uint256(1) << 192, 1e18)));
    }

    function _initPool(Sys memory s) internal {
        IPoolManager(POOL_MANAGER).initialize(s.key, _sqrtPriceFromFeed());
        s.hook.setPoolKey(s.key);
        s.hook.setReceiver(address(s.receiver));
    }

    /// @dev full-range liquidity; the caller must hold UNI and WETH and have approved the operator
    function _seedLiquidity(Sys memory s, int256 liquidity) internal {
        IERC20(UNI).approve(address(s.operator), type(uint256).max);
        IERC20(WETH).approve(address(s.operator), type(uint256).max);
        s.operator.addLiquidity(s.key, -887_220, 887_220, liquidity);
    }

    /// @dev the vault must already hold sets*S + buyback WETH per window
    function _openWindows(Sys memory s, uint256 sets, uint256 buyback) internal {
        s.vault.openWindow(s.live, sets, buyback, uint64(block.timestamp + 7 days), keccak256("tremor-live"));
        s.vault.openWindow(s.oct2025, sets, buyback, uint64(block.timestamp + 30 days), keccak256("tremor-oct2025"));
        s.vault.openWindow(s.feb2025, sets, buyback, uint64(block.timestamp + 30 days), keccak256("tremor-feb2025"));
        // hook buys cover on the Oct-2025 replay window (priced on the writer's forward, before its rounds are
        // ingested); the receiver keeps the LIVE window checkpointed, as it would in production
        s.hook.setCover(address(s.vault), address(s.router), s.oct2025);
        s.receiver.setCoverWindow(s.live);
    }
}
