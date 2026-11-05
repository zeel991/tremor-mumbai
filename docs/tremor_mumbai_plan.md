# Tremor at ETHGlobal Mumbai: verified build plan (input to spec.md)

**Status:** every technical claim below has been checked against primary sources. Evidence lives in four research files:
- [research/1inch_aqua.md](research/1inch_aqua.md): swap-vm v1.0.2 and Aqua source, the 1inch docs portal.
- [research/uniswap_v4.md](research/uniswap_v4.md): v4-core, OpenZeppelin uniswap-hooks v1.3.0, the Uniswap docs.
- [research/chainlink.md](research/chainlink.md): CRE docs, cre-cli source, feed directory, on-chain reads.
- [research/ethglobal_and_tremor_v1.md](research/ethglobal_and_tremor_v1.md): ETHGlobal rules and FAQ, the v1 repo.

Market data is in [data/README.md](../data/README.md). The 1inch workshop is in [1inch_workshop/notes.md](1inch_workshop/notes.md).

**Kinds of check:**
- *Source-read* (structural): code or docs were read, nothing was built or run. This covers all contract and SDK claims.
- *Measured*: a query actually ran. This covers the LP data, the Chainlink round counts and phase-3 start date, the deployed router's size, and live code at every mainnet address the plan uses: UNI/ETH feed, Aqua, router, PoolManager, CRE mock forwarder, CREATE2 deployer, VolatilePair.

**Clock:**
- Submissions close **Sat 7 Nov, 09:00 IST**.
- Finalist judging starts **09:30 IST**, in live rooms: a 4-minute demo plus 3 minutes of Q&A.
- When this plan was written (Fri 6 Nov, 03:42 IST) that left **29.3 hours**.

---

## 0. Eligibility: hour 0, before any code

You decided to rebuild Tremor from scratch, and the plan follows that decision. But the rules make it risky, so settle it first:
- **Rules:** "Pre-existing project-specific code, designs, or assets are not allowed" (ethglobal.com/rules).
- **FAQ:** teams "porting or continuing existing projects" are not eligible to be ETHGlobal Finalists.
- **Gap:** no page says a team may rebuild its own earlier project.

Do these:
- **Get a written answer from ETHGlobal staff** (help desk or Discord) to two questions:
  - (a) Can a ground-up rebuild of our ETHOnline project enter from-scratch partner prizes, and is it finalist-eligible?
  - (b) If not, how do we join the Continuity track now? No page describes how to join or gives a deadline.
- **Disclose v1 in writing** to ETHGlobal and in the README. The rules say undisclosed prior work means "disqualified, prizes revoked… banned".
- **Make a NEW public GitHub repo** (e.g. `zeel991/tremor-mumbai`), not a fork or branch of v1's `zeel991/tremor`.
  - First commit: the spec and planning docs; **push it immediately**.
  - From then on, every member **commits small and pushes at least hourly**.
  - Never force-push or squash `main`.
  - Steps and commands are in spec.md §0.
- **Start from an empty repo** created after kickoff (Thu 5 Nov, 21:00 IST). Copy **no** v1 code, **no** v1 UI designs or assets, and no v1 test vectors. Re-derive the maths; the list is in research/ethglobal_and_tremor_v1.md §2.5.
- **Public libraries are allowed:** swap-vm, Aqua, v4-core, OpenZeppelin uniswap-hooks, solady. Say so in the README.
- **Commit steadily, from every member.** ETHGlobal treats "single commits of large files" as unqualified, and 1inch bans a single-commit final day.
- **AI rules:** document where AI was used. Because we work from a spec, **commit spec.md, the prompts and the planning documents (including this file) to the repo**. The spec-driven rule requires it.

## 1. What the data says

All figures are measured: every swap, valued at Binance prices. Method and limits are in `data/README.md`.

| Pool | Arbitrage share of LP fees | LP result | Coverage |
|---|---|---|---|
| ETH/USDC 0.05% (largest pool) | 30–52% | LPs earned **more** in volatile weeks; never negative | 3 weeks |
| ETH/USDC 0.3% | 81% | 0 losing weeks | 104 weeks |
| **UNI/WETH 0.3%** | **93%** ($10.02M of $10.74M)* | **Lost money in 14 of 104 weeks (about 1 in 7)**, $335,891 in total. Worst weeks: −$137,516 (6 Oct 2025) and −$100,687 (24 Feb 2025). Arbitrage took 100% of fees in weeks with ETH volatility > 80% | 104 weeks |

