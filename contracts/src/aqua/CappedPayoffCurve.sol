// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {Context} from "swap-vm/libs/VM.sol";
import {IVarianceMarket, Side} from "../interfaces/ITremor.sol";

/// @title CappedPayoffCurve
/// @notice SwapVM instruction (index 0x22 in TremorAquaSwapVMRouter) that prices capped-payoff claims
///         against WETH out of ONE Aqua strategy holding [WETH, LONG, SHORT] (docs/spec.md §6.3).
/// @dev Identical in quote() and swap(): no state writes, no branch on isStaticContext, no maker hooks.
///      Kept thin for the EIP-170 budget; the pricing maths lives in VarianceMarket.quote (a view call).
///      args (120 bytes): market(20) | windowId(8) | weth(20) | long(20) | short(20) | shippedLong(16) | shippedShort(16)
contract CappedPayoffCurve {
    IAqua private immutable _CPC_AQUA;

    error CappedPayoffCurveBadArgs();
    error CappedPayoffCurveBadPair();
    error CappedPayoffCurveInsufficientInventory(uint256 amountOut, uint256 balanceOut);

    constructor(address aqua) {
        _CPC_AQUA = IAqua(aqua);
    }

    function _cappedPayoffCurve(Context memory ctx, bytes calldata args) internal view {
        if (args.length != 120) revert CappedPayoffCurveBadArgs();
        address weth = address(bytes20(args[28:48]));
        address long = address(bytes20(args[48:68]));
        address short = address(bytes20(args[68:88]));

        bool takerBuys;
        address claim;
        if (ctx.query.tokenIn == weth) {
            takerBuys = true;
            claim = ctx.query.tokenOut;
        } else if (ctx.query.tokenOut == weth) {
            claim = ctx.query.tokenIn;
        } else {
            revert CappedPayoffCurveBadPair();
        }
        if (claim != long && claim != short) revert CappedPayoffCurveBadPair();

        // net inventory sold by the maker, from Aqua's balances under this order hash (no state of our own)
        (uint248 bL,) = _CPC_AQUA.rawBalances(ctx.query.maker, address(this), ctx.query.orderHash, long);
        (uint248 bS,) = _CPC_AQUA.rawBalances(ctx.query.maker, address(this), ctx.query.orderHash, short);
        int256 net = (int256(uint256(uint128(bytes16(args[88:104])))) - int256(uint256(bL)))
            - (int256(uint256(uint128(bytes16(args[104:120])))) - int256(uint256(bS)));

        bool exactIn = ctx.query.isExactIn;
        (uint256 amountIn, uint256 amountOut) = IVarianceMarket(address(bytes20(args[0:20]))).quote(
            uint64(bytes8(args[20:28])),
            claim == long ? Side.LONG : Side.SHORT,
            takerBuys,
            exactIn,
            exactIn ? ctx.swap.amountIn : ctx.swap.amountOut,
            claim == long ? net : -net
        );
        if (amountOut > ctx.swap.balanceOut) revert CappedPayoffCurveInsufficientInventory(amountOut, ctx.swap.balanceOut);
        ctx.swap.amountIn = amountIn;
        ctx.swap.amountOut = amountOut;
    }
}
