// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {ClaimToken} from "./ClaimToken.sol";
import {Pricing} from "./libraries/Pricing.sol";
import {IVarianceMarket, Side} from "./interfaces/ITremor.sol";

interface IAggregatorV3 {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title VarianceMarket
/// @notice Complete-set market on realized variance of a Chainlink feed (docs/spec.md §6.2, §7).
///  - One window [t0, t1), t1 - t0 >= MIN_WINDOW (7 days; hours on the Sepolia build). LONG pays S*min(V, vCap)/vCap, SHORT pays the rest; LONG + SHORT = S.
///  - mintSet locks S WETH per set and mints 1 LONG + 1 SHORT, so every claim is fully backed (I1).
///  - Variance is read from EVERY round of the feed inside the window (tick level), walking proxy round ids
///    inside the phase recorded at creation; a phase change halts the window (phases overlap in time).
///  - If the window can never settle normally (the proxy moved phase before a round >= t1 was seen, or a round
///    inside the window is unreadable while later rounds exist), anyone may settle it after FALLBACK_DELAY at the
///    forward variance fixed at creation, so claims stay redeemable and no one picks the outcome after the fact.
contract VarianceMarket is IVarianceMarket, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant WAD = 1e18;
    uint256 public constant YEAR = 31_536_000;
    /// @dev 7 days for mainnet and the fork (a feed updating ~4x a day needs a week of rounds); the Sepolia
    ///      build uses hours, since its ETH/USD feed updates hourly and the demo must settle within the hackathon
    uint64 public immutable MIN_WINDOW;
    /// @dev extra wait, after the normal settlement time, before a stuck window may use the fallback
    uint64 public constant FALLBACK_DELAY = 7 days;

    IERC20 public immutable weth;
    IAggregatorV3 public immutable feed;
    /// @dev true only in the fork-demo build: lets windows in the past be created and traded (to settle real history)
    bool public immutable ALLOW_PAST_WINDOWS;
    uint256 public immutable H0; // half-spread at window start, WAD fraction of S
    uint256 public immutable H_MIN; // half-spread at expiry, WAD fraction of S
    uint256 public immutable LAMBDA; // impact, WETH wei per whole token per whole token
    uint256 public immutable KAPPA; // skew, WETH wei per whole token of net inventory
    uint64 public immutable FINALIZE_DELAY;

    struct Window {
        uint64 t0;
        uint64 t1;
        uint16 phaseId;
        bool finalized;
        bool doneIngesting; // saw a round with updatedAt >= t1
        uint80 lastRound;
        uint64 lastUpdatedAt;
        uint256 lastAnswer;
        uint256 S;
        uint256 vCap;
        uint256 vFwd;
        uint256 q;
        uint256 setsOutstanding;
        uint256 lockedWeth;
        uint256 payoutLong;
        ClaimToken long;
        ClaimToken short;
    }

    Window[] internal _windows;

    constructor(
        address weth_,
        address feed_,
        bool allowPastWindows,
        uint256 h0,
        uint256 hMin,
        uint256 lambda,
        uint256 kappa,
        uint64 finalizeDelay,
        uint64 minWindow
    ) {
        require(h0 >= hMin && h0 < WAD && lambda > 0 && minWindow >= 1 hours, "params");
        // The replay build quotes windows whose outcome is already public (red-team finding: buying a past crash
        // week's LONG at the forward price is pure profit). It exists only for local mainnet forks.
        require(!allowPastWindows || block.chainid == 1 || block.chainid == 31_337, "replay build: local fork only");
        MIN_WINDOW = minWindow;
        weth = IERC20(weth_);
        feed = IAggregatorV3(feed_);
        ALLOW_PAST_WINDOWS = allowPastWindows;
        H0 = h0;
        H_MIN = hMin;
        LAMBDA = lambda;
        KAPPA = kappa;
        FINALIZE_DELAY = finalizeDelay;
    }

    // ---------------------------------------------------------------- windows

    function WETH() external view returns (address) {
        return address(weth);
    }

    function windowCount() external view returns (uint256) {
        return _windows.length;
    }

