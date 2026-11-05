// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Context} from "swap-vm/libs/VM.sol";
import {SwapVM} from "swap-vm/SwapVM.sol";
import {AquaOpcodes} from "swap-vm/opcodes/AquaOpcodes.sol";
import {Simulator} from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import {CappedPayoffCurve} from "./CappedPayoffCurve.sol";

/// @title TremorOpcodes
/// @notice swap-vm v1.0.2 AquaOpcodes (indices 0x00-0x21, unchanged) + CappedPayoffCurve appended at 0x22.
contract TremorOpcodes is AquaOpcodes, CappedPayoffCurve {
    uint256 internal constant CAPPED_PAYOFF_CURVE = 0x22;

    constructor(address aqua) AquaOpcodes(aqua) CappedPayoffCurve(aqua) {}

    function _opcodes()
        internal
        pure
        virtual
        override
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        function(Context memory, bytes calldata) internal[] memory base = super._opcodes();
        assert(base.length == CAPPED_PAYOFF_CURVE); // official set must stay 34 long; we append, never move
        result = new function(Context memory, bytes calldata) internal[](base.length + 1);
        for (uint256 i; i < base.length; ++i) {
            result[i] = base[i];
        }
        result[CAPPED_PAYOFF_CURVE] = _cappedPayoffCurve;
    }
}

/// @title TremorAquaSwapVMRouter
/// @notice Redeployment of swap-vm v1.0.2's AquaSwapVMRouter with one extra instruction (allowed by the 1inch prize:
///         "redeployments of a modified SwapVM contract is allowed"). Construct with the DEPLOYED Aqua registry.
contract TremorAquaSwapVMRouter is Simulator, SwapVM, TremorOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
        TremorOpcodes(aqua)
    {}

    function _instructions()
        internal
        pure
        override
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        return _opcodes();
    }
}
