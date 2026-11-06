// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";

import {IVarianceMarket, ITremorVault} from "../interfaces/ITremor.sol";

/// @title TremorVault
/// @notice The writer's maker (docs/spec.md §6.5). Mints complete sets in VarianceMarket (S WETH each) and ships ONE
///         Aqua strategy per window holding [WETH, LONG, SHORT]. nSets*S WETH backs 2*nSets claims, and because every
///         claim token is a fully backed half of a set, over-committing the strategy cannot create unbacked liability.
/// @dev Approves the Aqua REGISTRY (never the router). Program: Salt(0x14) . Deadline(0x0d) . CappedPayoffCurve(0x22).
contract TremorVault is ITremorVault, Ownable {
    using SafeERC20 for IERC20;

    uint8 internal constant OP_DEADLINE = 0x0d;
    uint8 internal constant OP_SALT = 0x14;
    uint8 internal constant OP_CAPPED_PAYOFF_CURVE = 0x22;

    IAqua public immutable aqua;
    address public immutable router;
    IVarianceMarket public immutable market;
    IERC20 public immutable weth;

    mapping(uint256 => ISwapVM.Order) internal _orders;
    mapping(uint256 => bytes32) public strategyHash;
    mapping(uint256 => bool) public docked; // strategy removed from Aqua (no more quotes or fills)

    error WindowAlreadyOpen();
    error WindowNotOpen();

    constructor(address owner_, address aqua_, address router_, address market_) Ownable(owner_) {
        aqua = IAqua(aqua_);
        router = router_;
        market = IVarianceMarket(market_);
        weth = IERC20(market.WETH());
        weth.forceApprove(market_, type(uint256).max);
        weth.forceApprove(aqua_, type(uint256).max);
    }

    /// @notice Mint nSets complete sets and ship them (plus wethForBuybacks of WETH liquidity) as one Aqua strategy.
    /// @dev The vault must already hold nSets*S + wethForBuybacks WETH.
    function openWindow(uint256 id, uint256 nSets, uint256 wethForBuybacks, uint64 deadline, bytes32 salt)
        external
        onlyOwner
    {
        if (strategyHash[id] != bytes32(0)) revert WindowAlreadyOpen();
        IVarianceMarket.WindowView memory w = market.window(id);
        market.mintSet(id, nSets);
        IERC20(w.long).forceApprove(address(aqua), type(uint256).max);
        IERC20(w.short).forceApprove(address(aqua), type(uint256).max);

        bytes memory program = abi.encodePacked(
            OP_SALT,
            uint8(32),
            salt,
            OP_DEADLINE,
            uint8(5),
            uint40(deadline),
            OP_CAPPED_PAYOFF_CURVE,
            uint8(120),
            address(market),
            uint64(id),
            address(weth),
            w.long,
            w.short,
            uint128(nSets),
            uint128(nSets)
        );
        ISwapVM.Order memory order = MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: address(this),
                receiver: address(0),
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );
        _orders[id] = order;

        address[] memory tokens = _tokens(w);
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = wethForBuybacks;
        amounts[1] = nSets;
        amounts[2] = nSets;
        bytes32 h = aqua.ship(router, abi.encode(order), tokens, amounts);
        strategyHash[id] = h;
        emit WindowOpened(id, h, nSets, wethForBuybacks);
    }

    /// @notice Stop quoting: dock the strategy (Aqua requires listing every token). Once per window.
    function closeWindow(uint256 id) external onlyOwner {
        _dock(id);
    }

    /// @notice After finalize: dock the strategy if it is still shipped (so no stale order stays visible in Aqua),
    ///         then redeem whatever LONG/SHORT inventory the vault still holds.
    function settle(uint256 id) external onlyOwner {
        IVarianceMarket.WindowView memory w = market.window(id);
        if (!w.finalized) revert IVarianceMarket.NotFinalized();
        if (strategyHash[id] != bytes32(0) && !docked[id]) _dock(id);
        uint256 l = IERC20(w.long).balanceOf(address(this));
        uint256 s = IERC20(w.short).balanceOf(address(this));
        if (l > 0 || s > 0) market.redeem(id, l, s);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        weth.safeTransfer(to, amount);
    }

    function currentOrder(uint256 id) external view returns (ISwapVM.Order memory) {
        return _orders[id];
    }

    function currentOrderEncoded(uint256 id) external view returns (bytes memory) {
        return abi.encode(_orders[id]);
    }

    /// @notice WETH the market holds for the window right now (falls as claims are redeemed), and complete sets
    ///         issued and not burned as sets. After settlement, one-sided redemptions do not reduce `setsIssued`.
    function collateralView(uint256 id) external view returns (uint256 lockedWeth, uint256 setsIssued) {
        lockedWeth = market.lockedWeth(id);
        setsIssued = market.window(id).setsOutstanding;
    }

    function _dock(uint256 id) internal {
        bytes32 h = strategyHash[id];
        if (h == bytes32(0) || docked[id]) revert WindowNotOpen();
        docked[id] = true;
        aqua.dock(router, h, _tokens(market.window(id)));
        emit WindowClosed(id, h);
    }

    function _tokens(IVarianceMarket.WindowView memory w) internal view returns (address[] memory tokens) {
        tokens = new address[](3);
        tokens[0] = address(weth);
        tokens[1] = w.long;
        tokens[2] = w.short;
    }
}
