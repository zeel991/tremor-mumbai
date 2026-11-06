// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";
import {RedTeamBase, CoverSandwicher} from "./RedTeamBase.sol";

/// @notice Red-team finding 1 (6 Nov 2026): atomic sandwich of the permissionless hook cover buy
///         (handleHookFees -> _buyCover). Before the fix these setups paid the attacker up to +5.66 WETH; the hook now
///         buys at most 2*H_MIN*S/KAPPA LONG per call, so every attempt below must lose money.
contract CoverSandwichTest is RedTeamBase {
    struct Res {
        uint256 nLong;
        int256 pnl;
        uint256 hookLong;
        uint256 hookSpent;
    }

    function _run(P memory pp, uint256 dtFromStart, uint256 fee, uint256[] memory nTokens, uint256 chunk)
        internal
        returns (int256 best, uint256 baseLong, uint256 baseSpent)
    {
        _fork();
        _deploy(pp);
        uint64 t0 = market.window(id).t0;
        _advanceTo(t0 + dtFromStart);
        deal(WETH, address(hook), fee);
        console2.log("mid LONG (wei/whole token)", _mid(), "S", pp.S);

        // baseline: hook buys cover with nobody in front
        uint256 snap = vm.snapshotState();
        hook.handleHookFees(new Currency[](0));
        baseLong = _bal(longT, address(hook));
        baseSpent = fee - _bal(WETH, address(hook));
        console2.log("baseline: hook LONG bought / WETH spent", baseLong, baseSpent);
        vm.revertToState(snap);

        for (uint256 i; i < nTokens.length; ++i) {
            snap = vm.snapshotState();
            CoverSandwicher a = new CoverSandwicher(address(router), address(market), address(hook), WETH, longT, id);
            deal(WETH, address(a), 1000 * pp.S);
            uint256 chunks = nTokens[i] / chunk;
            uint256 vaultW0 = _bal(WETH, address(vault)) + _bal(longT, address(vault)) * _mid() / 1e18;
            int256 pnl = a.attack(_order(), chunks, chunk);
            uint256 hl = _bal(longT, address(hook));
            uint256 hs = fee - _bal(WETH, address(hook));
            console2.log("--- attacker LONG front-run (tokens*1e18), swaps per side:", nTokens[i], chunks);
            console2.log("    attacker PnL (WETH wei, signed):");
            console2.logInt(pnl);
            console2.log("    hook LONG bought / WETH spent", hl, hs);
            console2.log("    hook LONG shortfall vs baseline", baseLong > hl ? baseLong - hl : 0);
            vaultW0;
            if (pnl > best) best = pnl;
            vm.revertToState(snap);
        }
    }

    function _sizes(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory s) {
        s = new uint256[](4);
        s[0] = a;
        s[1] = b;
        s[2] = c;
        s[3] = d;
    }

    /// fork-build parameters, live build, 2h before t1 (half-spread ~= H_MIN), 10 WETH of accrued fees
    function test_sandwich_forkParams_nearExpiry_10weth() public {
        (int256 best,,) = _run(forkParams(), 7 days - 2 hours, 10e18, _sizes(5e18, 10e18, 15e18, 20e18), 0.5e18);
        console2.log("BEST attacker profit (wei)");
        console2.logInt(best);
        assertLe(best, 0, "sandwich must not be profitable");
    }

    /// same, Sepolia parameters (S = 1e15, LAMBDA/KAPPA / 1000), 0.01 WETH of fees: identical in S units
    function test_sandwich_sepoliaParams_nearExpiry_001weth() public {
        (int256 best,,) = _run(sepoliaParams(), 7 days - 2 hours, 10e15, _sizes(5e18, 10e18, 15e18, 20e18), 0.5e18);
        console2.log("BEST attacker profit (wei)");
        console2.logInt(best);
        assertLe(best, 0, "sandwich must not be profitable");
    }

    /// deeper strategy (500 sets, 50 WETH buyback) so the hook is NOT inventory-limited; 10 WETH of fees
    function test_sandwich_forkParams_nearExpiry_500sets_10weth() public {
        P memory pp = forkParams();
        pp.sets = 500e18;
        pp.buyback = 50e18;
        (int256 best,,) = _run(pp, 7 days - 2 hours, 10e18, _sizes(5e18, 10e18, 20e18, 30e18), 0.5e18);
        console2.log("BEST attacker profit (wei)");
        console2.logInt(best);
        assertLe(best, 0, "sandwich must not be profitable");
    }

    /// deeper strategy, 30 WETH of fees (e.g. fees left to accrue because nobody called handleHookFees)
    function test_sandwich_forkParams_nearExpiry_500sets_30weth() public {
        P memory pp = forkParams();
        pp.sets = 500e18;
        pp.buyback = 50e18;
        (int256 best,,) = _run(pp, 7 days - 2 hours, 30e18, _sizes(20e18, 40e18, 60e18, 80e18), 1e18);
        console2.log("BEST attacker profit (wei)");
        console2.logInt(best);
        assertLe(best, 0, "sandwich must not be profitable");
    }

    /// smaller fee pot: 3 WETH (below the ~20-token threshold) -> not profitable
    function test_sandwich_forkParams_nearExpiry_3weth_unprofitable() public {
        (int256 best,,) = _run(forkParams(), 7 days - 2 hours, 3e18, _sizes(2e18, 5e18, 10e18, 15e18), 0.5e18);
        console2.log("BEST attacker profit (wei)");
        console2.logInt(best);
        assertLe(best, 0);
    }

    /// window start: half-spread 0.05*S -> threshold ~100 tokens > 50-set inventory -> not profitable
    function test_sandwich_forkParams_windowStart_unprofitable() public {
        (int256 best,,) = _run(forkParams(), 1 hours, 10e18, _sizes(2e18, 5e18, 10e18, 15e18), 0.5e18);
        console2.log("BEST attacker profit (wei)");
        console2.logInt(best);
        assertLe(best, 0);
    }
}
