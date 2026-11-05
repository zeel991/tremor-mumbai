// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {BaseHookFee} from "@openzeppelin/uniswap-hooks/fee/BaseHookFee.sol";
import {CurrencySettler} from "@openzeppelin/uniswap-hooks/utils/CurrencySettler.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {IVarianceMarket, ITremorHook} from "../interfaces/ITremor.sol";

interface IAggregatorV3Lite {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IVaultOrders {
    function currentOrder(uint256 id) external view returns (ISwapVM.Order memory);
}

/// @title TremorHook
/// @notice Uniswap v4 hook (docs/spec.md §6.6): charges a capped HOOK fee (not an LP fee) sized by the CRE-measured
///         arbitrage loss, spends it on Tremor LONG variance cover through the Aqua/SwapVM router, and drip-donates
///         the cover payout back to in-range LPs.
/// @dev Flags: afterSwap | afterSwapReturnDelta (0x44), via OpenZeppelin BaseHookFee (fee on the unspecified
///      currency, minted to the hook as ERC-6909 claims). No external protocol call happens inside swap callbacks;
///      the Aqua purchase runs in handleHookFees() OUTSIDE the PoolManager unlock.
///      Pool: currency0 = UNI, currency1 = WETH.
contract TremorHook is BaseHookFee, IUnlockCallback, ITremorHook, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    uint24 public constant MAX_PREMIUM_PIPS = 3000; // 0.30%, the backtested cap (spec §7.6)
    uint256 public constant MAX_CONVERT_SLIPPAGE = 0.01e18; // UNI->WETH vs Chainlink UNI/ETH
    uint256 public constant SLIP = 0.01e18; // min output on the Aqua purchase vs its quote
    uint256 public constant HANDLE_INTERVAL = 1 hours;

    enum Action {
        REDEEM,
        DRIP
    }

    IVarianceMarket public immutable market;
    IAggregatorV3Lite public immutable uniEthFeed;

    address public receiver;
    address public vault;
    address public router;
    PoolKey public poolKey;
    bool public poolSet;
    uint256 public coverWindow;

    uint24 public premiumPips;
    uint64 public premiumValidUntil;
    uint64 public lastHandle;

    // drip schedule: `dripTotal` released linearly over `dripBlocks` blocks from `dripStart`
    uint256 public dripTotal;
    uint256 public dripDone;
    uint64 public dripStart;
    uint64 public dripBlocks = 300;

    error OnlyReceiver();
    error PremiumTooHigh();
    error TooSoon();
    error PoolNotSet();
    error NothingToDrip();
    error NoInRangeLiquidity();
    error WrongPool();

    constructor(IPoolManager pm, address market_, address uniEthFeed_, address owner_)
        BaseHook(pm)
        Ownable(owner_)
    {
        market = IVarianceMarket(market_);
        uniEthFeed = IAggregatorV3Lite(uniEthFeed_);
    }

    // ------------------------------------------------------------------ admin (deploy/demo wiring)

    function setReceiver(address r) external onlyOwner {
        receiver = r;
    }

    function setCover(address vault_, address router_, uint256 windowId) external onlyOwner {
        vault = vault_;
        router = router_;
        coverWindow = windowId;
    }

    function setPoolKey(PoolKey calldata key) external onlyOwner {
        if (address(key.hooks) != address(this)) revert WrongPool();
        poolKey = key;
        poolSet = true;
    }

    function setDripBlocks(uint64 b) external onlyOwner {
        dripBlocks = b == 0 ? 1 : b;
    }

    // ------------------------------------------------------------------ premium (set by CRE via TremorReceiver)

    function setPremium(uint24 pips, uint64 validUntil) external {
        if (msg.sender != receiver) revert OnlyReceiver();
        if (pips > MAX_PREMIUM_PIPS) revert PremiumTooHigh();
        premiumPips = pips;
        premiumValidUntil = validUntil;
        emit PremiumSet(pips, validUntil);
    }

