// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC6909Claims} from "@uniswap/v4-core/src/interfaces/external/IERC6909Claims.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";
import {FixedPointMathLib as FPM} from "solady/utils/FixedPointMathLib.sol";

import {VarianceMarket} from "../../src/VarianceMarket.sol";
import {TremorAquaSwapVMRouter} from "../../src/aqua/TremorAquaSwapVMRouter.sol";
import {TremorVault} from "../../src/aqua/TremorVault.sol";
import {TremorHook} from "../../src/hook/TremorHook.sol";
import {TremorReceiver} from "../../src/hook/TremorReceiver.sol";
import {PoolOperator} from "../../src/helpers/PoolOperator.sol";
import {IVarianceMarket} from "../../src/interfaces/ITremor.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";

interface IFeedLite {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title Price-shock scenarios
/// @notice Two weeks of a market, run on a mainnet fork against the deployed Uniswap v4 PoolManager and 1inch Aqua,
///         with the live (non-replay) contracts. The UNI/ETH price is driven by a controllable Chainlink-style feed so
///         we can show how every part reacts when prices move:
///           week 1: the price moves; arbitrageurs move the pool; LPs lose; the CRE-style measurement is delivered
///                   to the receiver day by day; LONG for week 1 reprices as volatility arrives.
///           week 1 close: the measured loss sets the hook fee for week 2.
///           week 2: swappers pay the fee; the hook buys LONG for week 2 through Aqua/0x22; the price moves (or not);
///                   week 2 settles from the feed; the payout is donated to in-range LPs.
///         Writes one JSON line per step to data/scenarios/<name>.ndjson (the web app's stress-test page reads it).
///         Run: anvil --fork-url <mainnet rpc> --chain-id 1 &  forge test --match-path 'test/scenario/*' -vv
/// @dev Measurements are computed here with the same formula as the CRE workflow (cre/tremor-lvr/lvr.ts computeLvr),
///      valued at the scenario's own oracle price, and delivered through the forwarder address. Not a CRE run.
contract PriceShockScenario is Test {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant UNI = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    IPoolManager internal constant PM = IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90);
    address internal constant REAL_UNI_ETH = 0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e;
    address internal constant UNI_WHALE = 0x1a9C8182C09F50C8318d769245beA52c32BE35BC;
    address internal constant FORWARDER = address(0xF0);
    uint160 internal constant HOOK_FLAGS = 0x547;

    uint256 internal constant S = 1e18;
    uint256 internal constant V_CAP = 2.25e18;
    uint256 internal constant V_FWD = 0.33e18;
    uint256 internal constant SETS = 50e18;
    uint256 internal constant BUYBACK = 5e18;

    MockAggregatorV3 internal feed;
    VarianceMarket internal market;
    TremorAquaSwapVMRouter internal router;
    TremorVault internal vault;
    TremorHook internal hook;
    TremorReceiver internal receiver;
    PoolOperator internal op;
    PoolKey internal key;
    uint256 internal w1;
    uint256 internal w2;
    uint64 internal start;

    // running state for the report
    string internal name;
    string internal path;
    uint256 internal step;
    uint256 internal price; // oracle UNI/ETH, WAD
    int256 internal weekLvr;
    uint256 internal weekVolume;
    uint256 internal weekLpFees;
    uint64 internal lastBlock;
    uint256 internal week; // 1 or 2

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8545")));
        start = uint64(block.timestamp);
        (, int256 p,,,) = IFeedLite(REAL_UNI_ETH).latestRoundData();
        price = uint256(p);