\* This excludes 26 Oct 2026. That week someone dumped about 1M UNI into the pool 20–28% below Binance, and LPs gained about $787k. It isn't arbitrage. Including it, the share is 86%.

**Honest framing:**
- UNI/WETH LPs were net positive over two years (+$0.72M, or +$1.51M including the dump week).
- The problem is a thin, unpredictable margin: arbitrage eats nearly all the fees, and violent weeks flip to losses. It is not a steady loss.

**Backtest of the premium rule** (derived; `data/backtest_premium.py`)
- Rule: each week's premium = 0.5 × (last week's measured arbitrage loss ÷ last week's volume), capped at 30 bps.
- Over the 102 consecutive week pairs it would have charged **$4.83M**, equal to **49%** of the arbitrage loss, and never charged more than that week's loss.
- **This is an upper bound.** It assumes the premium sends no volume elsewhere, which is the main open risk.

## 2. Product and positioning

> **"In UNI/WETH, arbitrage took 93% of LPs' fees over two years, and LPs lost money about 1 week in 7. Tremor prices a hook fee from last week's measured arbitrage loss and turns it into variance cover that pays LPs back when a violent week settles."**

**User:** an LP in a mid-cap 0.3% pool. Demo pool: **UNI/WETH**.

**Positioning against Uniswap Labs' VolatilePair** (verified on developers.uniswap.org):
- VolatilePair is a live dynamic-*LP*-fee hook for "Lower LVR" on ETH/USDC.
- Only Uniswap Labs can create its pools.
- **So never pitch Tremor as "a volatility fee."** Tremor is an **insurance loop**:
  - a *hook* fee, sized from measured arbitrage loss,
  - buys *external* variance cover on Aqua,
  - and the payout goes back to LPs.
- It runs on pools anyone can create, the mid-caps VolatilePair doesn't reach. Cite VolatilePair as complementary.

**What we don't claim:**
- That LPs lose money overall.
- That cover is free: writers earn the spread.
- That the premium costs no volume.

## 3. Prize stack, angle and odds

| Pick | Track (from-scratch) | 1st place | Places | Angle | My odds of placing |
|---|---|---|---|---|---|
| 1 | **1inch: Build an Aqua App** | $2,500 | 3 | 1inch's own words: "extend SwapVM". `CappedPayoffCurve` is a new instruction at index 0x22 for capped payoffs. One strategy backs both claims, so **N WETH of collateral backs 2N claims, with no over-commitment possible**. Pitch: "a prediction market on how violent the week will be" | Best, ~40–55% |
| 2 | **Uniswap: Build with Uniswap** | $4,000 | 4 | A hook *fee*, not an LP fee, that funds external cover and donates payouts back to LPs. Positioned against VolatilePair. Backed by the measured 93% / 1-in-7 numbers | Medium, ~25–40% |
| 3 | **Chainlink: Best workflow with CRE** | $1,500 | 1 | Parametric cover. **CRE measures what the chain can't**: it values every swap against exchange prices each hour and sets next window's premium | Low–medium, ~15–30% |

- The odds are my estimates from past winners; only winners are published, so they can't be calculated.
- **Ceiling:** $8,000. **Likely:** one prize, possibly two.
- **Fallback if the rebuild is ruled ineligible:** the continuity tracks (Aqua $1,500, Uniswap $1,250 × 4, Definitive "Most creative" $2,500). Chainlink has **no** continuity prize.
- **Stay clear of:**
  - Solvent's cross-strategy solvency guard (ETHOnline Aqua winner).
  - The losing "fee or insurance beside the pool" projects: Volatus, Riptide, Carry, Adaptive Hook AMM.
- **Cite coldcascade** as the market-maker-side answer to LVR.

### 3a. What 1inch's Mumbai workshop says (`1inch_workshop/notes.md`)

