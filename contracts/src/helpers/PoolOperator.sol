// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CurrencySettler} from "@openzeppelin/uniswap-hooks/utils/CurrencySettler.sol";

/// @title PoolOperator
/// @notice Demo/test helper: add liquidity to and swap through a v4 pool (stands in for PositionManager/routers).
///         Pulls the caller's tokens with transferFrom and pays out to the caller. Not part of the protocol.
contract PoolOperator is IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencySettler for Currency;

    IPoolManager public immutable pm;

    struct Op {
        uint8 kind; // 0 = modify liquidity, 1 = swap
        address payer;
        PoolKey key;
        ModifyLiquidityParams liq;
        SwapParams swap;
    }

    error OnlyPoolManager();

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function addLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidity)
        external
        returns (BalanceDelta d)
    {
        Op memory op;
        op.kind = 0;
        op.payer = msg.sender;
        op.key = key;
        op.liq = ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidity, salt: 0});
        d = abi.decode(pm.unlock(abi.encode(op)), (BalanceDelta));
    }

    /// @notice exact-input swap; returns the BalanceDelta from the swapper's perspective
    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint256 amountIn) external returns (BalanceDelta d) {
        Op memory op;
        op.kind = 1;
        op.payer = msg.sender;
        op.key = key;
        op.swap = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        d = abi.decode(pm.unlock(abi.encode(op)), (BalanceDelta));
    }

    /// @notice swap until the pool reaches `sqrtPriceLimitX96` (an arbitrageur moving the pool to a new price)
    function swapToPrice(PoolKey calldata key, bool zeroForOne, uint160 sqrtPriceLimitX96)
        external
        returns (BalanceDelta d)
    {
        Op memory op;
        op.kind = 1;
        op.payer = msg.sender;
        op.key = key;
        op.swap = SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(1e30), sqrtPriceLimitX96: sqrtPriceLimitX96});
        d = abi.decode(pm.unlock(abi.encode(op)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(pm)) revert OnlyPoolManager();
        Op memory op = abi.decode(data, (Op));
        BalanceDelta d;
        if (op.kind == 0) {
            (d,) = pm.modifyLiquidity(op.key, op.liq, "");
        } else {
            d = pm.swap(op.key, op.swap, "");
        }
        _settle(op.key.currency0, d.amount0(), op.payer);
        _settle(op.key.currency1, d.amount1(), op.payer);
        return abi.encode(d);
    }

    function _settle(Currency c, int128 amount, address payer) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            IERC20(Currency.unwrap(c)).safeTransferFrom(payer, address(this), owed);
            c.settle(pm, address(this), owed, false);
        } else if (amount > 0) {
            c.take(pm, payer, uint256(uint128(amount)), false);
        }
    }
}