        feed = new MockAggregatorV3(1);
        feed.push(int256(price), start - 1 hours);
        market = new VarianceMarket(WETH, address(feed), false, 0.05e18, 0.01e18, 2e15, 1e15, 1 hours, 7 days);
        router = new TremorAquaSwapVMRouter(AQUA, WETH, address(this), "Tremor SwapVM", "1");
        vault = new TremorVault(address(this), AQUA, address(router), address(market));
        address hookAddr = address(uint160(0x5C5C << 144) | HOOK_FLAGS);
        deployCodeTo("TremorHook.sol:TremorHook", abi.encode(PM, address(market), address(feed), address(this), uint48(100)), hookAddr);
        hook = TremorHook(hookAddr);
        receiver = new TremorReceiver(FORWARDER, address(hook), address(market), start, 0.5e18, 1 days, false);
        op = new PoolOperator(PM);
        key = PoolKey({
            currency0: Currency.wrap(UNI),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        PM.initialize(key, _sqrtOf(price));
        hook.setPoolKey(key);
        hook.setReceiver(address(receiver));
        // oracle-latency guard: quotes pause while the pool (block-start price) is >2% from the last round
        market.setReference(address(hook), 0.02e18);

        // tokens: LPs' liquidity, plus balances for the arbitrageur and swappers (this contract plays all of them)
        vm.prank(UNI_WHALE);
        IERC20(UNI).transfer(address(this), 250_000e18);
        deal(WETH, address(this), 5_000e18);
        IERC20(UNI).approve(address(op), type(uint256).max);
        IERC20(WETH).approve(address(op), type(uint256).max);
        IERC20(WETH).approve(address(router), type(uint256).max);
        op.addLiquidity(key, -887_220, 887_220, 1e21);

        // two consecutive weekly windows, each written into one Aqua strategy
        w1 = market.createWindow(start, start + 7 days, S, V_CAP, V_FWD);
        w2 = market.createWindow(start + 7 days, start + 14 days, S, V_CAP, V_FWD);
        deal(WETH, address(vault), 2 * (SETS + BUYBACK));
        vault.openWindow(w1, SETS, BUYBACK, start + 7 days, keccak256("scenario-w1"));
        vault.openWindow(w2, SETS, BUYBACK, start + 14 days, keccak256("scenario-w2"));
        hook.setCover(address(vault), address(router), w2); // the fee collected in week 2 buys week-2 cover
        receiver.setCoverWindow(w1);
        hook.setDripBlocks(10);
        lastBlock = uint64(block.number);
    }

    // ------------------------------------------------------------------ scenarios

    /// @notice Nothing much happens: the measured loss stays small, so the fee stays near zero and the hook buys
    ///         little or no cover.
    function test_scenario_calm() public {
        int16[6] memory wk1 = [int16(40), -30, 20, -40, 30, -20]; // daily moves in bps
        int16[6] memory wk2 = [int16(-30), 20, -20, 40, -30, 10];
        _run("calm", wk1, wk2);
    }

    /// @notice A crash in week 1 sets the fee to its cap; week 2 keeps crashing, so the cover pays in full.
    function test_scenario_crash() public {
        int16[6] memory wk1 = [int16(-600), 400, -1200, 500, -800, 300];
        int16[6] memory wk2 = [int16(-1000), 700, -1400, 600, -900, 500];
        _run("crash", wk1, wk2);
    }

    /// @notice A crash in week 1 sets the fee; week 2 is calm, so the cover pays little: the cost of insurance.
    function test_scenario_shock_then_calm() public {
        int16[6] memory wk1 = [int16(-600), 400, -1200, 500, -800, 300];
        int16[6] memory wk2 = [int16(-30), 20, -20, 40, -30, 10];
        _run("shock_then_calm", wk1, wk2);
    }

    /// @notice The weak case: a quiet week sets the fee near zero, so week 2's crash finds almost no cover.
    ///         The first shock after calm is barely insured; protection builds up the week after.
    function test_scenario_calm_then_crash() public {
        int16[6] memory wk1 = [int16(40), -30, 20, -40, 30, -20];
        int16[6] memory wk2 = [int16(-1000), 700, -1400, 600, -900, 500];
        _run("calm_then_crash", wk1, wk2);
    }

    /// @notice One 15% day in each otherwise quiet week: the fee and the payout scale with the size of the move
    ///         instead of switching fully on or off.
    function test_scenario_spike() public {
        int16[6] memory wk1 = [int16(20), -30, -1500, 40, -20, 30];
        int16[6] memory wk2 = [int16(-20), 30, 40, -1500, 20, -30];
        _run("spike", wk1, wk2);
    }

    // ------------------------------------------------------------------ the two weeks

    function _run(string memory scenario, int16[6] memory wk1, int16[6] memory wk2) internal {
        name = scenario;
        path = string.concat("../data/scenarios/", scenario, ".ndjson");
        if (vm.exists(path)) vm.removeFile(path);
        console2.log("==== scenario", scenario);
        week = 1;
        _snap("Week 1 opens: price steady, no fee yet");

        for (uint256 d; d < 6; ++d) {
            _day(wk1[d]);
            _report();
            market.checkpoint(w1, 64);
            _snap(string.concat("Week 1 day ", vm.toString(d + 1), ": price moves ", _bps(wk1[d])));
        }

        // week 1 ends: a round at/after t1 closes the window; the next measurement lands in epoch 1
        vm.warp(start + 7 days + 1 hours);
        vm.roll(block.number + 300);
        feed.push(int256(price), start + 7 days + 10 minutes);
        market.checkpoint(w1, 64);
        market.finalize(w1);
        _report(); // first report of week 2 closes week 1 and sets the fee
        receiver.setCoverWindow(w2);
        week = 2;
        weekLvr = 0;
        weekVolume = 0;
        weekLpFees = 0;
        _reported = 0;
        _reportedVol = 0;
        _snap("Week 1 closes: the measured loss sets the week-2 fee");

        for (uint256 d; d < 6; ++d) {
            _day(wk2[d]);
            hook.handleHookFees(new Currency[](0)); // permissionless; buys week-2 LONG with the fees collected
            market.checkpoint(w2, 64);
            _snap(string.concat("Week 2 day ", vm.toString(d + 1), ": price moves ", _bps(wk2[d])));
        }

        vm.warp(start + 14 days + 1 hours);
        vm.roll(block.number + 300);
        feed.push(int256(price), start + 14 days + 10 minutes);
        market.checkpoint(w2, 64);
        market.finalize(w2);
        if (hook.coverHeld(w2)) {
            hook.claimPayout(w2);
            vm.roll(block.number + 20);
            if (hook.dripReleased() > hook.dripDone()) hook.drip();
        }
        _snap("Week 2 settles: cover pays out and is donated to LPs");
    }

    /// @dev one day: the oracle moves, an arbitrageur moves the pool to it, swappers trade
    function _day(int16 moveBps) internal {
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 7200);
        price = uint256(int256(price) * (10_000 + moveBps) / 10_000);
        feed.push(int256(price), block.timestamp);
        // arbitrage: trade the pool to the new oracle price
        uint160 target = _sqrtOf(price);
        (uint160 cur,,,) = PM.getSlot0(key.toId());
        if (target != cur) _measured(target < cur, 0, target);
        // ordinary swappers: four round trips of 1 WETH
        for (uint256 i; i < 4; ++i) {
            uint256 uniOut = _measured(false, 1e18, 0);
            _measured(true, uniOut, 0);
        }
        // re-anchor to the oracle (swappers' round trips leave a small drift)
        (cur,,,) = PM.getSlot0(key.toId());
        if (target != cur) _measured(target < cur, 0, target);
        vm.roll(block.number + 1); // later calls (cover buy, readouts) happen in the next block
    }