    function createWindow(uint64 t0, uint64 t1, uint256 S, uint256 vCap, uint256 vFwd) external returns (uint256 id) {
        if (t1 < t0 + MIN_WINDOW) revert WindowTooShort();
        if (!ALLOW_PAST_WINDOWS && t0 < block.timestamp) revert PastWindow();
        require(S > 0 && vCap > 0, "params");

        (uint80 latestId,,,,) = feed.latestRoundData();
        uint16 phase = uint16(latestId >> 64);
        (uint80 r0, uint256 p0, uint64 u0) = _anchor(phase, uint64(latestId), t0);

        id = _windows.length;
        string memory sfx = _toString(id);
        ClaimToken long_ = new ClaimToken(string.concat("Tremor LONG #", sfx), string.concat("tLONG-", sfx));
        ClaimToken short_ = new ClaimToken(string.concat("Tremor SHORT #", sfx), string.concat("tSHORT-", sfx));

        Window storage w = _windows.push();
        w.t0 = t0;
        w.t1 = t1;
        w.phaseId = phase;
        w.lastRound = r0;
        w.lastAnswer = p0;
        w.lastUpdatedAt = u0;
        w.S = S;
        w.vCap = vCap;
        w.vFwd = vFwd;
        w.long = long_;
        w.short = short_;
        emit WindowCreated(id, t0, t1, address(long_), address(short_), phase, p0);
    }

    function mintSet(uint256 id, uint256 n) external nonReentrant {
        Window storage w = _get(id);
        if (w.finalized) revert AlreadyFinalized();
        if (!ALLOW_PAST_WINDOWS && block.timestamp >= w.t1) revert TooLate();
        uint256 wethIn = FPM.mulDivUp(n, w.S, WAD);
        weth.safeTransferFrom(msg.sender, address(this), wethIn);
        w.setsOutstanding += n;
        w.lockedWeth += wethIn;
        w.long.mint(msg.sender, n);
        w.short.mint(msg.sender, n);
        emit SetMinted(id, msg.sender, n, wethIn);
    }

    function burnSet(uint256 id, uint256 n) external nonReentrant {
        Window storage w = _get(id);
        if (w.finalized) revert AlreadyFinalized();
        uint256 wethOut = FPM.mulDiv(n, w.S, WAD);
        w.long.burn(msg.sender, n);
        w.short.burn(msg.sender, n);
        w.setsOutstanding -= n;
        w.lockedWeth -= wethOut;
        weth.safeTransfer(msg.sender, wethOut);
        emit SetBurned(id, msg.sender, n, wethOut);
    }

    // ---------------------------------------------------------------- settlement data

    /// @notice Ingest up to maxRounds new Chainlink rounds into the window (permissionless).
    function checkpoint(uint256 id, uint256 maxRounds) public returns (uint256 ingested) {
        Window storage w = _get(id);
        if (w.doneIngesting || w.finalized) return 0;
        (uint80 latestId,,,,) = feed.latestRoundData();
        if (uint16(latestId >> 64) != w.phaseId) revert PhaseChanged();

        uint80 fromRound = w.lastRound;
        uint80 r = w.lastRound;
        uint256 lastAnswer = w.lastAnswer;
        uint64 lastUpdatedAt = w.lastUpdatedAt;
        uint256 q = w.q;
        for (; ingested < maxRounds; ++ingested) {
            uint80 next = r + 1;
            (bool ok, uint256 answer, uint64 updatedAt) = _round(next);
            // unreadable round: end of feed if it is past the latest round; otherwise an internal gap, which leaves
            // the window not caught up (quotes go Stale, finalize reverts OracleGap)
            if (!ok || updatedAt == 0) break;
            if (updatedAt >= w.t1) {
                w.doneIngesting = true;
                break;
            }
            if (updatedAt < lastUpdatedAt || answer == 0) revert BadRound(next);
            if (updatedAt > w.t0) {
                int256 lr = FPM.lnWad(int256(FPM.mulDiv(answer, WAD, lastAnswer)));
                q += uint256((lr * lr) / int256(WAD));
            }
            r = next;
            lastAnswer = answer;
            lastUpdatedAt = updatedAt;
        }
        w.lastRound = r;
        w.lastAnswer = lastAnswer;
        w.lastUpdatedAt = lastUpdatedAt;
        w.q = q;
        emit Checkpoint(id, fromRound, r, q);
    }

