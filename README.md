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
| TremorHook | [`0x547C1194070EFdEDAfa5939D291aEDB444088044`](https://sepolia.etherscan.io/address/0x547C1194070EFdEDAfa5939D291aEDB444088044) |
| TremorReceiver | [`0x1936aA54c3E14eB4062f71df1D0ddf2A133670F8`](https://sepolia.etherscan.io/address/0x1936aA54c3E14eB4062f71df1D0ddf2A133670F8) |
| VarianceMarket | [`0xa290520A3BDf9b3aB9392949311Fb892bF30e381`](https://sepolia.etherscan.io/address/0xa290520A3BDf9b3aB9392949311Fb892bF30e381) |
| TremorVault | [`0x60fD5ce187D1306F4480B0e0A87Bc3844D78853B`](https://sepolia.etherscan.io/address/0x60fD5ce187D1306F4480B0e0A87Bc3844D78853B) |
| TremorAquaSwapVMRouter (`0x22`) | [`0xf82C372742712A19f7053139D294D838a7c48Fc7`](https://sepolia.etherscan.io/address/0xf82C372742712A19f7053139D294D838a7c48Fc7) |
| tUNI (test token) | [`0xE59410bd08f4D0553D1F73784F647BA6290FAa8a`](https://sepolia.etherscan.io/address/0xE59410bd08f4D0553D1F73784F647BA6290FAa8a) |

Verified on Sepolia (6 Nov 2026):
- All 22 deployment transactions confirmed; every contract has code and the hook is owned by the deployer.
- A buy through the router's `0x22` instruction: 0.002 WETH for 9.6919 LONG, equal to the router's quote ([tx](https://sepolia.etherscan.io/tx/0x956352b14cbf7fb0fdb7996dddb0414b1566090e3209916fec144a02e6bbe71c)).
- Swaps in the Tremor tUNI/WETH v4 pool through the hook.
- A Chainlink CRE report through the Sepolia MockKeystoneForwarder ([tx](https://sepolia.etherscan.io/tx/0x1dce291361ee2fe94f6964eeb3ccadbfa8840bc3544771fd8a3db98fefae441d)); the receiver advanced to the measured block.

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