    /// @dev swap and record the pool's side with the CRE formula (lvr.ts computeLvr), valued at the oracle price.
    ///      amountIn == 0 means "swap to the price limit". Returns the swapper's output amount.
    function _measured(bool zeroForOne, uint256 amountIn, uint160 limit) internal returns (uint256 out) {
        uint256 h0 = IERC6909Claims(address(PM)).balanceOf(address(hook), key.currency0.toId());
        uint256 h1 = IERC6909Claims(address(PM)).balanceOf(address(hook), key.currency1.toId());
        BalanceDelta d = amountIn == 0 ? op.swapToPrice(key, zeroForOne, limit) : op.swapExactIn(key, zeroForOne, amountIn);
        // pool's side = -(swapper delta) - (hook fee taken in that currency)
        int256 a0 = -int256(d.amount0()) - int256(IERC6909Claims(address(PM)).balanceOf(address(hook), key.currency0.toId()) - h0);
        int256 a1 = -int256(d.amount1()) - int256(IERC6909Claims(address(PM)).balanceOf(address(hook), key.currency1.toId()) - h1);
        int256 v0 = a0 * int256(price) / 1e18; // UNI valued in WETH at the oracle price
        int256 v1 = a1;
        int256 fee = (a0 > 0 ? v0 : v1) * 3000 / 1e6;
        weekLvr += fee - (v0 + v1);
        weekVolume += uint256(v0 < 0 ? -v0 : v0);
        weekLpFees += uint256(fee);
        out = uint256(int256(zeroForOne ? d.amount1() : d.amount0()));
    }

    /// @dev deliver today's measurement through the forwarder (what the CRE workflow writes each run)
    function _report() internal {
        uint64 toBlock = uint64(block.number);
        vm.prank(FORWARDER);
        receiver.onReport(
            "", abi.encode(lastBlock + 1, toBlock, uint64(block.timestamp), weekLvr - _reported, weekVolume - _reportedVol, uint32(1))
        );
        _reported = weekLvr;
        _reportedVol = weekVolume;
        lastBlock = toBlock;
    }