| They said | What we do |
|---|---|
| "Extend SwapVM or construct your own virtual machine" [21:35] | `CappedPayoffCurve` is appended at 0x22 in a redeployed router. The prize page explicitly allows "redeployments of a modified SwapVM contract" |
| "Actual liquidity $1,000, effective $6,000" [14:50] | Show "N WETH backs 2N claims", read live from the contract |
| Instructions "can call other contracts like Oracle data" [20:36] | The instruction reads the market's variance view and both legs' Aqua balances mid-swap |
| "You could build prediction markets…" [20:47] | That is the pitch framing |
| Over-commitment: the biggest trade wins [15:53] | Complete sets make Tremor's sharing exact, not probabilistic. Say so unprompted |
| Custom Uniswap hooks are "a nightmare" [7:29] | At the 1inch booth, lead with Aqua and mention Uniswap only as where the buyers are |

## 4. Architecture

**Decisions locked for spec.md** (each traced to a research file)

| Area | Decision | Why / source |
|---|---|---|
| Chain | **Anvil fork of Ethereum mainnet** for the whole demo | Everything we need exists only together on mainnet: the UNI/ETH Chainlink feed, Aqua, the v4 PoolManager and the CRE mock forwarder (chainlink.md §3; 1inch_aqua.md §7; uniswap_v4.md §6). 1inch allows forks |
| Collateral and claim unit | **WETH**. LONG and SHORT are ERC-20s | Aqua only moves ERC-20s via `transferFrom` (1inch_aqua.md §1). WETH matches the pool and the UNI/ETH variance |
| Variance source | Chainlink **UNI/ETH** proxy `0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e` (2%, 24 h) | Exists only on mainnet. Dividing UNI/USD by ETH/USD overstated variance by about 1.5× in a measured week, so it's out (chainlink.md §4) |
| Sampling | **Every round in the window** (tick-level), not a fixed grid | Feeds update about 4 times a day (UNI/ETH) or about 36 times a day (ETH/USD); a grid adds nothing. It also differs from v1's grid design |
| Window length | **≥ 7 days** | Measured: the 7-day UNI/ETH estimate was within about 9% of a reference; daily estimates ranged 0–1.32× (chainlink.md §4) |
| Round walking | Walk only inside the phase `latestRoundData()` reports; stop at `updatedAt == 0` (the proxy does not revert); a phase change inside a window is flagged, never stitched | Measured on-chain; the docs' "until revert" advice is wrong, and phases overlap in time (chainlink.md §5) |
| SwapVM base | **swap-vm tag `v1.0.2`**, not `main` | The deployed router `0x111111338c5091e8440b67b168bae16a668ac0de` is v1.0.2; `main` has a different ABI and opcode scheme (1inch_aqua.md) |
| Aqua | Deployed registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` | 1inch_aqua.md §7 |
| Hook base | **OpenZeppelin uniswap-hooks v1.3.0**: `BaseHookFee` + `IUnlockCallback` + `CurrencySettler` | v4-periphery removed `BaseHook`/`HookMiner` from `src/`; OZ's base takes the fee in `afterSwap` (uniswap_v4.md §1, §5) |
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` (mainnet) | Uniswap deployments page, fetched 2026-11-06 |
| CRE | TypeScript SDK; hourly cron; `cre workflow simulate --broadcast` against the fork | chainlink.md §1–2 |

**Contracts** (Foundry, solc 0.8.30, `cancun`, `viaIR`, matching swap-vm v1.0.2)

1. **`VarianceMarket`**
   - One window per market; windows are at least 7 days.
   - Payoff: LONG = floor(S·min(V, V_cap)/V_cap); SHORT = S − LONG.
   - `mintSet(n)` locks n·S WETH and mints n LONG + n SHORT. `redeem` pays each side after `finalize`.
   - **Solvency holds by construction:** every set is fully backed.
   - `checkpoint()` walks Chainlink rounds incrementally and is permissionless (about 28 UNI/ETH rounds a week).
   - `finalize()` is permissionless and requires every round to be ingested.
   - Exposes a `projectedVariance()` view for pricing.
   - Re-derive all maths from scratch (the realized-variance formula, payoff, projected variance, spread, impact integral). Get the LVR approximation E[LVR] ≈ V·σ²·T/8 from the Milionis et al. paper, not from v1 comments.
