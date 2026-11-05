// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {VarianceMarket} from "../../src/VarianceMarket.sol";
import {IVarianceMarket, Side} from "../../src/interfaces/ITremor.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";
import {MockWETH} from "../mocks/MockWETH.sol";

abstract contract MarketBase is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 31_536_000;
    uint256 internal constant S_ = 1e18;
    uint256 internal constant LAMBDA = 2e15;
    uint256 internal constant KAPPA = 1e15;
    uint256 internal constant H0 = 5e16;
    uint256 internal constant HMIN = 1e16;
    uint256 internal constant VCAP = 2.25e18;
    uint256 internal constant VFWD = 0.33e18;
    uint64 internal constant DELAY = 3600;
    uint64 internal constant WEEK = 7 days;
    uint64 internal constant NOW = 1_760_000_000;
    int256 internal constant P = 2.6e15; // UNI/ETH-like answer, 18 decimals

    MockWETH internal weth;
    MockAggregatorV3 internal feed;
    VarianceMarket internal mkt; // live build: no past windows
    VarianceMarket internal past; // fork-demo build: ALLOW_PAST_WINDOWS

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        vm.warp(NOW);
        weth = new MockWETH();
        feed = new MockAggregatorV3(1);
        mkt = _deploy(false);
        past = _deploy(true);
    }

    function _deploy(bool allowPast) internal returns (VarianceMarket) {
        return new VarianceMarket(address(weth), address(feed), allowPast, H0, HMIN, LAMBDA, KAPPA, DELAY);
    }

    function _rid(uint16 phase, uint64 k) internal pure returns (uint80) {
        return (uint80(phase) << 64) | uint80(k);
    }

    function _w(VarianceMarket m, uint256 id) internal view returns (IVarianceMarket.WindowView memory) {
        return m.window(id);
    }

    function _fund(VarianceMarket m, address who, uint256 amt) internal {
        weth.mint(who, amt);
        vm.prank(who);
        weth.approve(address(m), type(uint256).max);
    }

    function _mint(VarianceMarket m, address who, uint256 id, uint256 n) internal {
        _fund(m, who, (n * _w(m, id).S + WAD - 1) / WAD);
        vm.prank(who);
        m.mintSet(id, n);
    }

    /// @dev window [t0, t0+WEEK) on the live market, anchor round just before t0 (created at NOW < t0)
    function _liveWindow() internal returns (uint256 id, uint64 t0, uint64 t1) {
        feed.push(P, NOW - 600);
        t0 = NOW + 1 days;
        t1 = t0 + WEEK;
        id = mkt.createWindow(t0, t1, S_, VCAP, VFWD);
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return uint256(x < 0 ? -x : x);
    }
}

