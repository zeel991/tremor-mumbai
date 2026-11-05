// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

/// @title Pricing
/// @notice Quote maths for Tremor claims (docs/spec.md §7.2–7.4). Re-derived for this build.
/// Units:
///   S, prices (a0, b0, mid, h): WETH wei per WHOLE claim token (1e18 token wei)
///   lambda: WETH wei per whole token, per whole token traded (so cost of n wei = a0*n/1e18 + lambda*n^2/2e36)
///   n: claim-token wei; x: WETH wei
/// Rounding always favours the maker: taker pays ceil, receives floor; units given floor, units taken ceil.
library Pricing {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant TWO_WAD2 = 2e36;

    error NoQuote();

    /// @dev mid price of LONG for projected variance vProj (WAD) under cap vCap (WAD)
    function midLong(uint256 S, uint256 vProj, uint256 vCap) internal pure returns (uint256) {
        return FPM.mulDiv(S, vProj < vCap ? vProj : vCap, vCap);
    }

    /// @dev payout of one whole LONG at settlement variance v (WAD)
    function payoutLong(uint256 S, uint256 v, uint256 vCap) internal pure returns (uint256) {
        return midLong(S, v, vCap);
    }

    /// @dev mid shifted by inventory skew: m = clamp(mid + kappa*skew/1e18, 0, S). kappa WAD, skew WAD tokens (signed)
    function skewed(uint256 mid, uint256 kappa, int256 skew, uint256 S) internal pure returns (uint256) {
        int256 adj = (int256(kappa) * skew) / int256(WAD);
        int256 m = int256(mid) + adj;
        if (m < 0) return 0;
        if (uint256(m) > S) return S;
        return uint256(m);
    }

    /// @dev half-spread h = S*(hMin + (h0-hMin)*(T-e)/T)/1e18, tightening linearly to hMin at expiry. h0,hMin WAD fractions of S
    function halfSpread(uint256 S, uint256 h0, uint256 hMin, uint256 T, uint256 e) internal pure returns (uint256) {
        uint256 rem = e >= T ? 0 : T - e;
        // one rounding of the exact value S*(hMin*T + (h0-hMin)*rem)/(T*1e18) (two floors lost up to 2 wei when S != 1e18)
        return FPM.mulDiv(S, hMin * T + (h0 - hMin) * rem, WAD * T);
    }

    // ---------- taker buys n claims; unit ask a(q) = a0 + lambda*q ----------

    /// @dev WETH the taker pays for n claims: ceil(n*a0/1e18 + lambda*n^2/2e36) = ceil(n*(2e18*a0 + lambda*n)/2e36)
    ///      (spec §7.4 rounds the sum once; ceil+ceil overcharged by 1 wei)
    function buyCost(uint256 a0, uint256 lambda, uint256 n) internal pure returns (uint256) {
        return FPM.mulDivUp(n, 2 * WAD * a0 + lambda * n, TWO_WAD2);
    }

    /// @dev claims the taker receives for exactly x WETH (largest n with buyCost(n) <= x)
    function buyUnitsForInput(uint256 a0, uint256 lambda, uint256 x) internal pure returns (uint256 n) {
        // n = floor((sqrt(d) - a0)*1e18/lambda). Take the root of d*1e36 so the floor of sqrt does not lose up to
        // 1e18/lambda units; fall back to sqrt(d)*1e18 only if d*1e36 would overflow, and then walk up.
        uint256 d = a0 * a0 + 2 * lambda * x;
        uint256 s = d <= type(uint256).max / 1e36 ? FPM.sqrt(d * 1e36) : FPM.sqrt(d) * WAD;
        n = (s - a0 * WAD) / lambda;
        while (n > 0 && buyCost(a0, lambda, n) > x) {
            unchecked {
                --n;
            }
        }
        while (buyCost(a0, lambda, n + 1) <= x) ++n;
    }

    /// @dev largest buy size before the marginal ask reaches S: (S - a0)*1e18/lambda
    function maxBuy(uint256 a0, uint256 lambda, uint256 S) internal pure returns (uint256) {
        if (a0 >= S) return 0;
        return FPM.mulDiv(S - a0, WAD, lambda);
    }

    // ---------- taker sells n claims; unit bid b(q) = b0 - lambda*q ----------

    /// @dev largest sell size before the marginal bid reaches 0: b0*1e18/lambda
    function maxSell(uint256 b0, uint256 lambda) internal pure returns (uint256) {
        return FPM.mulDiv(b0, WAD, lambda);
    }

    /// @dev WETH the taker receives for n claims: floor(n*b0/1e18 - lambda*n^2/2e36) = floor(n*(2e18*b0 - lambda*n)/2e36);
    ///      requires n <= maxSell (so lambda*n <= b0*1e18). Spec §7.4 rounds the difference once; floor-ceil underpaid 1 wei.
    function sellProceeds(uint256 b0, uint256 lambda, uint256 n) internal pure returns (uint256) {
        if (n > maxSell(b0, lambda)) revert NoQuote();
        return FPM.mulDiv(n, 2 * WAD * b0 - lambda * n, TWO_WAD2);
    }

    /// @dev claims the taker must give to receive exactly x WETH (smallest n with sellProceeds(n) >= x)
    function sellUnitsForOutput(uint256 b0, uint256 lambda, uint256 x) internal pure returns (uint256 n) {
        uint256 b0sq = b0 * b0;
        uint256 twoLx = 2 * lambda * x;
        if (b0sq < twoLx) revert NoQuote();
        // same precision fix as buyUnitsForInput: root of d*1e36, fallback sqrt(d)*1e18 (overestimates n) on overflow
        uint256 d = b0sq - twoLx;
        uint256 s = d <= type(uint256).max / 1e36 ? FPM.sqrt(d * 1e36) : FPM.sqrt(d) * WAD;
        n = FPM.divUp(b0 * WAD - s, lambda);
        uint256 cap = maxSell(b0, lambda);
        if (n > cap) n = cap;
        while (n > 0 && sellProceeds(b0, lambda, n - 1) >= x) {
            unchecked {
                --n;
            }
        }
        while (sellProceeds(b0, lambda, n) < x) {
            if (n >= cap) revert NoQuote();
            unchecked {
                ++n;
            }
        }
    }
}
