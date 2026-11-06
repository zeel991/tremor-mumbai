// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared interfaces for Tremor (see docs/spec.md §6). Every component builds against these.

enum Side {
    LONG,
    SHORT
}

interface IVarianceMarket {
    struct WindowView {
        uint64 t0;
        uint64 t1;
        uint256 S; // WETH wei paid by one whole LONG + one whole SHORT
        uint256 vCap; // annualized variance cap, WAD
        uint256 vFwd; // writer's forward variance for quoting, WAD (annualized)
        uint16 phaseId;
        uint80 lastRound;
        uint256 lastAnswer;
        uint64 lastUpdatedAt;
        uint256 q; // sum of squared log returns, WAD (not annualized)
        uint256 setsOutstanding; // claim-token wei
        bool finalized;
        uint256 payoutLong; // WETH wei per whole LONG token
        address long;
        address short;
    }

    event WindowCreated(uint256 indexed id, uint64 t0, uint64 t1, address long, address short, uint16 phaseId, uint256 p0);
    event SetMinted(uint256 indexed id, address indexed to, uint256 n, uint256 wethIn);
    event SetBurned(uint256 indexed id, address indexed from, uint256 n, uint256 wethOut);
    event Checkpoint(uint256 indexed id, uint80 fromRound, uint80 toRound, uint256 q);
    event Finalized(uint256 indexed id, uint256 variance, uint256 payoutLong);
    event Redeemed(uint256 indexed id, address indexed who, uint256 nLong, uint256 nShort, uint256 wethOut);
    event FallbackSettled(uint256 indexed id, uint256 vFwd, uint256 payoutLong);

    error WindowTooShort();
    error PastWindow();
    error NotFinalized();
    error AlreadyFinalized();
    error TooEarly();
    error TooLate();
    error PhaseChanged();
    error BadRound(uint80 roundId);
    error NoQuote();
    error InsufficientInventory();
    error UnknownWindow();
    /// @dev a newer Chainlink round is public but not yet ingested: call checkpoint() first
    error Stale();
    error OracleGap(uint80 roundId);
    error NotStuck();
    /// @dev the market price (reference) has moved more than MAX_DEVIATION from the last Chainlink round: a round is
    ///      about to land, so quotes pause instead of selling at the old price (oracle-latency guard)
    error PriceMoved();

    event ReferenceSet(address priceReference, uint256 maxDeviation);

    function WETH() external view returns (address);
    function ALLOW_PAST_WINDOWS() external view returns (bool);
    function createWindow(uint64 t0, uint64 t1, uint256 S, uint256 vCap, uint256 vFwd) external returns (uint256 id);
    function mintSet(uint256 id, uint256 n) external;
    function burnSet(uint256 id, uint256 n) external;
    function checkpoint(uint256 id, uint256 maxRounds) external returns (uint256 ingested);
    function finalize(uint256 id) external;
    function settleFallback(uint256 id) external;
    function redeem(uint256 id, uint256 nLong, uint256 nShort) external returns (uint256 wethOut);

    function window(uint256 id) external view returns (WindowView memory);
    function windowCount() external view returns (uint256);
    function lockedWeth(uint256 id) external view returns (uint256);
    function H_MIN() external view returns (uint256);
    function KAPPA() external view returns (uint256);
    function projectedVariance(uint256 id) external view returns (uint256 vProj);
    /// @notice true when every public Chainlink round before t1 has been ingested (quotes use current information)
    function caughtUp(uint256 id) external view returns (bool);

    /// @param skewUnits inventory skew for `side` in whole-token units * 1e18 (WAD), positive = maker has sold more of `side`
    /// @param amount exact input (exactIn) or exact output (!exactIn), in token wei
    function quote(uint256 id, Side side, bool takerBuys, bool exactIn, uint256 amount, int256 skewUnits)
        external
        view
        returns (uint256 amountIn, uint256 amountOut);
}

interface ITremorVault {
    event WindowOpened(uint256 indexed id, bytes32 strategyHash, uint256 nSets, uint256 wethForBuybacks);
    event WindowClosed(uint256 indexed id, bytes32 strategyHash);

    function openWindow(uint256 id, uint256 nSets, uint256 wethForBuybacks, uint64 deadline, bytes32 salt) external;
    function closeWindow(uint256 id) external;
    function settle(uint256 id) external;
    /// @notice writers deposit WETH for shares, and redeem shares for WETH, only while no window is open
    function deposit(uint256 assets, address to) external returns (uint256 shares);
    function redeem(uint256 shares, address to) external returns (uint256 assets);
    function totalAssets() external view returns (uint256);
    function openWindows() external view returns (uint256);
    function docked(uint256 id) external view returns (bool);
    /// @dev returns abi-encoded ISwapVM.Order (kept as bytes so non-swap-vm code can call it)
    function currentOrderEncoded(uint256 id) external view returns (bytes memory);
    function strategyHash(uint256 id) external view returns (bytes32);
}

/// @notice A market price for the settlement feed's pair, used to pause quotes while a Chainlink round is pending.
interface IPriceReference {
    /// @return priceWad the reference price as an 18-decimal number in the feed's units; ok = false if unavailable
    function referencePrice() external view returns (uint256 priceWad, bool ok);
}

interface ITremorHook {
    event PremiumSet(uint24 pips, uint64 validUntil);
    event CoverBought(uint256 indexed windowId, uint256 wethIn, uint256 longOut);
    event PayoutClaimed(uint256 indexed windowId, uint256 wethOut);
    event Dripped(uint256 amount, uint256 remaining);

    function setPremium(uint24 pips, uint64 validUntil) external;
    function premiumPips() external view returns (uint24);
    function premiumValidUntil() external view returns (uint64);
}

interface ITremorReceiver {
    event Measured(uint64 fromBlock, uint64 toBlock, int256 lvrUsdWad, uint256 volumeUsdWad, uint32 nSwaps, uint256 epoch);
    event EpochClosed(uint256 indexed epoch, int256 lvrUsdWad, uint256 volumeUsdWad, uint24 pips);

    function lastProcessedBlock() external view returns (uint64);
}
