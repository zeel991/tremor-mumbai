// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";
import {ReceiverTemplate} from "../vendor/chainlink/ReceiverTemplate.sol";
import {ITremorHook, ITremorReceiver, IVarianceMarket} from "../interfaces/ITremor.sol";

/// @title TremorReceiver
/// @notice CRE consumer (docs/spec.md §6.7). Each hourly report carries the measured arbitrage loss (LVR) and
///         volume of one contiguous block span of the source pool. Reports accumulate per 7-day epoch; when an epoch
///         closes, the next premium is set on the hook:
///             pips = min(MAX_PREMIUM_PIPS, K * LVR / volume * 1e6)
/// @dev Built on Chainlink's ReceiverTemplate (vendored verbatim).
///      Report authentication, by deployment:
///       - Production (KeystoneForwarder, a deployed CRE workflow): set the expected workflow ID and author on the
///         template (setExpectedWorkflowId / setExpectedAuthor) so only our workflow's DON-signed reports land.
///       - Simulation (MockKeystoneForwarder, used by `cre workflow simulate --broadcast` on Sepolia and the fork):
///         the mock forwards any caller's report with placeholder metadata, so workflow identity proves nothing.
///         There, `reportSubmitter` restricts delivery to the transaction signer running the simulation. It is a
///         tx.origin check on purpose (the mock is the msg.sender); leave it zero with a real forwarder.
///      Premium validity follows the absolute epoch schedule: the premium set when epoch N closes is valid until the
///      end of epoch N+1 plus GRACE. If reports skip whole epochs, the stale epoch sets 0. The fork replay build
///      (REPLAY_SCHEDULE) instead counts validity from receipt, so a historical backfill sets a live premium.
contract TremorReceiver is ReceiverTemplate, ITremorReceiver {
    uint256 public constant EPOCH = 7 days;
    uint24 public constant MAX_PREMIUM_PIPS = 3000;

    ITremorHook public immutable hook;
    IVarianceMarket public immutable market;
    uint256 public immutable EPOCH_ORIGIN; // Mon 2024-11-04 00:00 UTC = 1_730_678_400
    uint256 public immutable K; // WAD, default 0.5e18
    uint64 public immutable GRACE;
    /// @dev true only in the fork replay build: premium validity counted from receipt time, not the epoch schedule
    bool public immutable REPLAY_SCHEDULE;

    /// @notice simulation-forwarder deployments only: the one transaction signer allowed to deliver reports
    address public reportSubmitter;

    uint64 public lastProcessedBlock;
    uint256 public coverWindow;
    bool public started;
    uint256 public currentEpoch;
    int256 public epochLvr;
    uint256 public epochVolume;
    uint32 public epochSwaps;

    error NonContiguous(uint64 expectedFrom, uint64 gotFrom);
    error BadSpan();
    error BeforeOrigin();
    error NotSubmitter(address origin);

    event ReportSubmitterSet(address submitter);

    constructor(
        address forwarder,
        address hook_,
        address market_,
        uint256 epochOrigin,
        uint256 k,
        uint64 grace,
        bool replaySchedule
    ) ReceiverTemplate(forwarder) {
        hook = ITremorHook(hook_);
        market = IVarianceMarket(market_);
        EPOCH_ORIGIN = epochOrigin;
        K = k;
        GRACE = grace;
        REPLAY_SCHEDULE = replaySchedule;
    }

    /// @notice simulation-forwarder deployments: restrict report delivery to one signer (zero = no restriction)
    function setReportSubmitter(address submitter) external onlyOwner {
        reportSubmitter = submitter;
        emit ReportSubmitterSet(submitter);
    }

    function setCoverWindow(uint256 id) external onlyOwner {
        coverWindow = id;
    }

    /// @notice First processed block for a fresh receiver (e.g. the start of the backfill span).
    function setStartBlock(uint64 lastBlock) external onlyOwner {
        require(lastProcessedBlock == 0, "started");
        lastProcessedBlock = lastBlock;
    }

    function _processReport(bytes calldata report) internal override {
        // solhint-disable-next-line avoid-tx-origin
        if (reportSubmitter != address(0) && tx.origin != reportSubmitter) revert NotSubmitter(tx.origin);
        (uint64 fromBlock, uint64 toBlock, uint64 toTimestamp, int256 lvr, uint256 volume, uint32 nSwaps) =
            abi.decode(report, (uint64, uint64, uint64, int256, uint256, uint32));
        if (toBlock < fromBlock) revert BadSpan();
        if (lastProcessedBlock != 0 && fromBlock != lastProcessedBlock + 1) {
            revert NonContiguous(lastProcessedBlock + 1, fromBlock);
        }
        if (toTimestamp < EPOCH_ORIGIN) revert BeforeOrigin();
        lastProcessedBlock = toBlock;

        // a span straddling a boundary is attributed to the epoch of its last block (<= ~4.7h of 168h; spec §6.7)
        uint256 epoch = (toTimestamp - EPOCH_ORIGIN) / EPOCH;
        if (!started) {
            started = true;
            currentEpoch = epoch;
        } else if (epoch > currentEpoch) {
            _closeEpoch(epoch);
            currentEpoch = epoch;
            epochLvr = 0;
            epochVolume = 0;
            epochSwaps = 0;
        }
        epochLvr += lvr;
        epochVolume += volume;
        epochSwaps += nSwaps;
        emit Measured(fromBlock, toBlock, lvr, volume, nSwaps, epoch);
    }

    /// @notice pips the closing epoch would set (0 if no loss measured)
    function pendingPips() public view returns (uint24) {
        if (epochLvr <= 0 || epochVolume == 0) return 0;
        uint256 ratioK = FPM.mulDiv(uint256(epochLvr), K, epochVolume); // K * LVR/volume, WAD
        uint256 pips = FPM.mulDiv(ratioK, 1e6, 1e18);
        return pips > MAX_PREMIUM_PIPS ? MAX_PREMIUM_PIPS : uint24(pips);
    }

    /// @param nextEpoch the epoch the new report belongs to (> currentEpoch)
    function _closeEpoch(uint256 nextEpoch) internal {
        // a measurement only prices the epoch right after it: if whole epochs were skipped, it is stale
        uint24 pips = nextEpoch == currentEpoch + 1 ? pendingPips() : 0;
        uint64 validUntil = REPLAY_SCHEDULE
            ? uint64(block.timestamp + EPOCH + GRACE)
            : uint64(EPOCH_ORIGIN + (nextEpoch + 1) * EPOCH + GRACE);
        hook.setPremium(pips, validUntil);
        emit EpochClosed(currentEpoch, epochLvr, epochVolume, pips);
        // best effort: keep the cover window's variance current; never block measurement on it
        try market.checkpoint(coverWindow, 64) {} catch {}
    }
}
