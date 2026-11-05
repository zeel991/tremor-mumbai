# Tremor: hook-funded variance cover for Uniswap LPs

ETHGlobal Mumbai 2026. Built from an empty repo after kickoff; prior work is disclosed in [`PRIOR_WORK.md`](PRIOR_WORK.md), and AI use in [`AI_USAGE.md`](AI_USAGE.md).

> **In UNI/WETH 0.3%, arbitrage took 93% of LP fees over two years ($10.02M of $10.74M), and LPs lost money in 14 of 104 weeks.** One week (6 Oct 2025) cost them $137,516.
>
> Tremor works in three steps:
> 1. It measures each window's arbitrage loss with **Chainlink CRE**.
> 2. It prices a capped **Uniswap v4 hook fee** from that measurement.
> 3. It spends the fee on **variance cover**: LONG claims on realized UNI/ETH variance, sold out of one **1inch Aqua** strategy through a new **SwapVM instruction**. The cover settles from Chainlink UNI/ETH rounds and is **donated back to the pool's LPs**.

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

**Unit and reference tests** (`forge test --match-path 'test/unit/*'`, 51/51 pass):
- `reference/pricing_reference.py` is an independent exact-rational model written from the spec. It generated 10,508 pricing vectors (`contracts/test/vectors/`), and `Pricing` matches every one exactly.
- Realized variance matches an 80-digit `ln` reference to within 1 wei per term.
- Invariant fuzzing (mint, burn, finalize, redeem) keeps `WETH ≥ Σ locked` and keeps every claim redeemable.
- The reference model found five pricing bugs, all now fixed: under-filled buys, over-taken sells, and three rounding errors.

**Fork tests** (`forge test --match-path 'test/fork/*' -vv`, 7/7 pass):

| Gate | Result |
|---|---|
| A1 | Router runtime is **21,935 bytes** (EIP-170 limit 24,576). Upstream AquaSwapVMRouter v1.0.2 builds to 20,541 bytes with this config, the same size as the deployed router. |
| A2 | `quote` == `swap` for buys of 0.01/0.1/0.5/1 WETH and for a sell, all through `0x22` on the deployed Aqua. A SHORT buy works, and an oversized buy refuses to quote. |
| C1 | The Oct-2025 week settled from **50 real UNI/ETH rounds**: 305% annualized vol, LONG pays the full S. The Feb-2025 week settled from **17 rounds**: 59.8% vol, LONG pays 0.159 S. |
| U1 | The hook fee equals `ceil(gross·pips/1e6)` on the unspecified currency, in both directions. A stale premium charges 0. Access control holds. `handleHookFees` buys LONG via Aqua. |
| E2E | CRE reports set the premium (1,500 pips) → fees → cover bought (0.2035 WETH → 1.029 LONG) → Chainlink settlement → **1.029 WETH drip-donated to LPs** → the vault docks and settles. |

**Demo run** (`demo/setup-fork.sh` then `demo/run-demo.sh`; every step printed a transaction hash):

| Flow | Result |
|---|---|
| F2 | Three measured weeks (29 Sep, 6 Oct, 13 Oct 2025, from `data/`) delivered through the CRE forwarder: premium **0 → 1,121 → 3,000 pips**. The cap was hit after the week LPs lost $137,516. |
| F3 | Swaps on the Tremor v4 pool built up 0.214 WETH + 90.1 UNI of hook-fee claims. |
| F4 | `handleHookFees` bought **3.667 LONG** through `0x22`. A trader's `router.quote` of 1 WETH equalled their `router.swap` (4.9597 LONG). |
| F5 | The Oct-2025 window settled from Chainlink, **3.667 WETH** went to LPs, and `drip` donated it through `PoolManager.donate`. |
| F6 | The vault docked the Aqua strategy and redeemed its inventory. |

**CRE:**
- `bun test`: 4/4 pass.
- `cre/scripts/validate.ts`: on a real crash hour (122 swaps), the TypeScript maths equals `data/markout_pool.py` to within $1e-5.
- `cre workflow build` compiles.
- **`cre workflow simulate` has NOT run.** It requires `cre login` with a Chainlink account, and the Anvil upstream must serve archive reads (see [`cre/README.md`](cre/README.md)). Until then, demo step F2 delivers measured reports through the forwarder by impersonation, and is labelled that way.

## Run it

```bash
git clone --recursive https://github.com/zeel991/tremor-mumbai.git && cd tremor-mumbai/contracts && npm install
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

## Honest limits
- **Pool-level data.** Individual LPs, especially narrow-range ones, can do better or worse than the pool total. LPs were net positive over two years (+$0.72M); the problem is thin, unpredictable margins.
- **The backtest is an upper bound.** It says a premium of 0.5 × last week's loss ÷ volume, capped at 30 bps, would have recovered 49% of arbitrage loss, but it assumes the premium causes no lost volume.
- **Chainlink feed granularity.** The UNI/ETH feed updates about 4 times a day (2% deviation). A 7-day variance estimate was within about 9% of a high-frequency reference; daily estimates are noisy, so windows are at least 7 days. Chainlink-based vol is lower than our Binance-based vol: 305% vs 436% for Oct 2025, 60% vs 85% for Feb 2025.
- **Demo replay.** The Oct/Feb-2025 windows are historical. Cover is bought at the writer's forward price *before* the window's rounds are ingested, then settled on the real rounds. `ALLOW_PAST_WINDOWS` exists only in the fork-demo build.
- **JIT risk.** Donations can be front-run by just-in-time liquidity. Dripping limits the value per call but doesn't stop it; the OpenZeppelin `LiquidityPenaltyHook` port was cut for time.
- **v4 only.** Tremor runs on a new v4 pool, so the v3 LPs in our data would have to migrate to it.

## Licences
- Tremor's code: MIT ([`LICENSE`](LICENSE)).
- Dependencies keep their own licences. 1inch swap-vm is `LicenseRef-Degensoft-SwapVM-1.1`, Aqua is `Aqua-Source-1.1`, and the vendored Chainlink `ReceiverTemplate` is MIT, copied from the CRE docs.

**Docs:** [spec](docs/spec.md) · [plan](docs/tremor_mumbai_plan.md) · [source checks per sponsor](docs/research/) · [1inch workshop notes](docs/1inch_workshop/notes.md) · [Uniswap feedback](FEEDBACK.md)