    /// @dev fail-safe: a stale or unset premium charges nothing
    function _getHookFee(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        view
        override
        returns (uint24)
    {
        return block.timestamp <= premiumValidUntil ? premiumPips : 0;
    }

    // ------------------------------------------------------------------ fees -> cover

    /// @notice Redeem accrued ERC-6909 fee claims, convert UNI to WETH in this pool, then buy LONG cover on Aqua.
    /// @dev Permissionless and rate-limited. `currencies` is ignored: the hook serves one pool.
    function handleHookFees(Currency[] memory) public override nonReentrant {
        if (!poolSet) revert PoolNotSet();
        if (block.timestamp < lastHandle + HANDLE_INTERVAL) revert TooSoon();
        lastHandle = uint64(block.timestamp);

        poolManager.unlock(abi.encode(Action.REDEEM, uint256(0)));

        uint256 wethBal = IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
        uint256 reserved = dripTotal - dripDone; // payouts awaiting donation are not spent on cover
        if (wethBal <= reserved) return;
        _buyCover(wethBal - reserved);
    }

    function _buyCover(uint256 wethIn) internal {
        IERC20 weth = IERC20(Currency.unwrap(poolKey.currency1));
        IVarianceMarket.WindowView memory w = market.window(coverWindow);
        ISwapVM.Order memory order = IVaultOrders(vault).currentOrder(coverWindow);

        bytes memory quoteTraits = _takerTraits(0, false);
        (, uint256 expectedOut,) = ISwapVM(router).quote(order, address(weth), w.long, wethIn, quoteTraits);
        uint256 minOut = FPM.mulDiv(expectedOut, 1e18 - SLIP, 1e18);

        weth.forceApprove(router, wethIn);
        (uint256 amountIn, uint256 amountOut,) =
            ISwapVM(router).swap(order, address(weth), w.long, wethIn, _takerTraits(minOut, true));
        emit CoverBought(coverWindow, amountIn, amountOut);
    }

    /// @dev exact-in taker traits; useTransferFromAndAquaPush (0x0040) is required for Aqua orders (SwapVM.sol v1.0.2)
    function _takerTraits(uint256 minOut, bool withThreshold) internal view returns (bytes memory) {
        TakerTraitsLib.Args memory a;
        a.taker = address(this);
        a.isExactIn = true;
        a.isFirstTransferFromTaker = true;
        a.useTransferFromAndAquaPush = true;
        if (withThreshold) a.threshold = abi.encodePacked(minOut);
        return TakerTraitsLib.build(a);
    }

    // ------------------------------------------------------------------ payout -> LPs

    /// @notice After the cover window is finalized, redeem all LONG held and schedule the WETH for drip donation.
    function claimPayout(uint256 windowId) external nonReentrant {
        IVarianceMarket.WindowView memory w = market.window(windowId);
        uint256 longBal = IERC20(w.long).balanceOf(address(this));
        uint256 out = market.redeem(windowId, longBal, 0);
        uint256 remaining = dripTotal - dripDone;
        dripTotal = remaining + out;
        dripDone = 0;
        dripStart = uint64(block.number);
        emit PayoutClaimed(windowId, out);
    }

    function dripReleased() public view returns (uint256) {
        uint256 elapsed = block.number - dripStart;
        if (elapsed >= dripBlocks) return dripTotal;
        return dripTotal * elapsed / dripBlocks;
    }

    /// @notice Donate the released-but-undonated part of the payout to in-range LPs (permissionless).
    /// @dev Dripping caps value per call; it is our own heuristic, not an official JIT mitigation (spec §6.6).
    function drip() external nonReentrant {
        if (!poolSet) revert PoolNotSet();
        uint256 amount = dripReleased() - dripDone;
        if (amount == 0) revert NothingToDrip();
        dripDone += amount;
        poolManager.unlock(abi.encode(Action.DRIP, amount));
        emit Dripped(amount, dripTotal - dripDone);
    }

    // ------------------------------------------------------------------ PoolManager callback

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (Action action, uint256 amount) = abi.decode(data, (Action, uint256));
        PoolKey memory key = poolKey;
        if (action == Action.REDEEM) {
            _redeemClaims(key.currency0);
            _redeemClaims(key.currency1);
            _convertToWeth(key);
        } else {
            if (poolManager.getLiquidity(key.toId()) == 0) revert NoInRangeLiquidity();
            poolManager.donate(key, 0, amount, "");
            key.currency1.settle(poolManager, address(this), amount, false);
        }
        return "";
    }

    function _redeemClaims(Currency c) internal {
        uint256 bal = poolManager.balanceOf(address(this), c.toId());
        if (bal == 0) return;
        c.settle(poolManager, address(this), bal, true); // burn ERC-6909 claims
        c.take(poolManager, address(this), bal, false); // receive ERC-20
    }

    /// @dev UNI -> WETH through this same pool. The hook is msg.sender, so its own hook callbacks (and fee) are skipped.
    ///      Price limit = Chainlink UNI/ETH * (1 - MAX_CONVERT_SLIPPAGE); skipped if the pool is already below it.
    function _convertToWeth(PoolKey memory key) internal {
        uint256 uniBal = IERC20(Currency.unwrap(key.currency0)).balanceOf(address(this));
        if (uniBal == 0) return;
        (, int256 p,,,) = uniEthFeed.latestRoundData();
        if (p <= 0) return;
        uint256 pLim = FPM.mulDiv(uint256(p), 1e18 - MAX_CONVERT_SLIPPAGE, 1e18);
        uint160 limit = uint160(FPM.sqrt(FPM.mulDiv(pLim, uint256(1) << 192, 1e18)));
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        if (limit <= TickMath.MIN_SQRT_PRICE || sqrtP <= limit) return;

        BalanceDelta d = poolManager.swap(
            key, SwapParams({zeroForOne: true, amountSpecified: -int256(uniBal), sqrtPriceLimitX96: limit}), ""
        );
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        if (a0 < 0) key.currency0.settle(poolManager, address(this), uint256(uint128(-a0)), false);
        if (a1 > 0) key.currency1.take(poolManager, address(this), uint256(uint128(a1)), false);
    }
}
