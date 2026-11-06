// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {VarianceMarket} from "../../src/VarianceMarket.sol";
import {IVarianceMarket} from "../../src/interfaces/ITremor.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";
import {MockWETH} from "../mocks/MockWETH.sol";

/// @notice Random mint / burn / transfer / warp / finalize / redeem sequences over 3 windows and 3 actors.
contract MarketHandler is Test {
    uint256 internal constant WAD = 1e18;
    VarianceMarket public mkt;
    MockWETH public weth;
    address[] public actors;
    uint256 public constant NW = 3;
    uint64 public constant DELAY = 3600;

    uint256 public calls_mint;
    uint256 public calls_burn;
    uint256 public calls_finalize;
    uint256 public calls_redeem;

    constructor(VarianceMarket m, MockWETH w) {
        mkt = m;
        weth = w;
        for (uint256 i; i < 3; ++i) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            vm.prank(a);
            weth.approve(address(m), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _view(uint256 id) internal view returns (IVarianceMarket.WindowView memory) {
        return mkt.window(id);
    }

    function mint(uint256 a, uint256 id, uint256 n) external {
        id = id % NW;
        address who = actors[a % actors.length];
        IVarianceMarket.WindowView memory w = _view(id);
        if (w.finalized || block.timestamp >= w.t1) return;
        n = bound(n, 0, 1e24);
        weth.mint(who, (n * w.S + WAD - 1) / WAD);
        vm.prank(who);
        mkt.mintSet(id, n);
        ++calls_mint;
    }

    function burn(uint256 a, uint256 id, uint256 n) external {
        id = id % NW;
        address who = actors[a % actors.length];
        IVarianceMarket.WindowView memory w = _view(id);
        if (w.finalized) return;
        uint256 bl = IERC20(w.long).balanceOf(who);
        uint256 bs = IERC20(w.short).balanceOf(who);
        n = bound(n, 0, bl < bs ? bl : bs);
        vm.prank(who);
        mkt.burnSet(id, n);
        ++calls_burn;
    }

    /// @dev moves one side between actors so single-sided holdings exist at redemption
    function transfer(uint256 a, uint256 b, uint256 id, bool long_, uint256 n) external {
        id = id % NW;
        address from = actors[a % actors.length];
        address to = actors[b % actors.length];
        IVarianceMarket.WindowView memory w = _view(id);
        IERC20 t = IERC20(long_ ? w.long : w.short);
        n = bound(n, 0, t.balanceOf(from));
        vm.prank(from);
        t.transfer(to, n);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 5 days));
    }

    function finalize(uint256 id) external {
        id = id % NW;
        IVarianceMarket.WindowView memory w = _view(id);
        if (w.finalized || block.timestamp < w.t1 + DELAY) return;
        mkt.checkpoint(id, 1000);
        mkt.finalize(id);
        ++calls_finalize;
    }

    function redeem(uint256 a, uint256 id, uint256 nl, uint256 ns) external {
        id = id % NW;
        address who = actors[a % actors.length];
        IVarianceMarket.WindowView memory w = _view(id);
        if (!w.finalized) return;
        nl = bound(nl, 0, IERC20(w.long).balanceOf(who));
        ns = bound(ns, 0, IERC20(w.short).balanceOf(who));
        vm.prank(who);
        mkt.redeem(id, nl, ns);
        ++calls_redeem;
    }
}

