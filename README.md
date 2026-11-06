# Tremor: hook-funded variance cover for Uniswap LPs

ETHGlobal Mumbai 2026. Built from an empty repo after kickoff; prior work is disclosed in [`PRIOR_WORK.md`](PRIOR_WORK.md), and AI use in [`AI_USAGE.md`](AI_USAGE.md).

> **Tremor is a Uniswap v4 hook that measures LP adverse selection with Chainlink CRE, buys capped variance on 1inch Aqua, and returns high-volatility payouts to the pool's in-range liquidity.**
>
> **Why:** in UNI/WETH 0.3% on Ethereum, our Binance-price markout estimates arbitrage loss equal to 93% of LP fees ($10.02M of $10.74M over 103 weeks, excluding one documented outlier week). LP net was negative in 14 of the 104 weeks. In the worst, 6 Oct 2025, measured loss was $172,486 against $34,971 of fees: LP net −$137,516.
>
> Tremor works in three steps:
> 1. It measures each window's arbitrage loss with **Chainlink CRE**.
> 2. It prices a capped **Uniswap v4 hook fee** from that measurement.
> 3. It spends the fee on **variance cover**: LONG claims on realized UNI/ETH variance, sold out of one **1inch Aqua** strategy through a new **SwapVM instruction**. The cover settles on oracle-sampled variance (every Chainlink UNI/ETH round in the week) and is **donated to the pool's current in-range liquidity** (not necessarily the LPs who took the loss).

The method behind these numbers: every swap valued at Binance 1-minute prices ([`data/README.md`](data/README.md)). This is our measurement, not a third-party figure.

```
 CRE (hourly) ─► TremorReceiver ─► hook.premiumPips ─► swaps pay a HOOK fee (ERC-6909 claims)
                                                          │ handleHookFees(): redeem → UNI→WETH → buy LONG
 TremorVault ── ships ONE Aqua strategy [WETH, LONG, SHORT] ◄── TremorAquaSwapVMRouter (SwapVM v1.0.2 + 0x22)
 VarianceMarket ◄── Chainlink UNI/ETH rounds (every round, ≥7-day windows) ─► finalize ─► LONG pays ─► drip donate() to LPs
```

## What each sponsor's technology does here

| Sponsor | Integration | Where |
|---|---|---|
| **1inch Aqua / SwapVM** | A new SwapVM instruction, **`CappedPayoffCurve`, at index `0x22`**, appended after swap-vm v1.0.2's 34 official opcodes (indices unchanged). It reads both legs' Aqua balances under the order hash and prices the trade through `VarianceMarket.quote`, so `quote` and `swap` behave identically. The router is a redeployment of AquaSwapVMRouter v1.0.2 plus `0x22`, which the prize rules allow, built against the **deployed Aqua registry**. One strategy holds `[WETH, LONG, SHORT]`. Every claim is half of a fully backed set, so **N WETH backs 2N claims** and over-committing can't create unbacked liability. | [`CappedPayoffCurve.sol:25`](contracts/src/aqua/CappedPayoffCurve.sol), [`TremorAquaSwapVMRouter.sol:17,37`](contracts/src/aqua/TremorAquaSwapVMRouter.sol), [`TremorVault.sol:47,103`](contracts/src/aqua/TremorVault.sol) |
| **Uniswap v4** | A hook **fee**, not an LP fee: OpenZeppelin `BaseHookFee`, `afterSwap` + `afterSwapReturnDelta` (flags `0x44`), taken on the unspecified currency as ERC-6909 claims. A stale premium charges nothing. `handleHookFees` redeems the claims, converts UNI to WETH in the same pool (as a self-swap, with a price limit from Chainlink), then buys cover on Aqua **outside** the unlock. Payouts are drip-`donate`d to in-range LPs. Complementary to Uniswap Labs' VolatilePair (an LP-fee curve that only Labs can deploy): Tremor is permissionless cover for mid-cap pools. | [`TremorHook.sol`](contracts/src/hook/TremorHook.sol): `setPremium` :122, `_getHookFee` :131, `handleHookFees` :144, `_buyCover` :157, `claimPayout` :186, `drip` :205, `unlockCallback` :216, `_convertToWeth` :240; hook address mining [`DeployFork.s.sol:26`](contracts/script/DeployFork.s.sol) |
| **Chainlink** | **CRE workflow** (TypeScript): hourly cron. It makes 1 + 12 + 2 EVM reads (receiver state, Swap logs in 100-block chunks, block timestamps via Multicall3) and 2 Binance kline HTTP calls, values every swap in node mode, and sends one `writeReport` to `TremorReceiver`. **Data Feeds:** settlement reads **every round** of the UNI/ETH feed inside the window (phase-aware; stops at `updatedAt == 0`). CRE data moves premiums, never payouts. | [`cre/tremor-lvr/`](cre/tremor-lvr), [`TremorReceiver.sol:57,86,93`](contracts/src/hook/TremorReceiver.sol), [`VarianceMarket.sol:151,186,310`](contracts/src/VarianceMarket.sol) |