contract VarianceMarketTest is MarketBase {
    // ================================================================ createWindow

    function test_createWindow_revertsWhenTooShort() public {
        feed.push(P, NOW - 1);
        uint64 t0 = NOW + 1;
        vm.expectRevert(IVarianceMarket.WindowTooShort.selector);
        mkt.createWindow(t0, t0 + WEEK - 1, S_, VCAP, VFWD);
        uint256 id = mkt.createWindow(t0, t0 + WEEK, S_, VCAP, VFWD); // exactly 7 days is legal
        assertEq(_w(mkt, id).t1 - _w(mkt, id).t0, WEEK);
    }

    function test_createWindow_pastWindow_onlyWhenAllowed() public {
        feed.push(P, NOW - 10 days);
        uint64 t0 = NOW - 1;
        vm.expectRevert(IVarianceMarket.PastWindow.selector);
        mkt.createWindow(t0, t0 + WEEK, S_, VCAP, VFWD);
        // t0 == block.timestamp is not in the past
        mkt.createWindow(NOW, NOW + WEEK, S_, VCAP, VFWD);
        // fork-demo build accepts it
        uint256 id = past.createWindow(t0, t0 + WEEK, S_, VCAP, VFWD);
        assertEq(_w(past, id).t0, t0);
    }

    function test_createWindow_paramsMustBePositive() public {
        feed.push(P, NOW - 1);
        vm.expectRevert(bytes("params"));
        mkt.createWindow(NOW, NOW + WEEK, 0, VCAP, VFWD);
        vm.expectRevert(bytes("params"));
        mkt.createWindow(NOW, NOW + WEEK, S_, 0, VFWD);
    }

    /// @dev p0 = answer of the LAST round with updatedAt <= t0, for t0 on, between, before and after rounds
    function test_createWindow_anchorsP0_toLastRoundAtOrBeforeT0() public {
        uint64 base = NOW - 60 days;
        uint256 nr = 41;
        uint256 prevU;
        for (uint256 k = 1; k <= nr; ++k) {
            // irregular spacing, and round 21 shares round 20's timestamp
            uint256 u = k == 21 ? prevU : base + k * 3600 + (k % 7) * 97;
            feed.push(int256(1e15 * k), u);
            prevU = u;
        }
        // sanity: monotone timestamps
        for (uint256 k = 2; k <= nr; ++k) {
            (,,, uint256 a,) = feed.getRoundData(_rid(1, uint64(k - 1)));
            (,,, uint256 b,) = feed.getRoundData(_rid(1, uint64(k)));
            assertLe(a, b);
        }
        // sweep t0 across the whole range and compare with a linear scan
        for (uint64 t0 = base + 3600; t0 < base + (nr + 3) * 3600; t0 += 611) {
            uint256 expK;
            for (uint256 k = 1; k <= nr; ++k) {
                (,,, uint256 u,) = feed.getRoundData(_rid(1, uint64(k)));
                if (u <= t0) expK = k;
            }
            if (expK == 0) {
                vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
                past.createWindow(t0, t0 + WEEK, S_, VCAP, VFWD);
                continue;
            }
            uint256 id = past.createWindow(t0, t0 + WEEK, S_, VCAP, VFWD);
            IVarianceMarket.WindowView memory w = _w(past, id);
            (,,, uint256 uExp,) = feed.getRoundData(_rid(1, uint64(expK)));
            assertEq(w.lastRound, _rid(1, uint64(expK)), "anchor round");
            assertEq(w.lastAnswer, 1e15 * expK, "p0");
            assertEq(w.lastUpdatedAt, uExp, "anchor updatedAt");
            assertEq(w.phaseId, 1);
            assertEq(w.q, 0);
        }
        // exactly on a round's timestamp: that round is the anchor
        (,,, uint256 u10,) = feed.getRoundData(_rid(1, 10));
        uint256 id2 = past.createWindow(uint64(u10), uint64(u10) + WEEK, S_, VCAP, VFWD);
        assertEq(_w(past, id2).lastRound, _rid(1, 10));
    }

    function test_createWindow_emitsWindowCreatedWithP0() public {
        feed.push(P, NOW - 600);
        feed.push(P + 7, NOW - 300);
        vm.recordLogs();
        uint256 id = mkt.createWindow(NOW + 10, NOW + 10 + WEEK, S_, VCAP, VFWD);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("WindowCreated(uint256,uint64,uint64,address,address,uint16,uint256)");
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != sig) continue;
            seen = true;
            assertEq(uint256(logs[i].topics[1]), id);
            (,, address l, address s, uint16 ph, uint256 p0) =
                abi.decode(logs[i].data, (uint64, uint64, address, address, uint16, uint256));
            assertEq(l, _w(mkt, id).long);
            assertEq(s, _w(mkt, id).short);
            assertEq(ph, 1);
            assertEq(p0, uint256(P + 7));
        }
        assertTrue(seen);
    }

    function test_createWindow_phaseStartsAfterT0_reverts() public {
        feed.push(P, NOW - 10 days);
        feed.setPhase(2);
        feed.push(P, NOW - 1 hours); // phase 2 starts after t0
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        past.createWindow(NOW - 2 hours, NOW - 2 hours + WEEK, S_, VCAP, VFWD);
        // t0 inside phase 2 is fine and records phaseId 2
        uint256 id = past.createWindow(NOW - 30 minutes, NOW - 30 minutes + WEEK, S_, VCAP, VFWD);
        assertEq(_w(past, id).phaseId, 2);
        assertEq(_w(past, id).lastRound, _rid(2, 1));
        // empty phase: no round 1 at all
        feed.setPhase(3);
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        mkt.createWindow(NOW + 1, NOW + 1 + WEEK, S_, VCAP, VFWD);
    }

    function test_createWindow_nonPositiveAnchor_BadRound() public {
        feed.push(P, NOW - 2 hours);
        feed.push(0, NOW - 1 hours);
        vm.expectRevert(abi.encodeWithSelector(IVarianceMarket.BadRound.selector, _rid(1, 2)));
        mkt.createWindow(NOW, NOW + WEEK, S_, VCAP, VFWD);
    }

    // ================================================================ mintSet / burnSet

    function test_mintSet_pullsCeil_andMintsBothSides() public {
        feed.push(P, NOW - 1);
        uint256 S = 3e18 + 7;
        uint256 id = mkt.createWindow(NOW + 1, NOW + 1 + WEEK, S, VCAP, VFWD);
        IVarianceMarket.WindowView memory w = _w(mkt, id);
        _fund(mkt, alice, 100e18);

        uint256[4] memory ns = [uint256(1), 1e18, 5e17 + 1, 333];
        uint256[4] memory wethIns = [uint256(4), 3e18 + 7, 1500000000000000007, 1000]; // ceil(n*S/1e18)
        uint256 sumN;
        uint256 sumW;
        for (uint256 i; i < 4; ++i) {
            uint256 before = weth.balanceOf(alice);
            vm.expectEmit(true, true, false, true, address(mkt));
            emit IVarianceMarket.SetMinted(id, alice, ns[i], wethIns[i]);
            vm.prank(alice);
            mkt.mintSet(id, ns[i]);
            assertEq(before - weth.balanceOf(alice), wethIns[i], "ceil wethIn");
            sumN += ns[i];
            sumW += wethIns[i];
        }
        assertEq(IERC20(w.long).balanceOf(alice), sumN);
        assertEq(IERC20(w.short).balanceOf(alice), sumN);
        assertEq(IERC20(w.long).totalSupply(), sumN);
        assertEq(IERC20(w.short).totalSupply(), sumN);
        assertEq(_w(mkt, id).setsOutstanding, sumN);
        assertEq(mkt.lockedWeth(id), sumW);
        assertEq(weth.balanceOf(address(mkt)), sumW);
    }

    function test_burnSet_paysFloor_andBurnsBothSides() public {
        feed.push(P, NOW - 1);
        uint256 S = 3e18 + 7;
        uint256 id = mkt.createWindow(NOW + 1, NOW + 1 + WEEK, S, VCAP, VFWD);
        IVarianceMarket.WindowView memory w = _w(mkt, id);
        _mint(mkt, alice, id, 2e18);
        uint256 locked = mkt.lockedWeth(id);
        assertEq(locked, 6e18 + 14);

        uint256[3] memory ns = [uint256(1), 1e18, 333];
        uint256[3] memory outs = [uint256(3), 3e18 + 7, 999]; // floor(n*S/1e18)
        uint256 sumN;
        for (uint256 i; i < 3; ++i) {
            uint256 before = weth.balanceOf(alice);
            vm.expectEmit(true, true, false, true, address(mkt));
            emit IVarianceMarket.SetBurned(id, alice, ns[i], outs[i]);
            vm.prank(alice);
            mkt.burnSet(id, ns[i]);
            assertEq(weth.balanceOf(alice) - before, outs[i], "floor wethOut");
            locked -= outs[i];
            sumN += ns[i];
        }
        assertEq(mkt.lockedWeth(id), locked);
        assertEq(_w(mkt, id).setsOutstanding, 2e18 - sumN);
        assertEq(IERC20(w.long).totalSupply(), 2e18 - sumN);
        assertEq(IERC20(w.short).totalSupply(), 2e18 - sumN);
        // backing never drops below the outstanding sets
        assertGe(mkt.lockedWeth(id) * WAD, _w(mkt, id).setsOutstanding * S);
    }

    function test_burnSet_needsBothSides() public {
        (uint256 id,,) = _liveWindow();
        _mint(mkt, alice, id, 1e18);
        address longT = _w(mkt, id).long;
        vm.prank(alice);
        IERC20(longT).transfer(bob, 1);
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientBalance on LONG
        mkt.burnSet(id, 1e18);
    }

    function test_mintSet_onlyBeforeT1_onLiveBuild() public {
        (uint256 id,, uint64 t1) = _liveWindow();
        _mint(mkt, alice, id, 1e18);
        vm.warp(t1 - 1);
        _mint(mkt, alice, id, 1);
        vm.warp(t1);
        _fund(mkt, alice, 10e18);
        vm.prank(alice);
        vm.expectRevert(IVarianceMarket.TooLate.selector);
        mkt.mintSet(id, 1e18);
        // burning is still allowed until finalize
        vm.prank(alice);
        mkt.burnSet(id, 5e17);
    }

    function test_mintBurn_afterFinalize_revert() public {
        (uint256 id,, uint64 t1) = _liveWindow();
        _mint(mkt, alice, id, 1e18);
        vm.warp(t1 + DELAY);
        mkt.finalize(id);
        vm.prank(alice);
        vm.expectRevert(IVarianceMarket.AlreadyFinalized.selector);
        mkt.mintSet(id, 1);
        vm.prank(alice);
        vm.expectRevert(IVarianceMarket.AlreadyFinalized.selector);
        mkt.burnSet(id, 1);
    }

    function test_unknownWindow() public {
        vm.expectRevert(IVarianceMarket.UnknownWindow.selector);
        mkt.window(0);
        vm.expectRevert(IVarianceMarket.UnknownWindow.selector);
        mkt.quote(0, Side.LONG, true, true, 1, 0);
        vm.expectRevert(IVarianceMarket.UnknownWindow.selector);
        mkt.mintSet(0, 1);
    }

    // ================================================================ checkpoint

    function test_checkpoint_stopsWhenNextRoundMissing() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P, t0 + 100);
        feed.push(P * 2, t0 + 200);
        assertEq(mkt.checkpoint(id, 100), 2, "stops at updatedAt == 0");
        assertEq(_w(mkt, id).lastRound, _rid(1, 3));
        assertEq(mkt.checkpoint(id, 100), 0, "nothing new");
        feed.push(P, t0 + 300);
        assertEq(mkt.checkpoint(id, 100), 1, "resumes");
        assertEq(_w(mkt, id).lastRound, _rid(1, 4));
        assertEq(_w(mkt, id).lastUpdatedAt, t0 + 300);
    }

    function test_checkpoint_stopsAtT1_andMarksDone() public {
        (uint256 id, uint64 t0, uint64 t1) = _liveWindow();
        feed.push(P, t0 + 100);
        feed.push(P * 11 / 10, t1 - 1); // last counted round
        feed.push(P * 5, t1); // updatedAt == t1: not counted
        feed.push(P, t1 + 10);
        uint256 got = mkt.checkpoint(id, 100);
        assertEq(got, 2);
        IVarianceMarket.WindowView memory w = _w(mkt, id);
        assertEq(w.lastRound, _rid(1, 3));
        assertEq(w.lastAnswer, uint256(P * 11 / 10));
        uint256 q = w.q;
        // ln(1.1)^2 * 1e18 = 9084030374332734.4168... (Decimal, 60 digits); within 10 wei
        assertApproxEqAbs(q, 9084030374332734, 10);
        // done ingesting: later calls ingest nothing and q is frozen
        feed.push(P * 9, t1 + 20);
        assertEq(mkt.checkpoint(id, 100), 0);
        assertEq(_w(mkt, id).q, q);
        // tau = t1 once done: projected variance equals the settlement formula (spec §7.3)
        assertEq(mkt.projectedVariance(id), q * YEAR / WEEK);
    }

    function test_checkpoint_maxRounds() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        for (uint256 i = 1; i <= 10; ++i) {
            feed.push(P + int256(i) * 1e12, t0 + i * 1000);
        }
        assertEq(mkt.checkpoint(id, 3), 3);
        assertEq(_w(mkt, id).lastRound, _rid(1, 4));
        assertEq(mkt.checkpoint(id, 0), 0);
        assertEq(mkt.checkpoint(id, 4), 4);
        assertEq(_w(mkt, id).lastRound, _rid(1, 8));
        assertEq(mkt.checkpoint(id, 100), 3);
        assertEq(_w(mkt, id).lastRound, _rid(1, 11));
    }

    function test_checkpoint_emitsCheckpoint() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P, t0 + 1);
        feed.push(P, t0 + 2);
        vm.expectEmit(true, false, false, true, address(mkt));
        emit IVarianceMarket.Checkpoint(id, _rid(1, 1), _rid(1, 3), 0);
        mkt.checkpoint(id, 10);
    }

    function test_checkpoint_BadRound_zeroAnswer() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P, t0 + 1);
        feed.push(0, t0 + 2);
        vm.expectRevert(abi.encodeWithSelector(IVarianceMarket.BadRound.selector, _rid(1, 3)));
        mkt.checkpoint(id, 10);
    }

    function test_checkpoint_BadRound_negativeAnswer() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(-5, t0 + 5);
        vm.expectRevert(abi.encodeWithSelector(IVarianceMarket.BadRound.selector, _rid(1, 2)));
        mkt.checkpoint(id, 10);
    }

    function test_checkpoint_BadRound_decreasingUpdatedAt() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P, t0 + 100);
        feed.push(P, t0 + 100); // equal is fine
        feed.push(P, t0 + 99); // goes back
        vm.expectRevert(abi.encodeWithSelector(IVarianceMarket.BadRound.selector, _rid(1, 4)));
        mkt.checkpoint(id, 10);
        // nothing was written by the reverted call; the valid prefix can still be ingested in smaller steps
        assertEq(mkt.checkpoint(id, 2), 2);
    }

    function test_checkpoint_PhaseChanged() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P, t0 + 100);
        mkt.checkpoint(id, 10);
        feed.setPhase(2);
        feed.push(P, t0 + 200);
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        mkt.checkpoint(id, 10);
    }

    /// @dev rounds between creation and t0 re-anchor p0 and add nothing to q
    function test_checkpoint_preT0Rounds_onlyReanchor() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P * 3, t0 - 500);
        feed.push(P / 2, t0 - 100);
        feed.push(P, t0); // updatedAt == t0: still the anchor side
        assertEq(mkt.checkpoint(id, 10), 3);
        assertEq(_w(mkt, id).q, 0);
        assertEq(_w(mkt, id).lastAnswer, uint256(P));
        assertEq(mkt.projectedVariance(id), VFWD, "e = 0 before t0");
        feed.push(P * 2, t0 + 1); // first in-window return: ln 2
        mkt.checkpoint(id, 10);
        // ln(2)^2 = 0.480453013918201424667...
        assertApproxEqAbs(_w(mkt, id).q, 480453013918201425, 10);
    }

    function test_checkpoint_revertingGetRoundData_stops() public {
        (uint256 id, uint64 t0,) = _liveWindow();
        feed.push(P, t0 + 1);
        feed.setRevertGetRoundData(true);
        assertEq(mkt.checkpoint(id, 10), 0);
        feed.setRevertGetRoundData(false);
        assertEq(mkt.checkpoint(id, 10), 1);
    }

    function test_checkpoint_afterFinalize_isNoop() public {
        (uint256 id,, uint64 t1) = _liveWindow();
        vm.warp(t1 + DELAY);
        mkt.finalize(id);
        feed.push(P, t1 + DELAY);
        assertEq(mkt.checkpoint(id, 10), 0);
    }

    // ================================================================ finalize

    function test_finalize_tooEarly_beforeDelay() public {
        (uint256 id,, uint64 t1) = _liveWindow();
        vm.warp(t1 + DELAY - 1);
        vm.expectRevert(IVarianceMarket.TooEarly.selector);
        mkt.finalize(id);
        vm.warp(t1 + DELAY);
        mkt.finalize(id);
        assertTrue(_w(mkt, id).finalized);
    }

    function test_finalize_tooEarly_whenUnreadRoundExists() public {
        (uint256 id, uint64 t0, uint64 t1) = _liveWindow();
        feed.push(P, t0 + 100);
        feed.push(P * 2, t0 + 200);
        vm.warp(t1 + DELAY);
        vm.expectRevert(IVarianceMarket.TooEarly.selector);
        mkt.finalize(id);
        mkt.checkpoint(id, 1);
        vm.expectRevert(IVarianceMarket.TooEarly.selector);
        mkt.finalize(id);
        mkt.checkpoint(id, 1);
        // caught up with the latest round, no round >= t1 exists: allowed
        mkt.finalize(id);
        assertGt(_w(mkt, id).payoutLong, 0);
    }

    function test_finalize_tooEarly_whenPostT1RoundNotYetSeen() public {
        (uint256 id, uint64 t0, uint64 t1) = _liveWindow();
        feed.push(P, t0 + 100);
        feed.push(P, t1 + 5);
        vm.warp(t1 + DELAY);
        mkt.checkpoint(id, 1); // ingests only the in-window round
        vm.expectRevert(IVarianceMarket.TooEarly.selector);
        mkt.finalize(id);
        mkt.checkpoint(id, 1); // sees the t1 round -> done
        mkt.finalize(id);
    }

    function test_finalize_twice_reverts() public {
        (uint256 id,, uint64 t1) = _liveWindow();
        vm.warp(t1 + DELAY);
        mkt.finalize(id);
        vm.expectRevert(IVarianceMarket.AlreadyFinalized.selector);
        mkt.finalize(id);
    }

    /// @dev After a mid-window phase change, the window must never settle on partial data: checkpoint and finalize
    ///      both revert PhaseChanged (the window is left for manual handling, spec §6.2).
    function test_finalize_afterMidWindowPhaseChange_refusesPartialData() public {
        (uint256 id, uint64 t0, uint64 t1) = _liveWindow();
        feed.push(P, t0 + 100);
        feed.push(P * 2, t0 + 200);
        mkt.checkpoint(id, 1); // only the first in-window round
        feed.setPhase(2);
        feed.push(P * 4, t0 + 300);
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        mkt.checkpoint(id, 10);
        vm.warp(t1 + DELAY);
        // the window's phase is no longer current and no round >= t1 was seen: refuse to settle
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        mkt.finalize(id);

        // even when the old phase's last round was already ingested, partial data is refused
        uint64 s0 = t1 + DELAY + 1 days; // fresh window starting after the first one
        vm.warp(s0);
        MockAggregatorV3 f = new MockAggregatorV3(1);
        VarianceMarket m = new VarianceMarket(address(weth), address(f), false, H0, HMIN, LAMBDA, KAPPA, DELAY);
        f.push(P, s0 - 10);
        uint256 id2 = m.createWindow(s0, s0 + WEEK, S_, VCAP, VFWD);
        f.push(P, s0 + 100); // flat in phase 1, fully ingested
        m.checkpoint(id2, 10);
        f.setPhase(2);
        f.push(P * 8, s0 + 200); // 8x move in phase 2: never counted
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        m.checkpoint(id2, 10);
        vm.warp(s0 + WEEK + DELAY);
        vm.expectRevert(IVarianceMarket.PhaseChanged.selector);
        m.finalize(id2);
        assertFalse(m.window(id2).finalized);
    }

    // ================================================================ redeem

    function test_redeem_beforeFinalize_reverts() public {
        (uint256 id,,) = _liveWindow();
        _mint(mkt, alice, id, 1e18);
        vm.prank(alice);
        vm.expectRevert(IVarianceMarket.NotFinalized.selector);
        mkt.redeem(id, 1, 1);
    }

    function test_redeem_floorAmounts_and_I2() public {
        (uint256 id, uint64 t0, uint64 t1) = _liveWindow();
        IVarianceMarket.WindowView memory w = _w(mkt, id);
        _mint(mkt, alice, id, 3e18 + 1);
        _mint(mkt, bob, id, 1);
        feed.push(P * 105 / 100, t0 + 3600);
        feed.push(P, t0 + 7200);
        feed.push(P, t1);
        vm.warp(t1 + DELAY);
        mkt.checkpoint(id, 10);
        mkt.finalize(id);
        uint256 pl = _w(mkt, id).payoutLong;
        assertGt(pl, 0);
        assertLt(pl, S_);

        // 1 whole LONG + 1 whole SHORT = S exactly (I2)
        uint256 b0 = weth.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(mkt));
        emit IVarianceMarket.Redeemed(id, alice, 1e18, 1e18, S_);
        vm.prank(alice);
        assertEq(mkt.redeem(id, 1e18, 1e18), S_);
        assertEq(weth.balanceOf(alice) - b0, S_);

        // floors: 1 wei of each side pays floor(pl/1e18) + floor((S-pl)/1e18) = 0
        vm.prank(bob);
        assertEq(mkt.redeem(id, 1, 1), 0);

        // separate sides
        vm.prank(alice);
        assertEq(mkt.redeem(id, 2e18, 0), 2 * pl);
        vm.prank(alice);
        assertEq(mkt.redeem(id, 0, 1e18 + 1), (1e18 + 1) * (S_ - pl) / WAD);
        assertEq(IERC20(w.long).balanceOf(alice), 1);
        assertEq(IERC20(w.short).balanceOf(alice), 1e18);
        vm.prank(alice);
        mkt.redeem(id, 1, 1e18);
        assertEq(IERC20(w.long).totalSupply(), 0);
        assertEq(IERC20(w.short).totalSupply(), 0);
        // leftover is rounding dust owned by nobody, never negative
        assertEq(weth.balanceOf(address(mkt)), mkt.lockedWeth(id));
        assertLe(mkt.lockedWeth(id), 4);
    }

    function test_redeem_moreThanBalance_reverts() public {
        (uint256 id,, uint64 t1) = _liveWindow();
        _mint(mkt, alice, id, 1e18);
        vm.warp(t1 + DELAY);
        mkt.finalize(id);
        vm.prank(alice);
        vm.expectRevert();
        mkt.redeem(id, 1e18 + 1, 0);
    }

    /// @dev one in-window move of fuzzed size: payoutLong + payoutShort == S, cap holds, full set redeems to S
    function testFuzz_finalize_I2(uint256 moveBps, uint256 S) public {
        moveBps = bound(moveBps, 0, 9_000);
        S = bound(S, 1, 1e24);
        feed.push(P, NOW - 1);
        uint64 t0 = NOW + 1;
        uint64 t1 = t0 + WEEK;
        uint256 id = mkt.createWindow(t0, t1, S, VCAP, VFWD);
        _mint(mkt, alice, id, 1e18);
        feed.push(P * int256(10_000 + moveBps) / 10_000, t0 + 1000);
        feed.push(P, t1);
        vm.warp(t1 + DELAY);
        mkt.checkpoint(id, 10);
        mkt.finalize(id);
        uint256 pl = _w(mkt, id).payoutLong;
        assertLe(pl, S);
        assertEq(pl + (S - pl), S);
        uint256 v = _w(mkt, id).q * YEAR / WEEK;
        if (v >= VCAP) assertEq(pl, S);
        else assertEq(pl, S * v / VCAP);
        vm.prank(alice);
        assertEq(mkt.redeem(id, 1e18, 1e18), S);
    }
}