contract VarianceMarketInvariantTest is Test {
    uint256 internal constant WAD = 1e18;
    uint64 internal constant NOW = 1_760_000_000;
    VarianceMarket internal mkt;
    MockWETH internal weth;
    MockAggregatorV3 internal feed;
    MarketHandler internal handler;

    function setUp() public {
        vm.warp(NOW);
        weth = new MockWETH();
        feed = new MockAggregatorV3(1);
        // 6-hourly rounds from NOW-1d to NOW+25d with a deterministic, varying-size random walk
        int256 p = 2.6e15;
        uint256 seed = 42;
        for (uint256 t = NOW - 1 days; t <= NOW + 25 days; t += 6 hours) {
            seed = uint256(keccak256(abi.encode(seed)));
            int256 bps = int256(seed % 1500) - 700; // -7% .. +8%
            p = p * (10_000 + bps) / 10_000;
            feed.push(p, t);
        }
        mkt = new VarianceMarket(address(weth), address(feed), false, 5e16, 1e16, 2e15, 1e15, 3600, 7 days);
        // three windows with different S and caps so payouts are interior, capped and tiny
        mkt.createWindow(NOW + 1 days, NOW + 8 days, 1e18, 2.25e18, 0.33e18);
        mkt.createWindow(NOW + 2 days, NOW + 12 days, 3e18 + 7, 50e18, 0.33e18);
        mkt.createWindow(NOW + 1 days, NOW + 9 days, 1e18 - 1, 0.1e18, 0.33e18);
        handler = new MarketHandler(mkt, weth);
        targetContract(address(handler));
    }

    /// @dev WETH held >= sum of per-window locked WETH
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_solvency() public view {
        uint256 sum;
        for (uint256 id; id < 3; ++id) {
            sum += mkt.lockedWeth(id);
        }
        assertGe(weth.balanceOf(address(mkt)), sum);
    }

    /// @dev before finalize: lockedWeth >= setsOutstanding*S/1e18 (no dust allowance needed: mint ceils, burn floors),
    ///      and both claim supplies equal setsOutstanding
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_backing() public view {
        for (uint256 id; id < 3; ++id) {
            IVarianceMarket.WindowView memory w = mkt.window(id);
            if (w.finalized) continue;
            assertGe(mkt.lockedWeth(id) * WAD, w.setsOutstanding * w.S, "under-backed");
            assertEq(IERC20(w.long).totalSupply(), w.setsOutstanding);
            assertEq(IERC20(w.short).totalSupply(), w.setsOutstanding);
        }
    }

    /// @dev after finalize: redeeming every holder's whole balance needs no more than lockedWeth
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_allClaimsRedeemable() public view {
        for (uint256 id; id < 3; ++id) {
            IVarianceMarket.WindowView memory w = mkt.window(id);
            if (!w.finalized) continue;
            assertLe(w.payoutLong, w.S);
            uint256 owed;
            for (uint256 a; a < handler.actorCount(); ++a) {
                address who = handler.actors(a);
                owed += IERC20(w.long).balanceOf(who) * w.payoutLong / WAD;
                owed += IERC20(w.short).balanceOf(who) * (w.S - w.payoutLong) / WAD;
            }
            assertLe(owed, mkt.lockedWeth(id), "claims exceed locked WETH");
        }
    }

    /// @dev end of every run: finalize everything and actually redeem every balance (no underflow, no revert)
    function afterInvariant() public {
        vm.warp(NOW + 30 days);
        for (uint256 id; id < 3; ++id) {
            IVarianceMarket.WindowView memory w = mkt.window(id);
            if (!w.finalized) {
                mkt.checkpoint(id, 1000);
                mkt.finalize(id);
            }
            w = mkt.window(id);
            for (uint256 a; a < handler.actorCount(); ++a) {
                address who = handler.actors(a);
                uint256 bl = IERC20(w.long).balanceOf(who);
                uint256 bs = IERC20(w.short).balanceOf(who);
                vm.prank(who);
                mkt.redeem(id, bl, bs);
            }
            assertEq(IERC20(w.long).totalSupply(), 0);
            assertEq(IERC20(w.short).totalSupply(), 0);
        }
        uint256 sum;
        for (uint256 id; id < 3; ++id) {
            sum += mkt.lockedWeth(id);
        }
        assertEq(weth.balanceOf(address(mkt)), sum, "all WETH accounted for");
    }
}