    function finalize(uint256 id) external {
        Window storage w = _get(id);
        if (w.finalized) revert AlreadyFinalized();
        if (block.timestamp < w.t1 + FINALIZE_DELAY) revert TooEarly();
        if (!w.doneIngesting) {
            // never settle on partial data: if the feed moved to a new phase before a round >= t1 was seen in the
            // window's phase, the window stays unsettled (spec §6.2: never stitch phases; handle manually)
            (uint80 latestId,,,,) = feed.latestRoundData();
            if (uint16(latestId >> 64) != w.phaseId) revert PhaseChanged();
            // caught up only if the next round does not exist yet (a later round would have updatedAt > now >= t1)
            uint80 next = w.lastRound + 1;
            (bool ok,, uint64 nextUpdatedAt) = _round(next);
            if (ok && nextUpdatedAt != 0) revert TooEarly();
            // an unreadable round below the latest one is a gap, not the end of the feed: never settle on it
            if (next <= latestId) revert OracleGap(next);
        }
        uint256 v = FPM.mulDiv(w.q, YEAR, w.t1 - w.t0);
        w.payoutLong = Pricing.payoutLong(w.S, v, w.vCap);
        w.finalized = true;
        emit Finalized(id, v, w.payoutLong);
    }

    /// @notice Settle a window that can never finalize normally, at the forward variance fixed at creation
    ///         (permissionless). Only after t1 + FINALIZE_DELAY + FALLBACK_DELAY, and only while the oracle is
    ///         stuck: the proxy moved to a new phase before a round >= t1 was seen, or the next round is an
    ///         unreadable round below the latest one. The outcome is deterministic from creation-time parameters.
    function settleFallback(uint256 id) external {
        Window storage w = _get(id);
        if (w.finalized) revert AlreadyFinalized();
        if (block.timestamp < w.t1 + FINALIZE_DELAY + FALLBACK_DELAY) revert TooEarly();
        if (w.doneIngesting || !_stuck(w)) revert NotStuck();
        w.payoutLong = Pricing.payoutLong(w.S, w.vFwd, w.vCap);
        w.finalized = true;
        emit FallbackSettled(id, w.vFwd, w.payoutLong);
    }

    function redeem(uint256 id, uint256 nLong, uint256 nShort) external nonReentrant returns (uint256 wethOut) {
        Window storage w = _get(id);
        if (!w.finalized) revert NotFinalized();
        wethOut = FPM.mulDiv(nLong, w.payoutLong, WAD) + FPM.mulDiv(nShort, w.S - w.payoutLong, WAD);
        if (nLong > 0) w.long.burn(msg.sender, nLong);
        if (nShort > 0) w.short.burn(msg.sender, nShort);
        w.lockedWeth -= wethOut;
        weth.safeTransfer(msg.sender, wethOut);
        emit Redeemed(id, msg.sender, nLong, nShort, wethOut);
    }

    // ---------------------------------------------------------------- views

    function window(uint256 id) external view returns (WindowView memory v) {
        Window storage w = _get(id);
        v = WindowView({
            t0: w.t0,
            t1: w.t1,
            S: w.S,
            vCap: w.vCap,
            vFwd: w.vFwd,
            phaseId: w.phaseId,
            lastRound: w.lastRound,
            lastAnswer: w.lastAnswer,
            lastUpdatedAt: w.lastUpdatedAt,
            q: w.q,
            setsOutstanding: w.setsOutstanding,
            finalized: w.finalized,
            payoutLong: w.payoutLong,
            long: address(w.long),
            short: address(w.short)
        });
    }

    function lockedWeth(uint256 id) external view returns (uint256) {
        return _get(id).lockedWeth;
    }

    /// @notice Vp = (q*YEAR + vFwd*(T - e)) / T, e = time covered by ingested rounds (spec §7.3)
    function projectedVariance(uint256 id) public view returns (uint256) {
        Window storage w = _get(id);
        uint256 T = w.t1 - w.t0;
        uint256 e = _elapsed(w);
        return (w.q * YEAR + w.vFwd * (T - e)) / T;
    }

    /// @notice True when the window has ingested every public round in its phase (or already saw one at/after t1).
    function caughtUp(uint256 id) public view returns (bool) {
        Window storage w = _get(id);
        if (w.doneIngesting || w.finalized) return true;
        (uint80 latestId,,,,) = feed.latestRoundData();
        if (uint16(latestId >> 64) != w.phaseId) return false; // feed moved phase: checkpoint() will revert
        uint80 next = w.lastRound + 1;
        (bool ok,, uint64 nextUpdatedAt) = _round(next);
        // the next round is missing: caught up only if it is past the latest round (else it is an internal gap)
        return (!ok || nextUpdatedAt == 0) && next > latestId;
    }

