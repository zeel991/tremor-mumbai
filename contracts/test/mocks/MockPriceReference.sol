// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceReference} from "../../src/interfaces/ITremor.sol";

/// @notice Settable market price for the oracle-latency guard tests (stands in for the hook's pool price).
contract MockPriceReference is IPriceReference {
    uint256 public price;
    bool public ok = true;

    function set(uint256 p) external {
        price = p;
    }

    function setOk(bool v) external {
        ok = v;
    }

    function referencePrice() external view returns (uint256, bool) {
        return (price, ok);
    }
}