2. **`CappedPayoffCurve`**, the SwapVM instruction at index **0x22**.
   - `TremorOpcodes is AquaOpcodes, CappedPayoffCurve` overrides `_opcodes()`: it copies the 34 official entries and appends one.
   - Reads, in this order: `VarianceMarket.projectedVariance()`; both legs' inventory via `AQUA.rawBalances(maker, router, orderHash, LONG|SHORT)`; real collateral via a vault view.
   - Prices the trade with a rising-ask integral and inventory skew, then sets `ctx.swap.amountIn`/`amountOut`.
   - Reverts with a named error if collateral is short.
   - **Behaves identically in `quote` and `swap`**: no maker-hook-only logic, because `quote` skips hooks.
   - This is the instruction **1inch judges see**.
3. **`TremorAquaSwapVMRouter is Simulator, SwapVM, TremorOpcodes`**
   - Constructed with the deployed Aqua address.
   - **Size budget:** the deployed v1.0.2 router is **20,541 bytes** (measured with `eth_getCode`), leaving about **4 KB** under EIP-170's 24,576. Keep `CappedPayoffCurve` compact: put the heavy maths in `VarianceMarket` views the instruction calls. Check the size in hour 0–2.
   - The swap-vm licence is `LicenseRef-Degensoft-SwapVM-1.1`, not MIT. Note it in the README.
4. **`TremorVault`**, the writer's maker.
   - Approves the **Aqua registry**, not the router.
   - Calls `mintSet`, then `AQUA.ship(router, abi.encode(order), [WETH, LONG, SHORT], amounts)` with `useAquaInsteadOfSignature = true`.
   - The program is `Salt(0x14) · Deadline(0x0d) · CappedPayoffCurve(0x22)`.
   - `dock` must list all three tokens. A re-ship needs a new `Salt`, because hashes are immutable.
5. **`TremorHook`**, which inherits OZ `BaseHookFee` and `IUnlockCallback`.
   - Flags: `AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA` (`0x44`). The optional JIT penalty adds four liquidity flags (`0x547`).
   - `_getHookFee`: returns `premiumPips`. CRE sets it once per window via `TremorReceiver`, clamped to a published cap. Zero if unset or stale (fail safe).
   - The fee is taken in the swap's unspecified currency, so it accrues in **both UNI and WETH** as ERC-6909 claims.
   - **No Aqua call inside swap callbacks.**
   - `handleHookFees()` is permissionless, rate-limited and `nonReentrant`. It calls `unlock`, burns claims, takes the ERC-20s, converts UNI → WETH (a self-swap in the pool, which skips hook fees), exits the unlock, then buys LONG with `router.swap` (WETH in, LONG out).
   - **Payout:** after `finalize`, redeem LONG for WETH and `donate` it in drips via `unlockCallback`. Guard with `getLiquidity > 0`. Port the logic from OZ `LiquidityPenaltyHook`, because the core docs flag donate as JIT-frontrunnable and dripping alone is our own heuristic, not an official mitigation.
   - Deploy with HookMiner, copied from `v4-periphery/test/shared/HookMiner.sol`, through CREATE2 `0x4e59b44847b379578588920cA78FbF26c0B4956C`. Use `deployCodeTo` in tests.
   - The pool: a **new v4 UNI/WETH pool** with a static 0.3% fee, created and seeded on the fork. Say plainly that v3 LPs would need to migrate.
6. **`TremorReceiver`**, inherits `ReceiverTemplate(forwarder)`.
   - Takes CRE reports. Adds each hourly result to the window's arbitrage-loss total.
   - At window close, sets `hook.premiumPips = clamp(k · lvrSum / volume)` and calls `market.checkpoint()`.
   - For the demo, use the **mock forwarder** `0xa3d1ad4ac559a6575a114998affb2fb2ec97a7d9`, which exists on mainnet and therefore on the fork.
   - Do **not** check workflowId or author: the mock forwarder supplies none, and simulation fails if you do.
   - Accept 64-byte metadata.

