// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Pricing} from "../../src/libraries/Pricing.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

/// @notice External wrapper so tests can call the internal Pricing library (and expect its reverts).
contract PricingHarness {
    function midLong(uint256 S, uint256 v, uint256 vCap) external pure returns (uint256) {
        return Pricing.midLong(S, v, vCap);
    }

    function payoutLong(uint256 S, uint256 v, uint256 vCap) external pure returns (uint256) {
        return Pricing.payoutLong(S, v, vCap);
    }

    function skewed(uint256 mid, uint256 kappa, int256 skew, uint256 S) external pure returns (uint256) {
        return Pricing.skewed(mid, kappa, skew, S);
    }

    function halfSpread(uint256 S, uint256 h0, uint256 hMin, uint256 T, uint256 e) external pure returns (uint256) {
        return Pricing.halfSpread(S, h0, hMin, T, e);
    }

    function buyCost(uint256 a0, uint256 lambda, uint256 n) external pure returns (uint256) {
        return Pricing.buyCost(a0, lambda, n);
    }

    function buyUnitsForInput(uint256 a0, uint256 lambda, uint256 x) external pure returns (uint256) {
        return Pricing.buyUnitsForInput(a0, lambda, x);
    }

    function maxBuy(uint256 a0, uint256 lambda, uint256 S) external pure returns (uint256) {
        return Pricing.maxBuy(a0, lambda, S);
    }

    function maxSell(uint256 b0, uint256 lambda) external pure returns (uint256) {
        return Pricing.maxSell(b0, lambda);
    }

    function sellProceeds(uint256 b0, uint256 lambda, uint256 n) external pure returns (uint256) {
        return Pricing.sellProceeds(b0, lambda, n);
    }

    function sellUnitsForOutput(uint256 b0, uint256 lambda, uint256 x) external pure returns (uint256) {
        return Pricing.sellUnitsForOutput(b0, lambda, x);
    }

    /// @dev the exact ln step VarianceMarket.checkpoint uses
    function lnWad(int256 x) external pure returns (int256) {
        return FPM.lnWad(x);
    }
}
