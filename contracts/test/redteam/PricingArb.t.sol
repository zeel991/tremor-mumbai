// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {VarianceMarket} from "../../src/VarianceMarket.sol";
import {Side} from "../../src/interfaces/ITremor.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";

/// @notice Negative results: complete-set arbitrage, round trips with any chunking, and exact-in/exact-out
///         rounding against VarianceMarket.quote (the 0x22 instruction is a thin wrapper around it). No fork needed.
contract PricingArbTest is Test {
    VarianceMarket internal m;
    uint256 internal id;
    uint256 internal S;
    MockAggregatorV3 internal feed;

    function setUp() public {
        vm.warp(1_800_000_000);
        feed = new MockAggregatorV3(1);
        feed.push(3000e8, block.timestamp - 1);
        m = new VarianceMarket(address(1), address(feed), false, 0.05e18, 0.01e18, 2e15, 1e15, 1 hours, 7 days);
        S = 1e18;
        id = m.createWindow(uint64(block.timestamp), uint64(block.timestamp + 7 days), S, 2.25e18, 0.33e18);
        // advance near expiry (smallest spread) with one ingested round
        feed.push(3010e8, block.timestamp + 7 days - 1 hours);
        vm.warp(block.timestamp + 7 days - 1 hours + 1);
        m.checkpoint(id, 10);
    }

    function _q(Side s, bool buy, bool exactIn, uint256 amt, int256 skew) internal view returns (bool ok, uint256 i, uint256 o) {
        try m.quote(id, s, buy, exactIn, amt, skew) returns (uint256 a, uint256 b) {
            return (true, a, b);
        } catch {
            return (false, 0, 0);
        }
    }

    /// buying 1 LONG + 1 SHORT always costs >= S; selling both always pays <= S (any net inventory, incl. clamps)
    function testFuzz_completeSet(int256 net, uint256 size) public view {
        net = bound(net, -2000e18, 2000e18);
        size = bound(size, 1, 50e18);
        (bool okL, uint256 inL,) = _q(Side.LONG, true, false, size, net);
        (bool okS, uint256 inS,) = _q(Side.SHORT, true, false, size, -net);
        if (okL && okS) assertGe(inL + inS, size * S / 1e18, "ask_L + ask_S >= S");
        (bool okL2,, uint256 outL) = _q(Side.LONG, false, true, size, net);
        (bool okS2,, uint256 outS) = _q(Side.SHORT, false, true, size, -net);
        if (okL2 && okS2) assertLe(outL + outS, size * S / 1e18, "bid_L + bid_S <= S");
    }

    /// buy n LONG in `cb` chunks then sell them in `cs` chunks, with the skew updated after every fill: never profits
    function testFuzz_roundTripAnyChunking(uint256 n, uint8 cb, uint8 cs, int256 net0) public view {
        n = bound(n, 1e15, 40e18);
        cb = uint8(bound(cb, 1, 40));
        cs = uint8(bound(cs, 1, 40));
        net0 = bound(net0, -200e18, 200e18);
        int256 net = net0;
        uint256 cost;
        uint256 bought;
        for (uint256 i; i < cb; ++i) {
            uint256 amt = i + 1 == cb ? n - bought : n / cb;
            (bool ok, uint256 inW,) = _q(Side.LONG, true, false, amt, net);
            if (!ok) return;
            cost += inW;
            bought += amt;
            net += int256(amt);
        }
        uint256 proceeds;
        uint256 sold;
        for (uint256 i; i < cs; ++i) {
            uint256 amt = i + 1 == cs ? n - sold : n / cs;
            (bool ok,, uint256 outW) = _q(Side.LONG, false, true, amt, net);
            if (!ok) return;
            proceeds += outW;
            sold += amt;
            net -= int256(amt);
        }
        assertLe(proceeds, cost, "round trip never profits");
    }

    /// exact-in and exact-out agree in the maker's favour; 1-wei trades never extract value
    function testFuzz_exactInOutConsistency(uint256 n, int256 net) public view {
        n = bound(n, 1, 30e18);
        net = bound(net, -100e18, 100e18);
        (bool ok, uint256 x,) = _q(Side.LONG, true, false, n, net); // pay x for exactly n
        if (ok) {
            (bool ok2,, uint256 n2) = _q(Side.LONG, true, true, x, net); // pay x, get n2
            if (ok2) assertGe(n2, n);
            if (n2 > n) {} // more units for the same input is consistent with ceil on exact-out
            if (x > 0) {
                (bool ok3,, uint256 n3) = _q(Side.LONG, true, true, x - 1, net);
                if (ok3) assertLt(n3, n, "x is the minimal input for n");
            }
        }
        (bool okS,, uint256 y) = _q(Side.LONG, false, true, n, net); // sell n, get y
        if (okS && y > 0) {
            (bool okS2, uint256 nIn,) = _q(Side.LONG, false, false, y, net); // receive y, give nIn
            if (okS2) assertLe(nIn, n);
        }
    }

    function test_oneWeiTrades() public view {
        (, uint256 inW,) = _q(Side.LONG, true, false, 1, 0);
        assertEq(inW, 1, "1 wei of LONG costs 1 wei of WETH (ceil)");
        (,, uint256 outW) = _q(Side.LONG, false, true, 1, 0);
        assertEq(outW, 0, "selling 1 wei of LONG pays 0");
    }
}
