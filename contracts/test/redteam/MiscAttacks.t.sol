// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";
import {RedTeamBase} from "./RedTeamBase.sol";

/// @notice Aqua.push skew manipulation (third-party writes to the maker's strategy balances) and the hook's
///         UNI->WETH conversion sandwich, against the deployed Aqua / v4 PoolManager on a mainnet fork.
contract MiscAttacksTest is RedTeamBase {
    address internal attacker = makeAddr("attacker");

    function _askLong(uint256 n) internal returns (uint256 amountIn) {
        (amountIn,,) = router.quote(_order(), WETH, longT, n, traits(attacker, false));
    }

    /// Anyone can Aqua.push() claim tokens into the vault's live strategy and move the 0x22 skew without trading.
    /// It is the same skew move as selling those tokens to the vault, but the pusher receives nothing: dominated.
    function test_aquaPush_thirdPartyMovesSkew_butDominatedBySelling() public {
        _fork();
        _deploy(forkParams());
        _advanceTo(market.window(id).t0 + 7 days - 2 hours);
        bytes32 h = vault.strategyHash(id);
        deal(WETH, attacker, 100e18);
        vm.startPrank(attacker);
        IERC20(WETH).approve(address(market), type(uint256).max);
        market.mintSet(id, 10e18);
        uint256 ask0 = _askLong(1e18);

        uint256 snap = vm.snapshotState();
        IERC20(shortT).approve(AQUA, type(uint256).max);
        IAqua(AQUA).push(address(vault), address(router), h, shortT, 5e18);
        uint256 askPush = _askLong(1e18);
        console2.log("LONG ask for 1 token: before / after pushing 5 SHORT", ask0, askPush);
        assertGt(askPush, ask0, "third party moved the maker's skew");
        vm.revertToState(snap);

        IERC20(shortT).approve(address(router), type(uint256).max);
        uint256 w0 = _bal(WETH, attacker);
        for (uint256 i; i < 10; ++i) {
            router.swap(_order(), shortT, WETH, 0.5e18, traits(attacker, true));
        }
        uint256 askSell = _askLong(1e18);
        uint256 got = _bal(WETH, attacker) - w0;
        console2.log("LONG ask after SELLING 5 SHORT instead / WETH received", askSell, got);
        assertEq(askSell, askPush, "same skew move");
        assertGt(got, 0, "selling pays; pushing pays nothing");
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ UNI -> WETH conversion sandwich

    function _seedPool(uint256 wethSide) internal {
        // full range, WETH side = wethSide at P = 0.0025 (sqrtP = 0.05): L = wethSide / 0.05
        uint256 L = wethSide * 20;
        uni.mint(address(this), 1_000_000e18);
        deal(WETH, address(this), 10_000e18);
        IERC20(UNI_ADDR).approve(address(operator), type(uint256).max);
        IERC20(WETH).approve(address(operator), type(uint256).max);
        operator.addLiquidity(key, -887_220, 887_220, int256(L));
    }

    function _convRun(uint256 hookUni, uint256 frontUni) internal returns (int256 atkPnlWad, int256 hookLossWad) {
        uint256 snap = vm.snapshotState();
        uni.mint(address(hook), hookUni);
        uni.mint(attacker, frontUni + 1);
        // hook has no WETH and the cover window is unaffected: we only measure the conversion
        vm.startPrank(attacker);
        IERC20(UNI_ADDR).approve(address(operator), type(uint256).max);
        IERC20(WETH).approve(address(operator), type(uint256).max);
        uint256 wFront;
        if (frontUni > 0) {
            BalanceDelta d = operator.swapExactIn(key, true, frontUni);
            wFront = uint256(uint128(d.amount1()));
        }
        vm.stopPrank();
        // handleHookFees converts UNI; the cover buy then spends the WETH: block it by pointing the hook at a
        // closed-out size (we read the WETH it received from the vault balance delta instead)
        uint256 vaultW0 = _bal(WETH, address(vault));
        uint256 hookUni0 = _bal(UNI_ADDR, address(hook));
        hook.handleHookFees(new Currency[](0));
        uint256 sold = hookUni0 - _bal(UNI_ADDR, address(hook));
        uint256 hookWeth = _bal(WETH, address(hook)) + (_bal(WETH, address(vault)) - vaultW0);
        // back-run: buy UNI back with the WETH taken in the front-run
        vm.startPrank(attacker);
        if (wFront > 0) operator.swapExactIn(key, false, wFront);
        vm.stopPrank();
        int256 uniDelta = int256(_bal(UNI_ADDR, attacker)) - int256(frontUni + 1);
        atkPnlWad = uniDelta * 0.0025e18 / 1e18; // attacker WETH back to 0: value the UNI change at the oracle
        hookLossWad = int256(sold * 0.0025e18 / 1e18) - int256(hookWeth);
        console2.log("hook UNI / attacker front-run UNI", hookUni, frontUni);
        console2.log("  hook UNI sold / WETH received", sold, hookWeth);
        console2.log("  hook shortfall vs oracle, bps of sold value", sold == 0 ? 0 : uint256(hookLossWad > 0 ? hookLossWad : int256(0)) * 1e4 / (sold * 0.0025e18 / 1e18));
        console2.log("  attacker PnL at oracle price (signed wei):");
        console2.logInt(atkPnlWad);
        vm.revertToState(snap);
    }

    function test_uniConversionSandwich_bound() public {
        _fork();
        _deploy(forkParams());
        _advanceTo(market.window(id).t0 + 3 days);
        _seedPool(100e18); // 100 WETH + 40k UNI full range
        int256 best;
        uint256[5] memory fronts = [uint256(0), 50e18, 100e18, 150e18, 190e18];
        for (uint256 i; i < fronts.length; ++i) {
            (int256 pnl,) = _convRun(150e18, fronts[i]);
            if (pnl > best) best = pnl;
        }
        console2.log("BEST attacker PnL (wei)");
        console2.logInt(best);
        // 150 UNI is worth 0.375 WETH: the best sandwich earns under 10 bps of it (measured: about 5 bps)
        assertLt(best, int256(uint256(150e18) * 0.0025e18 / 1e18 / 1000), "sandwich of the conversion < 10 bps");
    }
}