## Verified results

All of these ran on an **Anvil fork of Ethereum mainnet**, against the deployed contracts.

**Unit and reference tests** (`forge test --match-path 'test/unit/*'`, 54/54 pass). These are implementation checks, not an audit:
- `reference/pricing_reference.py` is a separate exact-rational Python implementation of the same spec. It generated 10,508 cross-language reference outputs (`contracts/test/vectors/`), and `Pricing` matches every one exactly.
- Staleness regression tests: the live market refuses to quote while a newer Chainlink round is uningested, and after the window ends.
- Realized variance matches an 80-digit `ln` reference to within 1 wei per term.
- Invariant fuzzing (mint, burn, finalize, redeem) keeps `WETH ≥ Σ locked` and keeps every claim redeemable.
- The reference model found five pricing bugs, all now fixed: under-filled buys, over-taken sells, and three rounding errors.

**Fork tests** (`forge test --match-path 'test/fork/*' -vv`, 7/7 pass on a fresh fork, 6 Nov 2026). The C1 numbers below are asserted in the test, not just logged:

| Gate | Result |
|---|---|
| A1 | Router runtime is **21,935 bytes** (EIP-170 limit 24,576). Upstream AquaSwapVMRouter v1.0.2 builds to 20,541 bytes with this config, the same size as the deployed router. |
| A2 | `quote` == `swap` for buys of 0.01/0.1/0.5/1 WETH and for a sell, all through `0x22` on the deployed Aqua. A SHORT buy works, and an oversized buy refuses to quote. |
| C1 | Historical replay from real Chainlink round history: the Oct-2025 week settles from **50 rounds**, 305% oracle-sampled annualized vol, LONG pays the full S. The Feb-2025 week settles from **17 rounds**, 59.8% vol, LONG pays 0.159 S. |
| U1 | The hook fee equals `ceil(gross·pips/1e6)` on the unspecified currency, in both directions. A stale premium charges 0. Access control holds. `handleHookFees` buys LONG via Aqua. |
| E2E | Precomputed CRE reports delivered through an impersonated forwarder set the premium (1,500 pips) → fees → cover bought (0.2035 WETH → 1.029 LONG) → Chainlink settlement → **1.029 WETH drip-donated to in-range liquidity** → the vault docks and settles. A second payout claim, or a claim on a window the hook holds nothing in, reverts. (The real CRE simulation is the separate backfill below.) |

**Demo run** (`demo/setup-fork.sh` then `demo/run-demo.sh`, one pass on a fresh fork; every step printed a transaction hash):

| Flow | Result |
|---|---|
| F2 | Three measured weeks (29 Sep, 6 Oct, 13 Oct 2025, from `data/`) delivered through the CRE forwarder: premium **0 → 1,121 → 3,000 pips**. The cap was hit after the week LPs lost $137,516. |
| F3 | Six swaps on the Tremor v4 pool built up 0.107 WETH + 45.2 UNI of hook-fee claims. |
| F4 | `handleHookFees` redeemed the claims, converted the UNI and bought **1.232 LONG** through `0x22`. A trader's `router.quote` of 1 WETH equalled their `router.swap` (4.9597 LONG). |
| F5 | The Oct-2025 window settled from 50 Chainlink rounds; LONG paid the full S. **1.232 WETH** went to `PoolManager.donate` for in-range LPs. |
| F6 | The vault docked the Aqua strategy and redeemed its inventory. |