    /// @notice Price a taker trade (spec §7.4). Used by the CappedPayoffCurve SwapVM instruction.
    function quote(uint256 id, Side side, bool takerBuys, bool exactIn, uint256 amount, int256 skewUnits)
        external
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        Window storage w = _get(id);
        if (w.finalized) revert NoQuote();
        // Never price on stale information (live build). Without this, a trader who sees a new Chainlink round
        // before anyone checkpoints it could buy at the old projected variance, and after t1 could trade with the
        // realized variance already known. The fork-demo build (ALLOW_PAST_WINDOWS) prices historical windows
        // before their rounds are ingested on purpose, so it keeps the old behaviour.
        if (!ALLOW_PAST_WINDOWS) {
            if (block.timestamp >= w.t1) revert TooLate();
            if (!caughtUp(id)) revert Stale();
        }
        uint256 S = w.S;
        uint256 midL = Pricing.midLong(S, projectedVariance(id), w.vCap);
        uint256 m = Pricing.skewed(side == Side.LONG ? midL : S - midL, KAPPA, skewUnits, S);
        uint256 h = Pricing.halfSpread(S, H0, H_MIN, w.t1 - w.t0, _elapsed(w));

        if (takerBuys) {
            uint256 a0 = m + h;
            if (a0 >= S) revert NoQuote();
            if (exactIn) {
                amountIn = amount;
                amountOut = Pricing.buyUnitsForInput(a0, LAMBDA, amount);
            } else {
                amountOut = amount;
                amountIn = Pricing.buyCost(a0, LAMBDA, amount);
            }
            if (amountOut > Pricing.maxBuy(a0, LAMBDA, S)) revert NoQuote();
        } else {
            if (m <= h) revert NoQuote();
            uint256 b0 = m - h;
            if (exactIn) {
                amountIn = amount;
                amountOut = Pricing.sellProceeds(b0, LAMBDA, amount);
            } else {
                amountOut = amount;
                amountIn = Pricing.sellUnitsForOutput(b0, LAMBDA, amount);
            }
        }
    }

    // ---------------------------------------------------------------- internals

    function _get(uint256 id) internal view returns (Window storage) {
        if (id >= _windows.length) revert UnknownWindow();
        return _windows[id];
    }

    function _elapsed(Window storage w) internal view returns (uint256) {
        uint256 tau = w.lastUpdatedAt;
        if (w.doneIngesting) tau = w.t1;
        if (tau <= w.t0) return 0;
        if (tau >= w.t1) return w.t1 - w.t0;
        return tau - w.t0;
    }

    /// @dev true when normal settlement is impossible: phase changed, or the next round is a gap below the latest
    function _stuck(Window storage w) internal view returns (bool) {
        (uint80 latestId,,,,) = feed.latestRoundData();
        if (uint16(latestId >> 64) != w.phaseId) return true;
        uint80 next = w.lastRound + 1;
        (bool ok,, uint64 u) = _round(next);
        return (!ok || u == 0) && next <= latestId;
    }

    /// @dev reads one proxy round; ok=false if the call reverts. Answer must be positive.
    function _round(uint80 roundId) internal view returns (bool ok, uint256 answer, uint64 updatedAt) {
        try feed.getRoundData(roundId) returns (uint80, int256 a, uint256, uint256 u, uint80) {
            return (true, a > 0 ? uint256(a) : 0, uint64(u));
        } catch {
            return (false, 0, 0);
        }
    }

    /// @dev last round of `phase` with updatedAt <= t (binary search over aggregator round ids; within a phase,
    ///      updatedAt is non-decreasing). Reverts PhaseChanged if the phase starts after t.
    function _anchor(uint16 phase, uint64 latestAgg, uint64 t)
        internal
        view
        returns (uint80 roundId, uint256 answer, uint64 updatedAt)
    {
        uint80 base = uint80(phase) << 64;
        (, uint256 a1, uint64 u1) = _round(base | 1);
        if (u1 == 0 || u1 > t) revert PhaseChanged();
        uint64 lo = 1;
        uint64 hi = latestAgg;
        while (lo < hi) {
            uint64 mid = lo + (hi - lo + 1) / 2;
            (, , uint64 um) = _round(base | mid);
            if (um != 0 && um <= t) lo = mid;
            else hi = mid - 1;
        }
        roundId = base | lo;
        (, answer, updatedAt) = _round(roundId);
        if (lo == 1) {
            answer = a1;
            updatedAt = u1;
        }
        if (answer == 0) revert BadRound(roundId);
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        while (v > 0) {
            b = abi.encodePacked(bytes1(uint8(48 + (v % 10))), b);
            v /= 10;
        }
        return string(b);
    }
}
