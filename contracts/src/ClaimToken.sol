// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ClaimToken
/// @notice LONG or SHORT claim on one Tremor variance window (docs/spec.md §6.1).
///         Plain ERC-20 (Aqua moves it with transferFrom); only the market can mint/burn.
contract ClaimToken is ERC20 {
    address public immutable market;

    error OnlyMarket();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        market = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _burn(from, amount);
    }
}