**CRE workflow** (TS SDK `@chainlink/cre-sdk`; all limits from chainlink.md §2)
1. **Trigger:** cron `0 0 * * * *` (hourly).
2. **Read:** one `callContract` for `lastProcessedBlock`.
3. **Swap logs:** `filterLogs` for Swap events in 100-block chunks, at most 14 calls (1,400 blocks, about 4.7 hours). A backlog carries over to the next run.
4. **Prices:** HTTP calls for Binance 1-minute UNIUSDT and ETHUSDT klines over that span (2 calls, at most 300 rows each).
5. **Compute:** inside the node-mode function, value each swap at the exchange price (the `data/` method). Return only `{lvrSum, volume, nSwaps, toBlock}`; consensus input is capped at 25 KB.
6. **Write:** one `writeReport` to `TremorReceiver`.
7. **Setup:** you need `cre login`.
8. **Fork simulation is undocumented:** the CLI's own tests run it on Anvil, and the mainnet mock forwarder already exists in the forked state. **Run it end to end in hour 0–2.**
9. **Fallback:** a daily cron that pulls swaps from an indexer over HTTP.

**Settlement never uses CRE data.** CRE data can move premiums, never payouts.

**The loop:** take any sponsor out and it breaks.

```
CRE values each hour's swaps at exchange prices ─► TremorReceiver sets next window's premiumPips
Swaps pay the hook fee ─► handleHookFees buys LONG through TremorAquaSwapVMRouter (CappedPayoffCurve, 0x22)
Chainlink UNI/ETH rounds settle the ≥7-day window ─► LONG redeemed ─► WETH drip-donated to in-range LPs
```

**Frontend:** one LP-first screen with:
- this pool's "arbitrage took X% of fees", from CRE's totals;
- premium collected, cover held, payouts;
- a trader tab (quote, then swap, for LONG and SHORT).

Build new UI; v1 designs are off-limits.

**Cut on purpose:** a Rust backend, a subgraph, the stress-test harness, and multi-suite browser tests.

## 5. Demo and video

**Video rules (ETHGlobal):**
- 2–4 minutes; anything under 2 or over 4 is automatically rejected.
- At least 720p.
- No speed-up, no AI voiceover or TTS, no phone recording.

**Finalists:** 4-minute demo plus 3 minutes of Q&A. Judged on technicality, originality, practicality, usability and wow factor.

**Demo windows:**
- **Settlement:** the real violent weeks. The UNI/ETH feed's current phase 3 began **12 Jul 2024** (measured: `getRoundData(phase 3, round 1)`), so **6 Oct 2025** and **24 Feb 2025** both sit inside it. They can be settled on the fork from real Chainlink rounds, and the pitch's LP numbers and the on-chain payout refer to the same week.
- **Premium accrual:** runs live on the fork.

**Flow:** one transaction hash per arrow.

```
CRE simulation sets premium ─► swap pays hook fee ─► handleHookFees buys LONG (0x22 in the trace)
─► finalize the historical window from Chainlink rounds ─► redeem ─► drip donate to LPs
```

1. **Measured opening line:** "UNI/WETH: arbitrage took 93% of LP fees over two years; LPs lost $137,516 in the week of 6 Oct 2025."
2. **Mechanics on the fork.**
3. **Backtest slide:** 49% of arbitrage loss recoverable, labelled as an upper bound.
4. **A calm week:** cover cost a little and paid little.

**Booth versions** (booth visits are optional per the rules, but go anyway):
- **1inch:** extended SwapVM at 0x22 → N WETH backs 2N claims → quote, then swap, with the fill trace → why complete sets make over-commitment impossible.
- **Uniswap:** the 93% / 1-in-7 data → hook fee, not LP fee (vs VolatilePair) → fee buys cover → drip donate with the JIT guard → backtest.
- **Chainlink:** parametric cover → CRE values every swap against exchange prices → sets the premium → settlement from Chainlink rounds.

## 6. Timeline (clock time, IST; 4 people)

Roles: A = market and Chainlink settlement; B = Aqua/SwapVM; C = hook and CRE; D = frontend, data, pitch.