    int256 internal _reported;
    uint256 internal _reportedVol;

    // ------------------------------------------------------------------ readouts

    function _snap(string memory label) internal {
        uint256 id = week == 1 ? w1 : w2;
        IVarianceMarket.WindowView memory w = market.window(id);
        (uint160 sp,,,) = PM.getSlot0(key.toId());
        uint256 poolPrice = FPM.mulDiv(uint256(sp) * uint256(sp), 1e18, uint256(1) << 192);
        uint256 vol = w.finalized ? 0 : FPM.sqrt(market.projectedVariance(id) * 1e18) / 1e14; // bps
        uint256 longOut = _longPerWeth(id, w);
        uint256 held = IERC20(market.window(w2).long).balanceOf(address(hook));
        IVarianceMarket.WindowView memory v2 = market.window(w2);
        uint256 fee = block.timestamp <= hook.premiumValidUntil() ? hook.premiumPips() : 0;

        string memory line = string.concat(
            '{"scenario":"', name, '","step":', vm.toString(step), ',"label":"', label,
            '","day":', vm.toString((block.timestamp - start) / 1 days),
            ',"oracle":', vm.toString(price), ',"pool":', vm.toString(poolPrice),
            ',"feePips":', vm.toString(fee), ',"volBps":', vm.toString(vol),
            ',"longPerWeth":', vm.toString(longOut), ',"week":', vm.toString(week)
        );
        line = string.concat(
            line,
            ',"weekLvr":', vm.toString(weekLvr), ',"weekVolume":', vm.toString(weekVolume),
            ',"weekLpFees":', vm.toString(weekLpFees),
            ',"hookLong":', vm.toString(held), ',"hookWethSpent":', vm.toString(_spent()),
            ',"w1Payout":', vm.toString(market.window(w1).finalized ? market.window(w1).payoutLong : 0),
            ',"w2Payout":', vm.toString(v2.finalized ? v2.payoutLong : 0),
            ',"donated":', vm.toString(hook.dripDone()), "}"
        );
        vm.writeLine(path, line);

        console2.log(string.concat("[", vm.toString(step), "] ", label));
        console2.log("   oracle / pool UNI-ETH (1e-6)", price / 1e12, poolPrice / 1e12);
        console2.log("   hook fee pips", fee, "| week vol bps", vol);
        console2.log("   1 WETH buys LONG (1e-4)", longOut / 1e14, "| hook LONG held (1e-4)", held / 1e14);
        console2.log("   measured loss this week (1e-6 WETH)", uint256(weekLvr > 0 ? weekLvr : int256(0)) / 1e12);
        console2.log("   donated to LPs (1e-6 WETH)", hook.dripDone() / 1e12);
        ++step;
    }

    /// @dev WETH the week-2 strategy received from takers (the hook is the only buyer here): Aqua balance - buyback
    function _spent() internal view returns (uint256) {
        (uint248 b,) = IAqua(AQUA).rawBalances(address(vault), address(router), vault.strategyHash(w2), WETH);
        return uint256(b) > BUYBACK ? uint256(b) - BUYBACK : 0;
    }

    function _longPerWeth(uint256 id, IVarianceMarket.WindowView memory w) internal returns (uint256) {
        if (w.finalized) return 0;
        try router.quote(vault.currentOrder(id), WETH, w.long, 1e18, _traits()) returns (uint256, uint256 o, bytes32) {
            return o;
        } catch {
            return 0;
        }
    }

    function _traits() internal view returns (bytes memory) {
        TakerTraitsLib.Args memory a;
        a.taker = address(this);
        a.isExactIn = true;
        a.isFirstTransferFromTaker = true;
        a.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(a);
    }

    function _sqrtOf(uint256 p) internal pure returns (uint160) {
        return uint160(FPM.sqrt(FPM.mulDiv(p, uint256(1) << 192, 1e18)));
    }

    function _bps(int16 b) internal pure returns (string memory) {
        int256 x = b;
        string memory sign = x < 0 ? "-" : "+";
        uint256 a = uint256(x < 0 ? -x : x);
        return string.concat(sign, vm.toString(a / 100), ".", a % 100 < 10 ? "0" : "", vm.toString(a % 100), "%");
    }
}
