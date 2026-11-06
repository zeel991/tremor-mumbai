// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet price feed for the test-UNI/WETH pair (Sepolia has no Chainlink UNI/ETH feed).
///         Implements the AggregatorV3 read surface the hook uses; the owner sets the answer.
///         Used ONLY as the hook's UNI->WETH conversion guard. Settlement uses a real Chainlink feed.
contract FixedPriceFeed is Ownable {
    uint8 public constant decimals = 18;
    string public description;
    int256 internal answer;
    uint256 internal updatedAt;
    uint80 internal round;

    event AnswerSet(int256 answer, uint80 round);

    constructor(string memory description_, int256 answer_, address owner_) Ownable(owner_) {
        description = description_;
        _set(answer_);
    }

    function setAnswer(int256 answer_) external onlyOwner {
        _set(answer_);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answer, updatedAt, updatedAt, round);
    }

    function _set(int256 a) internal {
        require(a > 0, "answer");
        answer = a;
        updatedAt = block.timestamp;
        round += 1;
        emit AnswerSet(a, round);
    }
}