/// @notice Realized variance + settlement against reference/variance.json (exact Decimal ln, 80 digits)
contract VarianceMarketPathsTest is MarketBase {
    string internal vjson;

    function setUp() public override {
        super.setUp();
        vjson = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/variance.json"));
    }

    function _k(uint256 i, string memory f) internal pure returns (string memory) {
        return string.concat(".paths[", vm.toString(i), "].", f);
    }

    struct Acc {
        uint256 maxTermErr;
        uint256 maxTotalErr;
        uint256 terms;
    }

    function test_paths_matchReference() public {
        uint256 n = vm.parseJsonUint(vjson, ".count");
        Acc memory acc;
        for (uint256 i; i < n; ++i) {
            _runPath(i, acc);
        }
        console2.log("variance paths:", n);
        console2.log("  terms checked:", acc.terms);
        console2.log("  max |q term error| (wei):", acc.maxTermErr);
        console2.log("  max |q total error| (wei):", acc.maxTotalErr);
    }

    function _runPath(uint256 i, Acc memory acc) internal {
        int256[] memory answers = vm.parseJsonIntArray(vjson, _k(i, "answers"));
        uint256[] memory ups = vm.parseJsonUintArray(vjson, _k(i, "updatedAts"));
        uint256[] memory terms = vm.parseJsonUintArray(vjson, _k(i, "termsWad"));
        uint256[] memory tols = vm.parseJsonUintArray(vjson, _k(i, "termTolWad"));
        uint64 t0 = uint64(vm.parseJsonUint(vjson, _k(i, "t0")));
        uint64 t1 = uint64(vm.parseJsonUint(vjson, _k(i, "t1")));
        uint256 S = vm.parseJsonUint(vjson, _k(i, "S"));
        uint256 cap = vm.parseJsonUint(vjson, _k(i, "vCap"));
        string memory name = vm.parseJsonString(vjson, _k(i, "name"));

        MockAggregatorV3 f = new MockAggregatorV3(1);
        f.pushMany(answers, ups);
        VarianceMarket m = new VarianceMarket(address(weth), address(f), true, H0, HMIN, LAMBDA, KAPPA, DELAY);
        uint256 id = m.createWindow(t0, t1, S, cap, VFWD);
        assertEq(m.window(id).lastRound, _rid(1, uint64(vm.parseJsonUint(vjson, _k(i, "anchorIndex")) + 1)), name);
        assertEq(m.window(id).lastAnswer, vm.parseJsonUint(vjson, _k(i, "p0")), name);
        _fund(m, alice, (2e18 * S) / WAD + 2);
        vm.prank(alice);
        m.mintSet(id, 2e18);

        // ingest one round at a time and compare every q increment with the exact term
        uint256 prevQ;
        uint256 k;
        while (m.checkpoint(id, 1) == 1) {
            uint256 q = m.window(id).q;
            uint256 d = q - prevQ;
            uint256 err = d > terms[k] ? d - terms[k] : terms[k] - d;
            if (err > acc.maxTermErr) acc.maxTermErr = err;
            assertLe(err, tols[k], string.concat(name, ": term error"));
            prevQ = q;
            ++k;
        }
        assertEq(k, terms.length, string.concat(name, ": term count"));
        acc.terms += k;

        uint256 qRef = vm.parseJsonUint(vjson, _k(i, "qWad"));
        uint256 qErr = prevQ > qRef ? prevQ - qRef : qRef - prevQ;
        if (qErr > acc.maxTotalErr) acc.maxTotalErr = qErr;
        assertLe(qErr, vm.parseJsonUint(vjson, _k(i, "qTolWad")), string.concat(name, ": q"));

        vm.warp(t1 + DELAY);
        uint256 vSol = prevQ * YEAR / (t1 - t0); // spec: V = q*YEAR/(t1-t0), floor
        uint256 plSol = S * (vSol < cap ? vSol : cap) / cap; // spec: floor(S*min(V,cap)/cap)
        // tau = t1 after a round >= t1 was seen: projected variance equals settlement V (spec §7.3)
        assertEq(m.projectedVariance(id), vSol, string.concat(name, ": Vp at t1"));
        vm.expectEmit(true, false, false, true, address(m));
        emit IVarianceMarket.Finalized(id, vSol, plSol);
        m.finalize(id);
        uint256 pl = m.window(id).payoutLong;

        uint256 vRef = vm.parseJsonUint(vjson, _k(i, "V"));
        assertApproxEqAbs(vSol, vRef, vm.parseJsonUint(vjson, _k(i, "VTol")), string.concat(name, ": V"));
        assertApproxEqAbs(
            pl, vm.parseJsonUint(vjson, _k(i, "payoutLong")), vm.parseJsonUint(vjson, _k(i, "payoutTol")), name
        );
        console2.log(name);
        console2.log("   q err (wei):", qErr, " payoutLong:", pl);

        // I2 and redemption of everything
        vm.startPrank(alice);
        assertEq(m.redeem(id, 1e18, 1e18), S, string.concat(name, ": full set redeems to S"));
        m.redeem(id, 1e18, 1e18);
        vm.stopPrank();
        assertEq(weth.balanceOf(address(m)), m.lockedWeth(id));
        assertEq(m.lockedWeth(id), (2e18 * S + WAD - 1) / WAD - 2 * S);
    }
}