| When (IST) | A | B | C | D |
|---|---|---|---|---|
| Fri 04:00–06:00 | **Staff answer in writing**; repo; interfaces; demo windows fixed: 6 Oct 2025 and 24 Feb 2025, both inside phase 3 | swap-vm v1.0.2 checkout; router with an empty 0x22 slot compiles; **EIP-170 size check** | Anvil mainnet fork; HookMiner deploy of an empty `BaseHookFee`; **CRE simulate against the fork** | Spec.md and planning docs committed; LP screen wireframe (new design) |
| Fri 06:00–14:00 | `VarianceMarket`: sets, tick-level RV, checkpoint, finalize, redeem; tests | `CappedPayoffCurve` pricing; vault ship/dock; first quote, then swap | Hook fee path; `handleHookFees` (unlock, convert, buy) | Pricing reference in Python for test vectors; CRE kline maths, ported from `data/` |
| **Fri 14:00** | **Checkpoint: WETH → LONG fill through 0x22 on the fork** | | | |
| Fri 14:00–22:00 | Phase-change guard; edge cases | Exit path (LONG → WETH); inventory skew | `TremorReceiver`; CRE workflow end to end; drip donate + JIT penalty | Frontend wired to the fork |
| **Fri 22:00** | **Checkpoint: full loop with transaction hashes** | | | |
| Fri 22:00 – Sat 04:00 | Freeze contracts; README prior-work section | README Aqua section | `FEEDBACK.md`; Uniswap form; CRE simulation log in the README | Backtest slide; architecture diagram; take turns sleeping |
| Sat 04:00–07:30 | | | | **Record the 2–4 minute video** (no TTS, ≥720p) |
| **Sat 08:00** | **Submit**: pick the 3 prizes plus Finalist; one hour of buffer before 09:00 | | | |

**Cut order if behind:**
1. The JIT penalty: keep the drip and say so.
2. CRE (−$1,500): set `premiumPips` manually.
3. The exit path.

Never cut the 0x22 fill or the hook fee.

## 7. Submission checklist

**1inch:**
- [ ] Official Aqua registry used.
- [ ] A redeployed v1.0.2-based router with the appended opcode (allowed).
- [ ] On-chain transfers in the demo (fork OK).
- [ ] No single-commit final day.

**Uniswap:**
- [ ] Public repo.
- [ ] `FEEDBACK.md`.
- [ ] The Developer Feedback Form, with its link.
- [ ] README points to the exact hook lines.

**Chainlink:**
- [ ] The workflow integrates a chain and an external API.
- [ ] A successful `cre workflow simulate` log.
- [ ] Premiums depend on it ("meaningfully used").

**ETHGlobal:**
- [ ] Prior work disclosed in writing.
- [ ] AI attribution.
- [ ] spec.md, prompts and planning docs in the repo.
- [ ] Video 2–4 minutes.
- [ ] Submit before Sat 09:00 IST.
- [ ] At most 3 partner prizes, plus Finalist.
- [ ] `data/` method linked.

## 8. Risks

| Risk | Fallback |
|---|---|
| ETHGlobal rules the rebuild "porting" | Continuity tracks if they let us join; otherwise compete for partner prizes only, if they allow it. Get it in writing |
| The router exceeds 24,576 bytes with 0x22 (only about 4 KB of headroom) | Use the `Extruction` (0x20) callback on the **deployed** router `0x11111133…c0de` (no redeploy; scores lower) |
| CRE simulation can't target the fork | Use an `experimental-chains` entry in `project.yaml` (cre-cli source); otherwise simulate against Sepolia for the CRE leg only |
| A phase change during the event | Phase 3 has run since Jul 2024; if `phaseId` changes, the market flags the window and settlement uses the new phase only |
| Judges say "that's VolatilePair" | It's a hook *fee* funding cover with payouts to LPs, on permissionless mid-cap pools; VolatilePair is an LP fee that only Labs can create |
| The premium drives volume away | The backtest is labelled an upper bound; the rate is capped and published |
| JIT capture of donations | Port `LiquidityPenaltyHook`; state the residual risk in thin pools |
| Settlement noise | Windows ≥7 days; state the measured ±9% band on the 7-day UNI/ETH estimate |