**CRE:**
- `bun test`: 4/4 pass.
- `cre/scripts/validate.ts`: on a real crash hour (122 swaps), the TypeScript maths equals `data/markout_pool.py` to within $1e-5.
- `cre workflow build` compiles.
- **`cre workflow simulate` ran on the fork** (6 Nov 2026, CLI v1.39.0, after `cre login`). Each run wrote a report through the mainnet MockKeystoneForwarder. A backfill of 42 runs over the week of 6 Oct 2025 measured 1,931 swaps and $168,022 of arbitrage loss (the backtest has $172,486 for the full week). The run that crossed into 13 Oct emitted `EpochClosed` and moved `TremorHook.premiumPips()` from 0 to **3,000**, from CRE data alone. Every figure was read back from the chain; details are in [`cre/README.md`](cre/README.md#simulation-results-6-nov-2026-anvil-fork-of-mainnet-at-block-26352198-from-rpcmevblockerio). Demo step F2 still delivers precomputed weekly reports through the forwarder by impersonation, because a 42-run backfill takes about 15 minutes.

## Sepolia testnet deployment

Tremor is also deployed on **Sepolia**, against the real Uniswap v4 PoolManager and the 1inch Aqua registry (byte-identical to mainnet's). Run the app against it with `cd web && npm run dev:sepolia`.

| Contract | Address (Sepolia) |
|---|---|
| TremorHook | [`0x3FF7250cB8BBC51DefC8eB4fEB3cFa9A05ae8044`](https://sepolia.etherscan.io/address/0x3FF7250cB8BBC51DefC8eB4fEB3cFa9A05ae8044) |
| TremorReceiver | [`0xbAFFE70d8D310dF3Da938D06d20e5C0949cD96D6`](https://sepolia.etherscan.io/address/0xbAFFE70d8D310dF3Da938D06d20e5C0949cD96D6) |
| VarianceMarket | [`0x6d07B9157d4c63F5BC2B5a1dA04E3A883e9B7BE5`](https://sepolia.etherscan.io/address/0x6d07B9157d4c63F5BC2B5a1dA04E3A883e9B7BE5) |
| TremorVault | [`0x5cdF7cADd39d37Cf4570815F407a4f4c5bb059de`](https://sepolia.etherscan.io/address/0x5cdF7cADd39d37Cf4570815F407a4f4c5bb059de) |
| TremorAquaSwapVMRouter (`0x22`) | [`0x8282596eBef54837b99392d4d09534251Fa7Aee4`](https://sepolia.etherscan.io/address/0x8282596eBef54837b99392d4d09534251Fa7Aee4) |
| tUNI (test token) | [`0xBa3AF5f6d46ED19C39E4C9E21740e30FBC8155dD`](https://sepolia.etherscan.io/address/0xBa3AF5f6d46ED19C39E4C9E21740e30FBC8155dD) |

This deployment (6 Nov 2026) includes both review fixes. Verified on Sepolia:
- All 22 deployment transactions confirmed; every contract has code and the hook is owned by the deployer.
- **The stale-quote fix, live:** a new Chainlink ETH/USD round had arrived after the window was created, so `caughtUp(0)` was false and the router's quote reverted `Stale()`. After a permissionless `checkpoint` ([tx](https://sepolia.etherscan.io/tx/0xb4ba6b3c3269c58eac0585d4bcebeda70e621661ef99a3aa4d6c443b02d05861)) the quote returned and a buy through the router's `0x22` instruction filled exactly at it: 0.002 WETH for 9.6919 LONG ([tx](https://sepolia.etherscan.io/tx/0xd905bf07785c2c66bf4c1cc68fa39d5ec9ba792b3dc3a04a16e5c2bcb2e95dd5)).
- A Chainlink CRE report through the Sepolia MockKeystoneForwarder ([tx](https://sepolia.etherscan.io/tx/0x4fe0aad6a9f56f01917e29329e4655283c180a248c3fe8f098e205cfed0fba5a)); the receiver advanced to the measured block.

On the first (pre-fix) Sepolia deployment, the full fee loop also ran: test swaps through the hook, CRE reports, and **the first fee week closed from CRE reports alone** ([tx](https://sepolia.etherscan.io/tx/0x26229855a052b6ca9540837af7c9569ed58081d088a55dc7e9d751b2ddcbfb1c)) with measured arbitrage loss −$0.034 on $28.02 of volume, so the hook fee was set to **0%**. That is the correct result: our test trades were a sale below market followed by an arbitrage back (−$2.46 then +$2.50), which leaves LPs unharmed. LPs lose to arbitrage only when the outside price moves while the pool lags, and on a pool this small an hour of that is worth cents.

How the Sepolia version differs (the contracts are the same code):
- **Settles on Chainlink ETH/USD.** Sepolia has no UNI/ETH feed; the market works with any feed.
- **Test UNI.** The pool is tUNI/WETH, started at the mainnet UNI/ETH price. A test price feed (owner-set) only guards the hook's UNI-to-WETH conversion.
- **Smaller sizes.** 0.001 WETH per LONG+SHORT pair, with the price slope and skew scaled by the same 1,000x, so prices and spreads match in relative terms.
- **First fee epoch closes 2 hours after deploy,** so a CRE run can set the hook fee during testing (`./cre/run-sepolia.sh`).
- **Settlement isn't testable before the deadline.** Windows are at least 7 days; the live window settles on 13 Nov.
- **Gas.** Sepolia reprices state-growth gas (a WETH deposit costs about 134k gas there; the router deployment 34.3M), so `demo/deploy-sepolia.sh` simulates with forge and then sends each transaction with the node's own gas estimate (`demo/send-planned.mjs`).

## Run it

```bash
git clone https://github.com/zeel991/tremor-mumbai.git && cd tremor-mumbai && git submodule update --init && cd contracts && npm install
```

```bash
anvil --fork-url <ethereum archive rpc> --chain-id 1 --compute-units-per-second 150 --retries 12
```

```bash
forge test --match-path 'test/fork/*' -vv
```

```bash
../demo/setup-fork.sh && ../demo/run-demo.sh
```

```bash
cd ../web && npm install && npm run dev
```

- `demo/run-demo.sh` is one-shot per deploy, because it finalizes the replay window.
- The web app reads `contracts/deployments/fork.json` and talks only to `127.0.0.1:8545`.

## Equal-cost benchmark: dynamic LP fee vs Tremor cover

`python3 data/benchmark_dynamic_fee.py`. The same weekly add-on, (A) paid straight to LPs as a dynamic fee, or (B) spent on LONG at the deployed ask (0.1967 per 1.0 max payout), with the payout to LPs. 102 week pairs, outlier excluded. LONG pays on Binance-sampled vol × 0.70 (the Chainlink/Binance ratio in both replayed weeks). B gets a flat price with unlimited depth and same-week payout, which flatters it.

| LP net per week | Total | Mean | Sd | Worst week | Negative weeks |
|---|---|---|---|---|---|
| Today (no add-on) | $693,352 | $6,798 | $23,701 | −$137,516 | 14 |
| A: dynamic LP fee | **$5,522,180** | **$54,139** | **$67,381** | −$124,446 | **1** |
| B: Tremor LONG cover | $5,088,952 | $49,892 | $99,962 | **−$71,061** | 2 |

**Reading:** a direct dynamic fee is better for expected value and smoothness. Tremor gives up about 8% of the add-on's value to cut the worst week by 43%. It reshapes the tail; it does not raise the mean. Retention (volume leaving because of the add-on) scales A and B alike: both stay above today's total down to roughly 13% retention under these flattering, composition-neutral assumptions.

## Fixed after external review (6 Nov 2026)
- **Stale quotes.** The live market quoted from stored state even when a newer Chainlink round was public, and after the window ended. It now reverts (`Stale`, `TooLate`) until `checkpoint()` catches up; the hook checkpoints a running cover window before buying.
- **Drip griefing.** Anyone could call `claimPayout` with a window holding nothing and restart the donation drip, delaying LPs indefinitely. Each window the hook bought cover in can now be claimed once; a zero payout leaves the drip untouched.
- Sepolia was redeployed with both fixes (addresses above).

## Honest limits
- **Pool-level data.** Individual LPs, especially narrow-range ones, can do better or worse than the pool total. LPs were net positive over two years (+$0.72M); the problem is thin, unpredictable margins.
- **Funding, not recovery.** A premium of 0.5 × last week's loss ÷ volume, capped at 30 bps, would have raised funding equal to 49% of measured loss, assuming the premium costs the pool no volume. That is an upper bound on funding, not the share LPs get back.
- **A dynamic LP fee beats Tremor on average.** See "Equal-cost benchmark" below: paying the same add-on straight to LPs earns more in total and swings less week to week. Tremor's case is the worst week.
- **Recipients.** `donate` pays whoever is in range when the payout drips, including liquidity that arrived after the loss; the LPs who took the loss may have left.
- **Wide prototype quote.** At the deployed parameters a LONG costs about 0.20 and sells for about 0.10 (1.0 maximum payout): a 0.10 spread on a 0.15 midpoint. Over the sample LONG returns 91% of its price, so SHORT writers are paid for supplying cover; depth is whatever the vault ships.
- **Chainlink feed granularity.** The UNI/ETH feed updates about 4 times a day (2% deviation). A 7-day variance estimate was within about 9% of a high-frequency reference; daily estimates are noisy, so windows are at least 7 days. Chainlink-based vol is lower than our Binance-based vol: 305% vs 436% for Oct 2025, 60% vs 85% for Feb 2025.
- **Demo replay.** The Oct/Feb-2025 windows are historical. Cover is bought at the writer's forward price *before* the window's rounds are ingested, then settled on the real rounds. `ALLOW_PAST_WINDOWS` exists only in the fork-demo build.
- **JIT risk.** Donations can be front-run by just-in-time liquidity. Dripping limits the value per call but doesn't stop it; the OpenZeppelin `LiquidityPenaltyHook` port was cut for time.
- **v4 only.** Tremor runs on a new v4 pool, so the v3 LPs in our data would have to migrate to it.

## Licences
- Tremor's code: MIT ([`LICENSE`](LICENSE)).
- Dependencies keep their own licences. 1inch swap-vm is `LicenseRef-Degensoft-SwapVM-1.1`, Aqua is `Aqua-Source-1.1`, and the vendored Chainlink `ReceiverTemplate` is MIT, copied from the CRE docs.

**Docs:** [spec](docs/spec.md) · [plan](docs/tremor_mumbai_plan.md) · [source checks per sponsor](docs/research/) · [1inch workshop notes](docs/1inch_workshop/notes.md) · [Uniswap feedback](FEEDBACK.md)