/// @notice VarianceMarket.quote against pricing.json "marketQuote" vectors (exact equality, all 4 branches + NoQuote).
///         Windows use a constant price so q == 0 exactly; e is set by a round at t0 + e.
contract VarianceMarketQuoteTest is MarketBase {
    string internal pjson;
    mapping(bytes32 => uint256) internal idPlus1;
    uint64 internal constant T = WEEK;
    uint64 internal constant QBASE = NOW - 400 days;

    struct V {
        uint256[] S;
        uint256[] cap;
        uint256[] vFwd;
        uint256[] e;
        uint256[] side;
        bool[] buys;
        bool[] exactIn;
        uint256[] amount;
        int256[] skew;
        uint256[] vProj;
        uint256[] expIn;
        uint256[] expOut;
        bool[] rev;
    }

    function setUp() public override {
        super.setUp();
        pjson = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/pricing.json"));
    }

    function _load() internal view returns (V memory v) {
        v.S = vm.parseJsonUintArray(pjson, ".marketQuote.S");
        v.cap = vm.parseJsonUintArray(pjson, ".marketQuote.vCap");
        v.vFwd = vm.parseJsonUintArray(pjson, ".marketQuote.vFwd");
        v.e = vm.parseJsonUintArray(pjson, ".marketQuote.e");
        v.side = vm.parseJsonUintArray(pjson, ".marketQuote.side");
        v.buys = vm.parseJsonBoolArray(pjson, ".marketQuote.takerBuys");
        v.exactIn = vm.parseJsonBoolArray(pjson, ".marketQuote.exactIn");
        v.amount = vm.parseJsonUintArray(pjson, ".marketQuote.amount");
        v.skew = vm.parseJsonIntArray(pjson, ".marketQuote.skew");
        v.vProj = vm.parseJsonUintArray(pjson, ".marketQuote.vProj");
        v.expIn = vm.parseJsonUintArray(pjson, ".marketQuote.expectedIn");
        v.expOut = vm.parseJsonUintArray(pjson, ".marketQuote.expectedOut");
        v.rev = vm.parseJsonBoolArray(pjson, ".marketQuote.reverts");
    }

    /// @dev one time slot per distinct e, 30 days apart; feed rounds pushed in time order before any window exists
    function _slots(uint256[] memory es) internal returns (uint256[] memory uniq, uint256 nu) {
        uniq = new uint256[](8);
        for (uint256 i; i < es.length; ++i) {
            bool found;
            for (uint256 j; j < nu; ++j) {
                if (uniq[j] == es[i]) found = true;
            }
            if (!found) uniq[nu++] = es[i];
        }
        for (uint256 j; j < nu; ++j) {
            uint64 t0 = QBASE + uint64(j) * 30 days;
            feed.push(P, t0); // anchor exactly at t0
            if (uniq[j] > 0) feed.push(P, t0 + uniq[j]); // same price: r = 0 exactly
        }
    }

    function _window(V memory v, uint256 i, uint256[] memory uniq, uint256 nu) internal returns (uint256 id) {
        uint256 slot;
        for (uint256 j; j < nu; ++j) {
            if (uniq[j] == v.e[i]) slot = j;
        }
        bytes32 key = keccak256(abi.encode(v.S[i], v.cap[i], v.vFwd[i], slot));
        if (idPlus1[key] != 0) return idPlus1[key] - 1;
        uint64 t0 = QBASE + uint64(slot) * 30 days;
        id = past.createWindow(t0, t0 + T, v.S[i], v.cap[i], v.vFwd[i]);
        if (v.e[i] > 0) assertEq(past.checkpoint(id, 1), 1); // ingest only the t0+e round (not the next slot's)
        assertEq(past.window(id).lastUpdatedAt, t0 + v.e[i]);
        assertEq(past.window(id).q, 0);
        idPlus1[key] = id + 1;
    }

    function test_quote_vectors_allBranches() public {
        V memory v = _load();
        (uint256[] memory uniq, uint256 nu) = _slots(v.e);
        uint256 bad;
        uint256[4] memory okBranch; // [buy exactIn, buy exactOut, sell exactIn, sell exactOut]
        uint256[4] memory noQuoteBranch;
        for (uint256 i; i < v.S.length; ++i) {
            uint256 id = _window(v, i, uniq, nu);
            if (past.projectedVariance(id) != v.vProj[i]) {
                ++bad;
                console2.log("vProj mismatch idx", i);
                continue;
            }
            uint256 br = (v.buys[i] ? 0 : 2) + (v.exactIn[i] ? 0 : 1);
            try past.quote(id, v.side[i] == 0 ? Side.LONG : Side.SHORT, v.buys[i], v.exactIn[i], v.amount[i], v.skew[i])
            returns (uint256 ain, uint256 aout) {
                if (v.rev[i] || ain != v.expIn[i] || aout != v.expOut[i]) {
                    if (++bad <= 5) {
                        console2.log("quote mismatch idx", i, ain, aout);
                        console2.log("   expected", v.expIn[i], v.expOut[i]);
                    }
                } else {
                    ++okBranch[br];
                }
            } catch (bytes memory err) {
                if (!v.rev[i] || err.length != 4 || bytes4(err) != IVarianceMarket.NoQuote.selector) {
                    if (++bad <= 5) console2.log("quote unexpected revert idx", i);
                } else {
                    ++noQuoteBranch[br];
                }
            }
        }
        console2.log("marketQuote vectors:", v.S.length, " mismatches:", bad);
        console2.log("  ok   buyIn/buyOut/sellIn/sellOut:", okBranch[0], okBranch[1]);
        console2.log("                                   ", okBranch[2], okBranch[3]);
        console2.log("  NoQuote buyIn/buyOut/sellIn/sellOut:", noQuoteBranch[0], noQuoteBranch[1]);
        console2.log("                                      ", noQuoteBranch[2], noQuoteBranch[3]);
        assertEq(bad, 0);
        for (uint256 b; b < 4; ++b) {
            assertGt(okBranch[b], 0, "branch with a filled quote");
            assertGt(noQuoteBranch[b], 0, "branch with a NoQuote");
        }
    }

    function test_quote_finalized_NoQuote() public {
        feed.push(P, NOW - 1);
        uint256 id = mkt.createWindow(NOW, NOW + WEEK, S_, VCAP, VFWD);
        mkt.quote(id, Side.LONG, true, true, 1e18, 0);
        vm.warp(NOW + WEEK + DELAY);
        mkt.finalize(id);
        vm.expectRevert(IVarianceMarket.NoQuote.selector);
        mkt.quote(id, Side.LONG, true, true, 1e18, 0);
    }

    /// @dev maker-favouring round trips through the market quote (spec §12)
    function testFuzz_quote_roundTrips(uint256 x, int256 skew, bool long_) public {
        feed.push(P, NOW - 1);
        uint256 id = mkt.createWindow(NOW, NOW + WEEK, S_, VCAP, VFWD);
        skew = bound(skew, -100e18, 100e18);
        x = bound(x, 0, 50e18);
        Side side = long_ ? Side.LONG : Side.SHORT;
        // buy exact-in x -> n; buying n exact-out costs <= x and n+1 costs > x
        try mkt.quote(id, side, true, true, x, skew) returns (uint256, uint256 n) {
            (uint256 cost,) = mkt.quote(id, side, true, false, n, skew);
            assertLe(cost, x);
            try mkt.quote(id, side, true, false, n + 1, skew) returns (uint256 cost1, uint256) {
                assertGt(cost1, x);
            } catch {}
        } catch {}
        // sell exact-out x -> n; selling n exact-in yields >= x, n-1 yields < x
        try mkt.quote(id, side, false, false, x, skew) returns (uint256 n, uint256) {
            (, uint256 got) = mkt.quote(id, side, false, true, n, skew);
            assertGe(got, x);
            if (n > 0) {
                (, uint256 got1) = mkt.quote(id, side, false, true, n - 1, skew);
                assertLt(got1, x);
            }
        } catch {}
    }
}
