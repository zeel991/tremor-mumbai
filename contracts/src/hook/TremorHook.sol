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
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {BaseHookFee} from "@openzeppelin/uniswap-hooks/fee/BaseHookFee.sol";
import {LiquidityPenaltyHook} from "@openzeppelin/uniswap-hooks/general/LiquidityPenaltyHook.sol";
import {CurrencySettler} from "@openzeppelin/uniswap-hooks/utils/CurrencySettler.sol";

import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {IVarianceMarket, ITremorHook, ITremorVault, IPriceReference} from "../interfaces/ITremor.sol";

interface IAggregatorV3Lite {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function decimals() external view returns (uint8);
}

interface IVaultOrders {
    function currentOrder(uint256 id) external view returns (ISwapVM.Order memory);
}

/// @title TremorHook
/// @notice Uniswap v4 hook (docs/spec.md §6.6): charges a capped HOOK fee (not an LP fee) sized by the CRE-measured
///         arbitrage loss, spends it on Tremor LONG variance cover through the Aqua/SwapVM router, and drip-donates
///         the cover payout back to in-range LPs.
/// @dev Flags 0x547: afterSwap | afterSwapReturnDelta from OpenZeppelin BaseHookFee (fee on the unspecified currency,
///      minted to the hook as ERC-6909 claims), and afterAddLiquidity | afterRemoveLiquidity (+ return deltas) from
///      OpenZeppelin LiquidityPenaltyHook: liquidity removed within PENALTY_BLOCKS of being added gives up its fees,
///      donations included, which are donated back to the LPs who stayed. That is what stops just-in-time liquidity
///      from collecting the cover payout. No external protocol call happens inside swap callbacks; the Aqua purchase
///      runs in handleHookFees() OUTSIDE the PoolManager unlock. Pool: currency0 = UNI, currency1 = WETH.
///      The hook is also the market's price reference: the pool price at the start of the current block
///      (same-block manipulation cannot move it), so quotes pause while a Chainlink round is pending.
///      Admin: wiring is set once; afterwards anyone may rotate cover to the vault's next window.
contract TremorHook is
    BaseHookFee,
    LiquidityPenaltyHook,
    IUnlockCallback,
    ITremorHook,
    IPriceReference,
    Ownable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    uint24 public constant MAX_PREMIUM_PIPS = 3000; // 0.30%, the backtested cap (spec §7.6)
    uint256 public constant MAX_CONVERT_SLIPPAGE = 0.01e18; // UNI->WETH vs Chainlink UNI/ETH
    uint256 public constant SLIP = 0.01e18; // min output on the Aqua purchase vs its quote
    uint256 public constant HANDLE_INTERVAL = 1 hours;
    uint256 public constant FEED_MAX_AGE = 25 hours; // Chainlink UNI/ETH heartbeat is 24h
    uint256 internal constant FILL_SEARCH_STEPS = 16; // bisection steps for the largest fillable cover buy
    uint64 public constant MAX_DRIP_BLOCKS = 50_400; // one week of blocks

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
    mapping(uint256 => bool) public coverHeld; // windows this hook bought LONG in
    mapping(uint256 => bool) public payoutClaimed; // windows already redeemed (one claim each)
    uint256 public dripDone;
    uint64 public dripStart;
    uint64 public dripBlocks = 300;

    // LP fees withheld by the liquidity penalty (ERC-6909 claims owed back to those positions, never spent on cover)
    uint256 public withheld0;
    uint256 public withheld1;

    // block-start price observation (see referencePrice)
    uint160 internal _lastSqrtP; // pool price after the latest swap
    uint160 internal _blockStartSqrtP; // pool price before the first swap of block _obsBlock
    uint64 internal _obsBlock;

    error OnlyReceiver();
    error PremiumTooHigh();
    error TooSoon();
    error PoolNotSet();
    error NothingToDrip();
    error NothingToClaim();
    error NoInRangeLiquidity();
    error WrongPool();
    error AlreadySet();
    error CoverNotSet();
    error CoverNotExpired();
    error BadWindow();

    event CoverRotated(uint256 indexed windowId);

    /// @notice WETH left unspent because the strategy could not fill it (kept for the next handle or window)
    event CoverDeferred(uint256 indexed windowId, uint256 wethRetained);
    /// @notice UNI left unconverted because the conversion feed was unusable (0 bad answer, 1 stale, 2 incomplete)
    event ConversionSkipped(uint8 reason);

    constructor(IPoolManager pm, address market_, address uniEthFeed_, address owner_, uint48 penaltyBlocks)
        BaseHook(pm)
        LiquidityPenaltyHook(penaltyBlocks)
        Ownable(owner_)
    {
        market = IVarianceMarket(market_);
        uniEthFeed = IAggregatorV3Lite(uniEthFeed_);
    }

    // ------------------------------------------------------------------ admin (one-time wiring)

    /// @notice One-time. The owner cannot later swap the receiver, vault, router or pool: those could redirect fees.
    function setReceiver(address r) external onlyOwner {
        if (receiver != address(0)) revert AlreadySet();
        receiver = r;
    }

    /// @notice One-time: the vault and router cover is bought from, and the first cover window.
    function setCover(address vault_, address router_, uint256 windowId) external onlyOwner {
        if (vault != address(0)) revert AlreadySet();
        vault = vault_;
        router = router_;
        coverWindow = windowId;
        emit CoverRotated(windowId);
    }

    function setPoolKey(PoolKey calldata key) external onlyOwner {
        if (poolSet) revert AlreadySet();
        if (address(key.hooks) != address(this)) revert WrongPool();
        poolKey = key;
        poolSet = true;
        (uint160 s,,,) = poolManager.getSlot0(key.toId());
        _lastSqrtP = s;
    }

    function setDripBlocks(uint64 b) external onlyOwner {
        dripBlocks = b == 0 ? 1 : (b > MAX_DRIP_BLOCKS ? MAX_DRIP_BLOCKS : b);
    }

    /// @notice Permissionless: once the current cover window has ended, move cover to another window the same vault
    ///         has open. Without this, fees would sit idle after every window until an admin acted.
    function rotateCover(uint256 newId) external {
        if (vault == address(0)) revert CoverNotSet();
        IVarianceMarket.WindowView memory cur = market.window(coverWindow);
        if (!cur.finalized && block.timestamp < cur.t1) revert CoverNotExpired();
        if (newId == coverWindow) revert BadWindow();
        IVarianceMarket.WindowView memory w = market.window(newId);
        if (w.finalized || (!market.ALLOW_PAST_WINDOWS() && block.timestamp >= w.t1)) revert BadWindow();
        ITremorVault v = ITremorVault(vault);
        if (v.strategyHash(newId) == bytes32(0) || v.docked(newId)) revert BadWindow();
        coverWindow = newId;
        emit CoverRotated(newId);
    }

    // ------------------------------------------------------------------ hook permissions and callbacks

    function getHookPermissions()
        public
        pure
        override(BaseHookFee, LiquidityPenaltyHook)
        returns (Hooks.Permissions memory p)
    {
        p.afterSwap = true;
        p.afterSwapReturnDelta = true;
        p.afterAddLiquidity = true;
        p.afterRemoveLiquidity = true;
        p.afterAddLiquidityReturnDelta = true;
        p.afterRemoveLiquidityReturnDelta = true;
    }

    /// @dev records the block-start price, then charges the hook fee (BaseHookFee)
    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        internal
        override(BaseHook, BaseHookFee)
        returns (bytes4, int128)
    {
        if (_obsBlock != block.number) {
            _blockStartSqrtP = _lastSqrtP;
            _obsBlock = uint64(block.number);
        }
        (uint160 s,,,) = poolManager.getSlot0(key.toId());
        _lastSqrtP = s;
        return super._afterSwap(sender, key, params, delta, hookData);
    }

    function _afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feeDelta,
        bytes calldata hookData
    ) internal override(BaseHook, LiquidityPenaltyHook) returns (bytes4, BalanceDelta) {
        return super._afterAddLiquidity(sender, key, params, delta, feeDelta, hookData);
    }

    function _afterRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feeDelta,
        bytes calldata hookData
    ) internal override(BaseHook, LiquidityPenaltyHook) returns (bytes4, BalanceDelta) {
        return super._afterRemoveLiquidity(sender, key, params, delta, feeDelta, hookData);
    }

    /// @dev keep withheld LP fees out of the hook-fee balance that handleHookFees spends
    function _takeFeesToHook(PoolKey calldata key, bytes32 positionKey, BalanceDelta feeDelta) internal override {
        super._takeFeesToHook(key, positionKey, feeDelta);
        withheld0 += uint128(feeDelta.amount0());
        withheld1 += uint128(feeDelta.amount1());
    }

    function _settleFeesFromHook(PoolKey calldata key, bytes32 positionKey)
        internal
        override
        returns (BalanceDelta w)
    {
        w = super._settleFeesFromHook(key, positionKey);
        if (w.amount0() > 0) withheld0 -= uint128(w.amount0());
        if (w.amount1() > 0) withheld1 -= uint128(w.amount1());
    }

    // ------------------------------------------------------------------ price reference (oracle-latency guard)

    /// @notice Pool price (WETH per UNI, WAD) at the start of the current block. Arbitrage keeps the pool at the
    ///         market price, so it moves before a Chainlink round lands; reading the block-start price means a trade
    ///         in the same block cannot move it. False until the pool has a price.
    function referencePrice() external view returns (uint256 priceWad, bool ok) {
        if (!poolSet) return (0, false);
        uint160 s;
        if (_obsBlock == block.number) {
            s = _blockStartSqrtP;
        } else {
            (s,,,) = poolManager.getSlot0(poolKey.toId());
        }
        if (s == 0) return (0, false);
        priceWad = FPM.mulDiv(FPM.mulDiv(s, s, 1 << 96), 1e18, 1 << 96);
        ok = true;
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
        // A running window refuses stale quotes, so ingest any new Chainlink rounds first (permissionless,
        // bounded). Historical replay windows (fork demo) are priced before ingestion on purpose: skip them.
        if (block.timestamp < w.t1) {
            try market.checkpoint(coverWindow, 64) {} catch {}
        }
        ISwapVM.Order memory order = IVaultOrders(vault).currentOrder(coverWindow);

        // Size cap (red-team finding, 6 Nov 2026): handleHookFees is permissionless, so one transaction can buy LONG,
        // trigger the hook's buy and sell back. The attacker gains the skew the hook's buy adds (KAPPA per LONG) and
        // pays at least the round-trip spread (2 * H_MIN * S per LONG). Buying at most kMax = 2 * H_MIN * S / KAPPA
        // LONG per call keeps that trade unprofitable at any time in the window; the rest waits for the next call.
        wethIn = _capToMaxLong(order, address(weth), w, wethIn);

        // Buy the largest amount the strategy can fill (its curve and LONG inventory are finite). Whatever does not
        // fit stays in the hook for the next handle or window, so an oversized balance never reverts fee handling.
        (uint256 spend, uint256 expectedOut) = _largestFill(order, address(weth), w.long, wethIn);
        if (spend < wethIn) emit CoverDeferred(coverWindow, wethIn - spend);
        if (spend == 0) return;
        uint256 minOut = FPM.mulDiv(expectedOut, 1e18 - SLIP, 1e18);

        weth.forceApprove(router, spend);
        (uint256 amountIn, uint256 amountOut,) =
            ISwapVM(router).swap(order, address(weth), w.long, spend, _takerTraits(minOut, true));
        coverHeld[coverWindow] = true;
        emit CoverBought(coverWindow, amountIn, amountOut);
    }

    /// @dev WETH needed to buy kMax LONG right now (exact-out quote); returns min(wethIn, that), or wethIn if no cap
    function _capToMaxLong(ISwapVM.Order memory order, address weth, IVarianceMarket.WindowView memory w, uint256 wethIn)
        internal
        view
        returns (uint256)
    {
        uint256 kappa = market.KAPPA();
        if (kappa == 0) return wethIn;
        uint256 kMax = FPM.mulDiv(2 * market.H_MIN(), w.S, kappa);
        try ISwapVM(router).quote(order, weth, w.long, kMax, _exactOutTraits()) returns (uint256 inNeeded, uint256, bytes32) {
            return inNeeded < wethIn ? inNeeded : wethIn;
        } catch {
            return wethIn; // fewer than kMax LONG left: the inventory itself is the cap (_largestFill)
        }
    }

    function _exactOutTraits() internal view returns (bytes memory) {
        TakerTraitsLib.Args memory a;
        a.taker = address(this);
        a.isExactIn = false;
        a.isFirstTransferFromTaker = true;
        a.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(a);
    }

    /// @dev full amount if it quotes; otherwise bisect for the largest amount that quotes (bounded steps).
    function _largestFill(ISwapVM.Order memory order, address tokenIn, address tokenOut, uint256 amount)
        internal
        view
        returns (uint256 spend, uint256 out)
    {
        bytes memory traits = _takerTraits(0, false);
        (bool ok, uint256 o) = _tryQuote(order, tokenIn, tokenOut, amount, traits);
        if (ok) return (amount, o);
        uint256 lo;
        uint256 hi = amount;
        for (uint256 i; i < FILL_SEARCH_STEPS && hi - lo > 1; ++i) {
            uint256 mid = lo + (hi - lo) / 2;
            (ok, o) = _tryQuote(order, tokenIn, tokenOut, mid, traits);
            if (ok) {
                lo = mid;
                out = o;
            } else {
                hi = mid;
            }
        }
        spend = lo;
    }

    function _tryQuote(ISwapVM.Order memory order, address tokenIn, address tokenOut, uint256 amount, bytes memory t)
        internal
        view
        returns (bool ok, uint256 out)
    {
        try ISwapVM(router).quote(order, tokenIn, tokenOut, amount, t) returns (uint256, uint256 o, bytes32) {
            return (o > 0, o);
        } catch {
            return (false, 0);
        }
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
    ///         Each window the hook bought cover in can be claimed once. Without that, anyone could call this with a
    ///         window holding nothing (or send the hook 1 wei of LONG) to restart the drip and delay LP payouts.
    function claimPayout(uint256 windowId) external nonReentrant {
        if (!coverHeld[windowId] || payoutClaimed[windowId]) revert NothingToClaim();
        payoutClaimed[windowId] = true;
        IVarianceMarket.WindowView memory w = market.window(windowId);
        uint256 longBal = IERC20(w.long).balanceOf(address(this));
        uint256 out = market.redeem(windowId, longBal, 0);
        if (out == 0) {
            emit PayoutClaimed(windowId, 0); // LONG paid nothing: leave any running drip untouched
            return;
        }
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
            _redeemClaims(key.currency0, withheld0);
            _redeemClaims(key.currency1, withheld1);
            _convertToWeth(key);
        } else {
            if (poolManager.getLiquidity(key.toId()) == 0) revert NoInRangeLiquidity();
            poolManager.donate(key, 0, amount, "");
            key.currency1.settle(poolManager, address(this), amount, false);
        }
        return "";
    }

    function _redeemClaims(Currency c, uint256 withheld) internal {
        uint256 bal = poolManager.balanceOf(address(this), c.toId());
        if (bal <= withheld) return;
        bal -= withheld; // claims withheld from LP positions by the liquidity penalty are not hook fees
        c.settle(poolManager, address(this), bal, true); // burn ERC-6909 claims
        c.take(poolManager, address(this), bal, false); // receive ERC-20
    }

    /// @dev UNI -> WETH through this same pool. The hook is msg.sender, so its own hook callbacks (and fee) are skipped.
    ///      Price limit = Chainlink UNI/ETH * (1 - MAX_CONVERT_SLIPPAGE); skipped if the pool is already below it.
    function _convertToWeth(PoolKey memory key) internal {
        uint256 uniBal = IERC20(Currency.unwrap(key.currency0)).balanceOf(address(this));
        if (uniBal == 0) return;
        (uint256 price, uint8 bad) = _feedPrice();
        if (bad != type(uint8).max) {
            emit ConversionSkipped(bad);
            return;
        }
        uint256 pLim = FPM.mulDiv(price, 1e18 - MAX_CONVERT_SLIPPAGE, 1e18);
        uint160 limit = uint160(FPM.sqrt(FPM.mulDiv(pLim, uint256(1) << 192, 1e18)));
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        if (limit <= TickMath.MIN_SQRT_PRICE || sqrtP <= limit) return;
        // this swap skips the hook's own callbacks: record the block-start price and the new price here
        if (_obsBlock != block.number) {
            _blockStartSqrtP = sqrtP;
            _obsBlock = uint64(block.number);
        }

        BalanceDelta d = poolManager.swap(
            key, SwapParams({zeroForOne: true, amountSpecified: -int256(uniBal), sqrtPriceLimitX96: limit}), ""
        );
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        if (a0 < 0) key.currency0.settle(poolManager, address(this), uint256(uint128(-a0)), false);
        if (a1 > 0) key.currency1.take(poolManager, address(this), uint256(uint128(a1)), false);
        (_lastSqrtP,,,) = poolManager.getSlot0(key.toId());
    }

    /// @dev UNI/ETH price as WAD, or a skip reason (0 bad answer, 1 stale, 2 incomplete round); max = usable.
    function _feedPrice() internal view returns (uint256 price, uint8 bad) {
        (uint80 roundId, int256 p,, uint256 updatedAt, uint80 answeredInRound) = uniEthFeed.latestRoundData();
        if (p <= 0) return (0, 0);
        if (updatedAt == 0 || answeredInRound < roundId) return (0, 2);
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > FEED_MAX_AGE) return (0, 1);
        uint8 dec = uniEthFeed.decimals();
        price = dec <= 18 ? uint256(p) * 10 ** (18 - dec) : uint256(p) / 10 ** (dec - 18);
        bad = type(uint8).max;
    }
}
