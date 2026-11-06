// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {stdStorage, StdStorage, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {RedTeamBase} from "./RedTeamBase.sol";
import {VarianceMarket} from "../../src/VarianceMarket.sol";
import {TremorVault} from "../../src/aqua/TremorVault.sol";
import {TremorHook} from "../../src/hook/TremorHook.sol";
import {PoolOperator} from "../../src/helpers/PoolOperator.sol";
import {IVarianceMarket, Side} from "../../src/interfaces/ITremor.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";

/// @notice Fixes for the weaknesses left open after the first red team (Codex critique, 7 Nov 2026), each attacked
///         again on a mainnet fork with the real Aqua registry and v4 PoolManager.
contract HardeningTest is RedTeamBase {
    using stdStorage for StdStorage;
    using PoolIdLibrary for *;
    using StateLibrary for IPoolManager;

    IPoolManager internal constant PM = IPoolManager(POOL_MANAGER);
    address internal attacker = makeAddr("attacker");
    uint256 internal constant L_HONEST = 100e18 * 20; // full range, 100 WETH side at P = 0.0025

    function _setUpPool() internal {
        _fork();
        _deploy(forkParams());
        uni.mint(address(this), 1_000_000e18);
        deal(WETH, address(this), 10_000e18);
        IERC20(UNI_ADDR).approve(address(operator), type(uint256).max);
        IERC20(WETH).approve(address(operator), type(uint256).max);
        operator.addLiquidity(key, -887_220, 887_220, int256(L_HONEST));
    }

    function _sqrtOf(uint256 pWad) internal pure returns (uint160) {
        return uint160(FPM.sqrt(FPM.mulDiv(pWad, uint256(1) << 192, 1e18)));
    }

    // ------------------------------------------------------------------ JIT liquidity vs the cover payout

    /// A JIT LP adds 9x the pool's liquidity, triggers the payout drip and removes in the same block. Without the
    /// penalty it would take ~90% of the payout; LiquidityPenaltyHook takes its fees and donates them back.
    function test_jit_cannotCollectThePayout() public {
        _setUpPool();
        uint256 payout = 1e18;
        deal(WETH, address(hook), payout);
        stdstore.target(address(hook)).sig("dripTotal()").checked_write(payout); // dripStart 0: fully released

        PoolOperator jitOp = new PoolOperator(PM);
        uni.mint(attacker, 10_000_000e18);
        deal(WETH, attacker, 10_000e18);
        uint256 u0 = _bal(UNI_ADDR, attacker);
        uint256 w0 = _bal(WETH, attacker);
        vm.startPrank(attacker);
        IERC20(UNI_ADDR).approve(address(jitOp), type(uint256).max);
        IERC20(WETH).approve(address(jitOp), type(uint256).max);
        jitOp.addLiquidity(key, -887_220, 887_220, int256(9 * L_HONEST));
        hook.drip();
        jitOp.addLiquidity(key, -887_220, 887_220, -int256(9 * L_HONEST));
        vm.stopPrank();
        int256 gain = int256(_bal(WETH, attacker)) - int256(w0)
            + (int256(_bal(UNI_ADDR, attacker)) - int256(u0)) * 0.0025e18 / 1e18;
        console2.log("JIT gain (wei) on a 1 WETH payout:");
        console2.logInt(gain);
        assertLt(gain, int256(payout / 1000), "JIT keeps < 0.1% of the payout");

        // the LP that stayed collects it all once past the penalty window
        vm.roll(block.number + PENALTY_BLOCKS + 1);
        uint256 hw0 = _bal(WETH, address(this));
        uint256 hu0 = _bal(UNI_ADDR, address(this));
        operator.addLiquidity(key, -887_220, 887_220, -int256(L_HONEST));
        uint256 honestWeth = _bal(WETH, address(this)) - hw0 + (_bal(UNI_ADDR, address(this)) - hu0) * 0.0025e18 / 1e18;
        // principal is 2 x 100 WETH of value; the rest is the payout
        assertGe(honestWeth, 200e18 + payout * 99 / 100, "honest LP received the payout");
    }

    /// Counterfactual: liquidity that stays past the penalty window keeps its share, so the payout is real money
    /// and the zero above is the penalty at work, not an empty drip.
    function test_jit_lpThatStaysPastThePenaltyWindowKeepsItsShare() public {
        _setUpPool();
        uint256 payout = 1e18;
        deal(WETH, address(hook), payout);
        stdstore.target(address(hook)).sig("dripTotal()").checked_write(payout);
        PoolOperator lp2 = new PoolOperator(PM);
        uni.mint(attacker, 10_000_000e18);
        deal(WETH, attacker, 10_000e18);
        uint256 u0 = _bal(UNI_ADDR, attacker);
        uint256 w0 = _bal(WETH, attacker);
        vm.startPrank(attacker);
        IERC20(UNI_ADDR).approve(address(lp2), type(uint256).max);
        IERC20(WETH).approve(address(lp2), type(uint256).max);
        lp2.addLiquidity(key, -887_220, 887_220, int256(9 * L_HONEST));
        hook.drip();
        vm.roll(block.number + PENALTY_BLOCKS);
        lp2.addLiquidity(key, -887_220, 887_220, -int256(9 * L_HONEST));
        vm.stopPrank();
        int256 gain = int256(_bal(WETH, attacker)) - int256(w0)
            + (int256(_bal(UNI_ADDR, attacker)) - int256(u0)) * 0.0025e18 / 1e18;
        assertApproxEqRel(uint256(gain), payout * 9 / 10, 0.01e18, "an LP of 90% of the liquidity earns ~90%");
    }

    /// Fees withheld from an LP that re-added liquidity inside the penalty window stay the LP's: handleHookFees only
    /// spends the hook's own fee claims, and the LP gets the withheld fees back when it removes later.
    function test_withheldLpFees_areNotSpentOnCover() public {
        _setUpPool();
        hook.setReceiver(address(this));
        hook.setPremium(3000, uint64(block.timestamp + 30 days));
        for (uint256 i; i < 4; ++i) {
            uint256 out = uint256(int256(operator.swapExactIn(key, false, 5e18).amount0()));
            operator.swapExactIn(key, true, out);
        }
        vm.roll(block.number + 1);
        operator.addLiquidity(key, -887_220, 887_220, 1e18); // inside the penalty window: accrued fees withheld
        uint256 wh0 = hook.withheld0();
        uint256 wh1 = hook.withheld1();
        assertGt(wh0 + wh1, 0, "fees withheld");

        vm.warp(block.timestamp + 1 hours);
        uniFeed.push(0.0025e18, block.timestamp);
        feed.push(int256(lastPx), block.timestamp);
        market.checkpoint(id, 64);
        hook.handleHookFees(new Currency[](0));
        assertGe(PM.balanceOf(address(hook), key.currency0.toId()), wh0, "UNI claims kept");
        assertGe(PM.balanceOf(address(hook), key.currency1.toId()), wh1, "WETH claims kept");

        vm.roll(block.number + PENALTY_BLOCKS + 1);
        operator.addLiquidity(key, -887_220, 887_220, -int256(L_HONEST + 1e18)); // succeeds, fees returned
        assertEq(hook.withheld0() + hook.withheld1(), 0);
    }

    // ------------------------------------------------------------------ oracle-latency guard with the real hook

    /// The hook reports the pool price at the start of the block: a swap cannot move it within the same block, and
    /// once the market has moved > 2% quotes pause until the Chainlink round lands and is ingested.
    function test_reference_blockStartPrice_pausesQuotesUntilRoundLands() public {
        _setUpPool();
        MockAggregatorV3 f = new MockAggregatorV3(1); // UNI/ETH in the pool's units
        f.push(0.0025e18, block.timestamp - 60);
        VarianceMarket m2 = new VarianceMarket(WETH, address(f), false, 0.05e18, 0.01e18, 2e15, 1e15, 1 hours, 7 days);
        uint256 w = m2.createWindow(uint64(block.timestamp), uint64(block.timestamp + 7 days), 1e18, V_CAP, V_FWD);
        m2.setReference(address(hook), 0.02e18);
        vm.expectRevert("reference");
        m2.setReference(address(hook), 0.02e18); // one-time
        vm.prank(attacker);
        vm.expectRevert("reference");
        m2.setReference(attacker, 1e17);

        (uint256 ref0,) = hook.referencePrice();
        m2.quote(w, Side.LONG, true, true, 1e17, 0);

        // the market moves 5%: an arbitrageur moves the pool in this block
        operator.swapToPrice(key, false, _sqrtOf(0.002625e18));
        (uint256 refSame,) = hook.referencePrice();
        assertEq(refSame, ref0, "same block: block-start price unchanged");
        m2.quote(w, Side.LONG, true, true, 1e17, 0); // no one can make it pause or unpause within the block

        vm.roll(block.number + 1);
        (uint256 ref1,) = hook.referencePrice();
        assertApproxEqRel(ref1, 0.002625e18, 1e14);
        vm.expectRevert(IVarianceMarket.PriceMoved.selector);
        m2.quote(w, Side.LONG, true, true, 1e17, 0);

        // the Chainlink round lands at the new price and is ingested: quotes resume
        vm.warp(block.timestamp + 30);
        f.push(0.002625e18, block.timestamp);
        vm.expectRevert(IVarianceMarket.Stale.selector);
        m2.quote(w, Side.LONG, true, true, 1e17, 0);
        m2.checkpoint(w, 64);
        m2.quote(w, Side.LONG, true, true, 1e17, 0);
    }

    // ------------------------------------------------------------------ admin: one-time wiring, open rotation

    function test_hookWiring_isOneTime() public {
        _setUpPool();
        vm.expectRevert(TremorHook.AlreadySet.selector);
        hook.setCover(attacker, attacker, id);
        vm.expectRevert(TremorHook.AlreadySet.selector);
        hook.setPoolKey(key);
        hook.setReceiver(address(this));
        vm.expectRevert(TremorHook.AlreadySet.selector);
        hook.setReceiver(attacker);
        hook.setDripBlocks(type(uint64).max);
        assertEq(hook.dripBlocks(), hook.MAX_DRIP_BLOCKS());
    }

    function test_rotateCover_isPermissionlessAfterTheWindowEnds() public {
        _setUpPool();
        IVarianceMarket.WindowView memory cur = market.window(id);
        uint256 next = market.createWindow(cur.t1, cur.t1 + 7 days, p.S, V_CAP, V_FWD);
        uint256 notOpened = market.createWindow(cur.t1, cur.t1 + 7 days, p.S, V_CAP, V_FWD);
        deal(WETH, address(vault), _bal(WETH, address(vault)) + 50e18 + 5e18);
        vault.openWindow(next, 50e18, 5e18, cur.t1 + 7 days, keccak256("next"));

        vm.prank(attacker);
        vm.expectRevert(TremorHook.CoverNotExpired.selector);
        hook.rotateCover(next);

        vm.warp(cur.t1);
        vm.startPrank(attacker);
        vm.expectRevert(TremorHook.BadWindow.selector);
        hook.rotateCover(notOpened); // the vault has no strategy for it
        hook.rotateCover(next);
        vm.stopPrank();
        assertEq(hook.coverWindow(), next);
    }

    // ------------------------------------------------------------------ vault: writer shares

    function test_vault_writersShareProRata_ownerCannotWithdraw() public {
        _setUpPool();
        TremorVault v = new TremorVault(address(this), AQUA, address(router), address(market));
        address a = makeAddr("writerA");
        address b = makeAddr("writerB");
        deal(WETH, a, 3e18);
        deal(WETH, b, 1e18);
        vm.startPrank(a);
        IERC20(WETH).approve(address(v), type(uint256).max);
        v.deposit(3e18, a);
        vm.stopPrank();
        vm.startPrank(b);
        IERC20(WETH).approve(address(v), type(uint256).max);
        v.deposit(1e18, b);
        vm.stopPrank();
        deal(WETH, address(v), 4.4e18); // a profitable window: +0.4 WETH of premium
        uint256 sA = v.balanceOf(a);
        uint256 sB = v.balanceOf(b);
        vm.prank(a);
        uint256 outA = v.redeem(sA, a);
        vm.prank(b);
        uint256 outB = v.redeem(sB, b);
        assertApproxEqAbs(outA, 3.3e18, 1e6);
        assertApproxEqAbs(outB, 1.1e18, 1e6);
        // the operator has no withdraw: the only way out is redeeming shares it owns (none)
        (bool ok,) = address(v).call(abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1));
        assertFalse(ok);
    }

    function test_vault_depositsAndRedemptionsWaitWhileAWindowIsOpen() public {
        _setUpPool();
        deal(WETH, address(this), 1e18);
        IERC20(WETH).approve(address(vault), type(uint256).max);
        vm.expectRevert(TremorVault.WindowsOpen.selector);
        vault.deposit(1e18, address(this));

        IVarianceMarket.WindowView memory w = market.window(id);
        _advanceTo(w.t1 + 2 hours);
        market.finalize(id);
        vault.settle(id);
        assertEq(vault.openWindows(), 0);
        vault.deposit(1e18, address(this)); // open again between windows
    }

    function test_vault_firstDepositorInflationAttackLoses() public {
        _setUpPool();
        TremorVault v = new TremorVault(address(this), AQUA, address(router), address(market));
        address victim = makeAddr("victim");
        deal(WETH, attacker, 11e18);
        deal(WETH, victim, 1e18);
        vm.startPrank(attacker);
        IERC20(WETH).approve(address(v), type(uint256).max);
        v.deposit(1, attacker);
        IERC20(WETH).transfer(address(v), 10e18); // donate to inflate the share price
        vm.stopPrank();
        vm.startPrank(victim);
        IERC20(WETH).approve(address(v), type(uint256).max);
        v.deposit(1e18, victim);
        uint256 victimOut = v.redeem(v.balanceOf(victim), victim);
        vm.stopPrank();
        uint256 sAtk = v.balanceOf(attacker);
        vm.prank(attacker);
        uint256 attackerOut = v.redeem(sAtk, attacker);
        assertGe(victimOut, 0.99e18, "victim loses < 1%");
        assertLt(attackerOut, 10e18 + 1, "attacker loses money");
    }
}
