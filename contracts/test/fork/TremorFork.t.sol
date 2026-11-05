// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC6909Claims} from "@uniswap/v4-core/src/interfaces/external/IERC6909Claims.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {TremorSystem} from "../../script/TremorSystem.sol";
import {TremorHook} from "../../src/hook/TremorHook.sol";
import {IVarianceMarket, ITremorHook} from "../../src/interfaces/ITremor.sol";

/// @notice Fork gates A1, A2, U1, C1, E2E (docs/spec.md §12) against the DEPLOYED Aqua registry, v4 PoolManager and
///         Chainlink UNI/ETH feed on an Ethereum mainnet fork.
///         Run: anvil --fork-url <mainnet rpc> --chain-id 1 &  forge test --match-path 'test/fork/*' -vv
contract TremorForkTest is Test, TremorSystem {
    using CurrencyLibrary for Currency;

    address internal constant UNI_WHALE = 0x1a9C8182C09F50C8318d769245beA52c32BE35BC; // Uniswap timelock
    uint256 internal constant SETS = 50e18; // per window
    uint256 internal constant BUYBACK = 5e18;

    Sys internal s;
    address internal alice = makeAddr("alice");

    function _deployHook(address market, address owner) internal override returns (TremorHook) {
        address hookAddr = address(uint160(0x7E7E << 144) | HOOK_FLAGS);
        deployCodeTo(
            "TremorHook.sol:TremorHook", abi.encode(IPoolManager(POOL_MANAGER), market, UNI_ETH_FEED, owner), hookAddr
        );
        return TremorHook(hookAddr);
    }

    function setUp() public {
        // default: the local anvil fork (anvil --fork-url <mainnet rpc> --chain-id 1); FORK_BLOCK pins a block if set
        string memory url = vm.envOr("FORK_URL", string("http://127.0.0.1:8545"));
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, forkBlock);
        Sys memory m = _deployCore(address(this));
        _createWindows(m);
        _initPool(m);

        // liquidity: UNI from the timelock, WETH via deal
        vm.prank(UNI_WHALE);
        IERC20(UNI).transfer(address(this), 200_000e18);
        deal(WETH, address(this), 1_000e18);
        _seedLiquidity(m, 1e21);

        deal(WETH, address(m.vault), 3 * (SETS + BUYBACK));
        _openWindows(m, SETS, BUYBACK);
        s = m;

        deal(WETH, alice, 100e18);
        vm.prank(UNI_WHALE);
        IERC20(UNI).transfer(alice, 50_000e18);
    }

    // ------------------------------------------------------------------ helpers

    function _traits(address taker, uint256 minOut, bool withThreshold) internal pure returns (bytes memory) {
        TakerTraitsLib.Args memory a;
        a.taker = taker;
        a.isExactIn = true;
        a.isFirstTransferFromTaker = true;
        a.useTransferFromAndAquaPush = true;
        if (withThreshold) a.threshold = abi.encodePacked(minOut);
        return TakerTraitsLib.build(a);
    }

    function _ingestAll(uint256 id) internal returns (uint256 total) {
        for (uint256 i; i < 40; ++i) {
            uint256 n = s.market.checkpoint(id, 64);
            total += n;
            if (n < 64) break;
        }
    }

    // ------------------------------------------------------------------ A1

    function test_A1_routerSizeAndOpcodeAppended() public view {
        uint256 size = address(s.router).code.length;
        console2.log("TremorAquaSwapVMRouter runtime bytes:", size);
        assertLe(size, 24_576, "EIP-170");
        assertEq(address(s.router.AQUA()), AQUA, "router uses the deployed Aqua registry");
        assertTrue(s.vault.strategyHash(s.live) != bytes32(0), "strategy shipped on deployed Aqua");
    }

    // ------------------------------------------------------------------ A2

    function test_A2_quoteEqualsSwap_buyAndSellThrough0x22() public {
        ISwapVM.Order memory order = s.vault.currentOrder(s.live);
        IVarianceMarket.WindowView memory w = s.market.window(s.live);
        uint256[4] memory sizes = [uint256(0.01e18), 0.1e18, 0.5e18, 1e18];

        vm.startPrank(alice);
        IERC20(WETH).approve(address(s.router), type(uint256).max);
        IERC20(w.long).approve(address(s.router), type(uint256).max);
        for (uint256 i; i < sizes.length; ++i) {
            (uint256 qIn, uint256 qOut,) = s.router.quote(order, WETH, w.long, sizes[i], _traits(alice, 0, false));
            uint256 balBefore = IERC20(w.long).balanceOf(alice);
            (uint256 sIn, uint256 sOut,) = s.router.swap(order, WETH, w.long, sizes[i], _traits(alice, qOut, true));
            assertEq(sIn, qIn, "quote==swap amountIn (I4)");
            assertEq(sOut, qOut, "quote==swap amountOut (I4)");
            assertEq(IERC20(w.long).balanceOf(alice) - balBefore, sOut, "LONG delivered via Aqua pull");
            console2.log("buy WETH in", sIn, "LONG out", sOut);
        }
        // sell half the LONG back (taker sells; bid side)
        uint256 sellAmt = IERC20(w.long).balanceOf(alice) / 2;
        (uint256 qIn2, uint256 qOut2,) = s.router.quote(order, w.long, WETH, sellAmt, _traits(alice, 0, false));
        uint256 wethBefore = IERC20(WETH).balanceOf(alice);
        (uint256 sIn2, uint256 sOut2,) = s.router.swap(order, w.long, WETH, sellAmt, _traits(alice, qOut2, true));
        vm.stopPrank();
        assertEq(sIn2, qIn2);
        assertEq(sOut2, qOut2);
        assertEq(IERC20(WETH).balanceOf(alice) - wethBefore, sOut2, "WETH paid from vault via Aqua");
        console2.log("sell LONG in", sIn2, "WETH out", sOut2);

        // collateral: sets*S WETH locked in the market backs 2*sets claims (I1)
        (uint256 actual, uint256 claims) = s.vault.collateralView(s.live);
        assertEq(actual, SETS * S / 1e18);
        assertEq(claims, 2 * SETS);
        assertGe(s.market.lockedWeth(s.live), actual);
    }

    function test_A2_buyShortAndInventoryGuard() public {
        ISwapVM.Order memory order = s.vault.currentOrder(s.live);
        IVarianceMarket.WindowView memory w = s.market.window(s.live);
        vm.startPrank(alice);
        IERC20(WETH).approve(address(s.router), type(uint256).max);
        (, uint256 qOut,) = s.router.quote(order, WETH, w.short, 1e18, _traits(alice, 0, false));
        (, uint256 sOut,) = s.router.swap(order, WETH, w.short, 1e18, _traits(alice, qOut, true));
        assertEq(sOut, qOut);
        assertGt(sOut, 0);
        // a buy larger than the shipped inventory must not quote
        vm.expectRevert();
        s.router.quote(order, WETH, w.short, 60e18, _traits(alice, 0, false));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ C1

    function test_C1_settleRealWeeksFromChainlinkRounds() public {
        uint256 nOct = _ingestAll(s.oct2025);
        uint256 nFeb = _ingestAll(s.feb2025);
        s.market.finalize(s.oct2025);
        s.market.finalize(s.feb2025);
        IVarianceMarket.WindowView memory o = s.market.window(s.oct2025);
        IVarianceMarket.WindowView memory f = s.market.window(s.feb2025);
        uint256 vOct = FPM.mulDiv(o.q, 31_536_000, 7 days);
        uint256 vFeb = FPM.mulDiv(f.q, 31_536_000, 7 days);
        console2.log("Oct 2025 week: rounds", nOct);
        console2.log("  annualized variance (WAD)", vOct, "vol bps", FPM.sqrt(vOct * 1e18) / 1e14);
        console2.log("  LONG payout per token (wei)", o.payoutLong);
        console2.log("Feb 2025 week: rounds", nFeb);
        console2.log("  annualized variance (WAD)", vFeb, "vol bps", FPM.sqrt(vFeb * 1e18) / 1e14);
        console2.log("  LONG payout per token (wei)", f.payoutLong);
        assertGt(nOct, 0);
        assertGt(nFeb, 0);
        assertLe(o.payoutLong, S);
        assertLe(f.payoutLong, S);
        assertTrue(o.finalized && f.finalized);
    }

    // ------------------------------------------------------------------ U1

    function test_U1_hookFeeMintsClaimsAndBuysCover() public {
        vm.prank(address(s.receiver));
        s.hook.setPremium(3000, uint64(block.timestamp + 7 days));

        vm.startPrank(alice);
        IERC20(UNI).approve(address(s.operator), type(uint256).max);
        IERC20(WETH).approve(address(s.operator), type(uint256).max);
        BalanceDelta d = s.operator.swapExactIn(s.key, true, 10_000e18); // UNI -> WETH; unspecified = WETH
        s.operator.swapExactIn(s.key, false, 10e18); // WETH -> UNI; unspecified = UNI
        vm.stopPrank();

        uint256 wethClaims = IERC6909Claims(POOL_MANAGER).balanceOf(address(s.hook), Currency.wrap(WETH).toId());
        uint256 uniClaims = IERC6909Claims(POOL_MANAGER).balanceOf(address(s.hook), Currency.wrap(UNI).toId());
        uint256 netOut = uint256(uint128(d.amount1()));
        // fee = ceil(gross * 3000 / 1e6), swapper receives gross - fee
        uint256 expected = FPM.mulDivUp(netOut, 3000, 997_000);
        console2.log("swapper WETH out", netOut, "hook WETH claims", wethClaims);
        assertApproxEqAbs(wethClaims, expected, 2, "hook fee on unspecified currency");
        assertGt(uniClaims, 0, "fee in UNI for the other direction");

        // cover is bought at the start of the replay week: priced on the writer's forward, rounds not yet ingested
        vm.warp(block.timestamp + 1 hours);
        s.hook.handleHookFees(new Currency[](0));
        uint256 longHeld = IERC20(s.market.window(s.oct2025).long).balanceOf(address(s.hook));
        console2.log("hook LONG held after handleHookFees", longHeld);
        assertGt(longHeld, 0, "cover bought through Aqua/0x22");
        assertEq(IERC6909Claims(POOL_MANAGER).balanceOf(address(s.hook), Currency.wrap(WETH).toId()), 0);
        assertEq(IERC6909Claims(POOL_MANAGER).balanceOf(address(s.hook), Currency.wrap(UNI).toId()), 0);
    }

    function test_U1_premiumFailSafeAndAccess() public {
        assertEq(s.hook.premiumPips(), 0);
        vm.expectRevert(TremorHook.OnlyReceiver.selector);
        s.hook.setPremium(100, uint64(block.timestamp + 1));
        vm.prank(address(s.receiver));
        vm.expectRevert(TremorHook.PremiumTooHigh.selector);
        s.hook.setPremium(3001, uint64(block.timestamp + 1));

        vm.prank(address(s.receiver));
        s.hook.setPremium(3000, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 2); // stale -> no fee
        vm.startPrank(alice);
        IERC20(UNI).approve(address(s.operator), type(uint256).max);
        s.operator.swapExactIn(s.key, true, 1_000e18);
        vm.stopPrank();
        assertEq(IERC6909Claims(POOL_MANAGER).balanceOf(address(s.hook), Currency.wrap(WETH).toId()), 0);
    }

    // ------------------------------------------------------------------ E2E

    function test_E2E_measure_charge_cover_settle_donate() public {
        // F2: CRE reports (delivered by the CRE mock forwarder) for two epochs -> closing the first sets the premium
        uint64 b0 = 23_520_000;
        s.receiver.setStartBlock(b0);
        bytes memory r1 = abi.encode(b0 + 1, b0 + 1_200, uint64(OCT_2025 + 3 days), int256(60_000e18), uint256(20_000_000e18), uint32(900));
        bytes memory r2 = abi.encode(b0 + 1_201, b0 + 2_400, uint64(OCT_2025 + 8 days), int256(1_000e18), uint256(500_000e18), uint32(40));
        vm.prank(CRE_MOCK_FORWARDER);
        s.receiver.onReport("", r1);
        vm.prank(CRE_MOCK_FORWARDER);
        s.receiver.onReport("", r2);
        // pips = 0.5 * 60_000 / 20_000_000 * 1e6 = 1500
        assertEq(s.hook.premiumPips(), 1500, "premium from measured LVR");

        // non-contiguous report is rejected
        vm.prank(CRE_MOCK_FORWARDER);
        vm.expectRevert();
        s.receiver.onReport("", abi.encode(b0 + 9_999, b0 + 10_000, uint64(OCT_2025 + 9 days), int256(0), uint256(1), uint32(1)));

        // F3: swaps pay the hook fee
        vm.startPrank(alice);
        IERC20(UNI).approve(address(s.operator), type(uint256).max);
        IERC20(WETH).approve(address(s.operator), type(uint256).max);
        for (uint256 i; i < 5; ++i) {
            s.operator.swapExactIn(s.key, true, 5_000e18);
            s.operator.swapExactIn(s.key, false, 12e18);
        }
        vm.stopPrank();

        // F4: buy cover on the Oct-2025 replay window, priced on the writer's forward (rounds not yet ingested)
        vm.warp(block.timestamp + 1 hours);
        uint256 wethBefore = IERC20(WETH).balanceOf(address(s.vault));
        s.hook.handleHookFees(new Currency[](0));
        uint256 wethSpent = IERC20(WETH).balanceOf(address(s.vault)) - wethBefore;
        IVarianceMarket.WindowView memory w = s.market.window(s.oct2025);
        uint256 longHeld = IERC20(w.long).balanceOf(address(s.hook));
        assertGt(longHeld, 0);

        // F5: ingest the real Oct-2025 rounds, settle, claim payout, drip-donate to in-range LPs
        _ingestAll(s.oct2025);
        s.market.finalize(s.oct2025);
        s.hook.claimPayout(s.oct2025);
        uint256 total = s.hook.dripTotal();
        console2.log("cover premium WETH spent / LONG held", wethSpent, longHeld);
        console2.log("payout WETH", total);
        assertEq(total, FPM.mulDiv(longHeld, s.market.window(s.oct2025).payoutLong, 1e18));
        vm.roll(block.number + 150);
        vm.expectEmit(false, false, false, false, address(s.hook));
        emit ITremorHook.Dripped(0, 0);
        s.hook.drip();
        vm.roll(block.number + 300);
        s.hook.drip();
        assertEq(s.hook.dripDone(), total, "everything donated after dripBlocks");

        // F6: writer closes and settles
        s.vault.closeWindow(s.oct2025);
        uint256 before = IERC20(WETH).balanceOf(address(s.vault));
        s.vault.settle(s.oct2025);
        assertGt(IERC20(WETH).balanceOf(address(s.vault)), before);
    }
}
