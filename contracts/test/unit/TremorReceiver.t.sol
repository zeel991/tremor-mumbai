// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {TremorReceiver} from "../../src/hook/TremorReceiver.sol";

contract RecHook {
    uint24 public pips;
    uint64 public validUntil;
    uint256 public calls;

    function setPremium(uint24 p, uint64 v) external {
        pips = p;
        validUntil = v;
        ++calls;
    }
}

contract RecMarket {
    function checkpoint(uint256, uint256) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Correctness review, 6 Nov 2026: report authentication on the simulation forwarder, and premium validity
///      after skipped epochs.
contract TremorReceiverTest is Test {
    address internal constant FORWARDER = address(0xF0);
    uint256 internal constant ORIGIN = 1_700_000_000;
    uint256 internal constant EPOCH = 7 days;
    uint64 internal constant GRACE = 1 days;
    address internal submitter = makeAddr("creSigner");

    RecHook internal hook;
    TremorReceiver internal rec;
    uint64 internal nextFrom = 1;

    function setUp() public {
        hook = new RecHook();
        rec = new TremorReceiver(FORWARDER, address(hook), address(new RecMarket()), ORIGIN, 0.5e18, GRACE, false);
    }

    function _report(uint256 ts, int256 lvr, uint256 volume) internal {
        bytes memory r = abi.encode(nextFrom, nextFrom + 9, uint64(ts), lvr, volume, uint32(1));
        nextFrom += 10;
        vm.prank(FORWARDER, submitter);
        rec.onReport("", r);
    }

    function test_reportSubmitter_rejectsOtherSigners() public {
        rec.setReportSubmitter(submitter);
        bytes memory metadata = abi.encode(bytes32(uint256(0xBAD)), bytes10("evil"), address(0xBEEF));
        bytes memory r = abi.encode(uint64(1), uint64(1), uint64(ORIGIN), int256(1), uint256(1), uint32(1));
        address evil = makeAddr("evil");
        vm.prank(FORWARDER, evil);
        vm.expectRevert(abi.encodeWithSelector(TremorReceiver.NotSubmitter.selector, evil));
        rec.onReport(metadata, r);
        // the configured signer goes through
        vm.prank(FORWARDER, submitter);
        rec.onReport(metadata, r);
        assertEq(rec.lastProcessedBlock(), 1);
    }

    function test_reportSubmitter_ownerOnly() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        rec.setReportSubmitter(address(1));
    }

    function test_nextEpoch_validUntilFollowsSchedule() public {
        vm.warp(ORIGIN + EPOCH + 1 hours);
        _report(ORIGIN + 1 days, 1e18, 100e18); // epoch 0: loss/volume 1% -> 0.5% -> capped at 3000 pips
        _report(ORIGIN + EPOCH + 30 minutes, 0, 1e18); // epoch 1 opens: closes epoch 0
        assertEq(hook.pips(), 3000);
        assertEq(hook.validUntil(), ORIGIN + 2 * EPOCH + GRACE, "valid to the end of epoch 1 plus grace");
    }

    function test_lateClose_doesNotExtendPastSchedule() public {
        _report(ORIGIN + 1 days, 1e18, 100e18);
        vm.warp(ORIGIN + EPOCH + 6 days); // the epoch-1 report lands 6 days late
        _report(ORIGIN + EPOCH + 30 minutes, 0, 1e18);
        assertEq(hook.validUntil(), ORIGIN + 2 * EPOCH + GRACE);
    }

    function test_skippedEpochs_closeAsZero() public {
        _report(ORIGIN + 1 days, 1e18, 100e18); // epoch 0 measured a loss
        vm.warp(ORIGIN + 2 * EPOCH + 1 hours);
        _report(ORIGIN + 2 * EPOCH + 30 minutes, 0, 1e18); // next report is in epoch 2: epoch 1 was skipped
        assertEq(hook.pips(), 0, "a two-week-old loss must not price epoch 2");
        assertEq(hook.validUntil(), ORIGIN + 3 * EPOCH + GRACE);
    }

    function test_replaySchedule_countsFromReceipt() public {
        TremorReceiver r2 =
            new TremorReceiver(FORWARDER, address(hook), address(new RecMarket()), ORIGIN, 0.5e18, GRACE, true);
        vm.warp(ORIGIN + 400 days); // backfilling old history
        vm.startPrank(FORWARDER, submitter);
        r2.onReport("", abi.encode(uint64(1), uint64(5), uint64(ORIGIN + 1 days), int256(1e18), uint256(100e18), uint32(1)));
        r2.onReport("", abi.encode(uint64(6), uint64(9), uint64(ORIGIN + EPOCH + 1), int256(0), uint256(1e18), uint32(1)));
        vm.stopPrank();
        assertEq(hook.pips(), 3000);
        assertEq(hook.validUntil(), block.timestamp + EPOCH + GRACE);
    }
}
