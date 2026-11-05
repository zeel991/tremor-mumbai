// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Mimics a Chainlink AggregatorProxy:
///  - proxy roundId = (phaseId << 64) | aggregatorRoundId, aggregator round ids start at 1 in every phase;
///  - getRoundData for a round that does not exist (k == 0 or past the phase's latest round, or an unknown phase)
///    returns ALL ZEROS and does not revert (matches the real proxy);
///  - latestRoundData reports the current phase in the high bits of roundId;
///  - the phase can be switched; rounds of older phases stay readable through their phase id.
contract MockAggregatorV3 {
    struct R {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public constant decimals = 18;
    uint16 public phaseId;
    mapping(uint16 => R[]) internal _rounds; // index k-1
    bool public revertGetRoundData;

    constructor(uint16 phase) {
        phaseId = phase;
    }

    function setPhase(uint16 phase) external {
        phaseId = phase;
    }

    function setRevertGetRoundData(bool v) external {
        revertGetRoundData = v;
    }

    /// @notice append a round to the CURRENT phase; returns its full proxy round id
    function push(int256 answer, uint256 updatedAt) public returns (uint80) {
        _rounds[phaseId].push(R(answer, updatedAt));
        return (uint80(phaseId) << 64) | uint80(_rounds[phaseId].length);
    }

    function pushMany(int256[] calldata answers, uint256[] calldata updatedAts) external {
        require(answers.length == updatedAts.length, "len");
        for (uint256 i; i < answers.length; ++i) {
            push(answers[i], updatedAts[i]);
        }
    }

    function roundCount(uint16 phase) external view returns (uint256) {
        return _rounds[phase].length;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        R[] storage rs = _rounds[phaseId];
        uint80 k = uint80(rs.length);
        uint80 id = (uint80(phaseId) << 64) | k;
        if (k == 0) return (id, 0, 0, 0, id);
        R storage r = rs[k - 1];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!revertGetRoundData, "mock: revert");
        uint16 phase = uint16(roundId >> 64);
        uint64 k = uint64(roundId);
        R[] storage rs = _rounds[phase];
        if (k == 0 || k > rs.length) return (0, 0, 0, 0, 0);
        R storage r = rs[k - 1];
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }
}
