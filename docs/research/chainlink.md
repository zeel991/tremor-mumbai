# Chainlink claims check for Tremor (CRE + Data Feeds)

Checked 2026-11-06. Sources used: docs.chain.link (`.md` pages and the `llms-full.txt` bundles for CRE and Data Feeds), the `smartcontractkit/cre-cli` repo (shallow clone, commit `85ddf4f`, 2026-11-05), `smartcontractkit/chainlink` `AggregatorProxy.sol` (tag `contracts-v1.0.0`), the docs' feed directory JSON (`reference-data-directory.vercel.app/feeds-*.json`, which the docs.chain.link addresses page loads), and on-chain reads over public RPCs (`rpc.mevblocker.io`, `arb1.arbitrum.io/rpc`, `ethereum-sepolia-rpc.publicnode.com`). About 200 RPC calls in total.

**data.chain.link could not be read.** It returned HTTP 429 on every attempt. Feed parameters come from the docs feed directory instead, and proxies were checked on-chain with `description()`, `decimals()`, `aggregator()` and `phaseId()`.

Scripts, raw logs and the analysis output are in `<scratchpad>/` (`scripts/`, `data/`, `data/analysis.txt`).

---

## 1. What CRE offers today

| Claim | Verdict | Evidence | What the spec should say |
|---|---|---|---|
| SDK languages | **VERIFIED**: Go and TypeScript only | docs.chain.link/cre/overview: "Using the CRE SDK (available in Go and TypeScript)" | Use the TS SDK (`@chainlink/cre-sdk`, viem for ABI) or Go. |
| Triggers: cron, HTTP, EVM log | **VERIFIED**, plus a Solana log trigger | /cre/capabilities/triggers: "`Cron` trigger fires at a specific time or on a recurring schedule". The same page describes the HTTP and EVM Log triggers. | Cron takes 5 or 6 fields (the 6th is seconds) and fires at most once per 30 s (/cre/reference/sdk/triggers/cron-trigger-ts). |
| HTTP fetch | **VERIFIED** | /cre/capabilities/http: "Fetch and post data from external APIs with decentralized consensus". `sendRequest` or `runInNodeMode` plus an aggregator such as `median` or `ConsensusAggregationByFields`. | HTTP results must pass consensus. Parse and reduce the data inside the node-mode function. |
| EVM read: contract calls and logs | **VERIFIED** | /cre/reference/sdk/evm-client-ts lists `callContract()` (view/pure, at latest, finalized or an explicit block) and `filterLogs()`, which "Queries historical event logs that match a specific set of filter criteria". | Both exist. Their quotas are tight (§2). |
| EVM write: delivery path | **VERIFIED** | /cre/guides/.../building-consumer-contracts: "it submits a signed report to a Chainlink `KeystoneForwarder` contract, which then calls your contract." The consumer implements `IReceiver.onReport(bytes metadata, bytes report)` and ERC-165. The recommended base is `ReceiverTemplate` (you override `_processReport`). | The hook (or a small receiver in front of it) inherits `ReceiverTemplate(forwarder)`. In production `metadata.length` is **64**, not 62, so never `require(len==62)`. Max report size 50 KB; gas quota 10M per transaction. |
| Report signing | **VERIFIED** | The workflow calls `runtime.report(...)` and then `evmClient.writeReport(...)`. The forwarder "validates the report's signatures" before calling `onReport`. | The DON signs. The contract trusts `msg.sender == forwarder` and optionally checks workflowId and owner. |
| Supported chains | **VERIFIED** | /cre/supported-networks-ts. Mainnets include Ethereum, Arbitrum One, Base, OP, Polygon, Avalanche, BNB, ZKsync, Linea, Scroll, World Chain and about a dozen more. Testnets include Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia and **Unichain Sepolia**. | **Unichain *mainnet* is not listed.** Ethereum mainnet is supported, so the plan's mainnet UNI/WETH pool is fine. |
| CLI simulation command | **VERIFIED** | /cre/guides/operations/simulating-workflows: `cre workflow simulate <workflow> --target <t>`. Add `--non-interactive --trigger-index N` for scripts. Requires a CRE account and `cre login`. | Plan on `cre login` before the demo. Cron triggers fire immediately when chosen in simulation. |
| Simulation writes to a testnet | **VERIFIED** | Same page: "By default, the simulator performs a dry run for onchain write operations". `--broadcast` sends real transactions signed with `CRE_ETH_PRIVATE_KEY` through a **MockKeystoneForwarder**. Mock forwarders are also listed for mainnets: Ethereum `0xa3d1ad4ac559a6575a114998affb2fb2ec97a7d9` (code confirmed on-chain, 4,579 bytes) and Sepolia `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`. | Deploy the receiver with the **mock** forwarder address for the demo. Do **not** set expected workflowId, author or name, because the mock forwarder supplies no metadata and the simulation fails. |
| Simulation against a local fork | **PARTLY**: not documented, but the CLI source supports it | Docs only say the simulator calls "your configured endpoint". In cre-cli, `test/multi_command_test.go` runs `simulate` against local **Anvil** with the MockKeystoneForwarder etched at the Sepolia mock address via `anvil_setCode`. `internal/settings` supports `experimental-chains` entries (`chain-selector`, `rpc-url`, `forwarder`), and there is a global flag `--allow-unknown-chains`. | Spec: point the `ethereum-mainnet` RPC in `project.yaml` at the Anvil mainnet fork. The mainnet mock forwarder `0xa3d1…a7d9` already exists in forked state. Fallback: an `experimental-chains` entry. Run this end to end in hour 0–2, because it rests on source code, not docs. |
| Deployment | **PARTLY** | /cre/guides/operations/deploy-access: "Deploying workflows to a Chainlink DON requires approval." | Simulation satisfies the prize rule. Do not depend on deploying. |

## 2. Limits that affect step B

All values are from /cre/service-quotas (updated 2026-10-29) and match the CLI's embedded `cmd/workflow/simulate/limits.json`. **The simulator enforces them by default** (`--limits default`).

| Quota | Value |
|---|---|
| HTTP calls per execution (`HTTPAction.CallLimit`) | **15** |
| HTTP response size | **250 KB** (request 120 KB, connect timeout 10 s) |
| EVM read calls per execution (`ChainRead.CallLimit`) | **15** |
| Log query range (`ChainRead.LogQueryBlockLimit`) | **100 blocks** per `filterLogs` |
| EVM read request payload | 5 KB. **A response-size limit for EVM reads is NOT FOUND.** |
| Execution timeout | **5 min**; each capability call up to 3 min |
| WASM memory | **100 MB** |
| Data passed to consensus (`Consensus.ObservationSizeLimit`) | **25 KB**; 50 consensus calls per execution |
| Workflow return value | 100 KB |
| EVM log trigger | 10 events per 6 s (burst 10); at most 5 addresses |
| Report size and gas | 50 KB report; 10,000,000 gas per transaction |
| Writes per execution | **NOT FOUND**. Only `TargetsLimit` = 10 destination chains is documented. |

**Verdict: CONTRADICTED.** As planned, one run per window cannot read 1,000–7,000 swap logs plus about 10,000 one-minute prices.
- **Logs.** 15 reads × 100 blocks = 1,500 blocks per run at most, about **5 h** on Ethereum (12 s blocks). One day is 7,200 blocks, which needs 72 `filterLogs` calls, and a week needs about 504. On Base (2 s blocks) a run covers about 50 min.
- **Prices.** 10,000 one-minute klines need about 10–11 HTTP calls at ≤1,000 rows each. That is roughly 150–180 B per row, so 150–180 KB per call. Row size is my estimate; Binance's per-request cap is outside the allowed sources and NOT VERIFIED. This leaves 4–5 calls for everything else.
- **Consensus size.** Raw swap or kline arrays cannot pass consensus (25 KB). The swap-valuation maths must run **inside** the node-mode function, with only a few numbers returned for `median`.

**Feasible design.**
- **Option 1 (recommended): rolling cron with an on-chain accumulator.**
  - Run hourly (or every 4 h; 4 h is 1,200 blocks, which takes 12 of the 15 reads).
  - Per run: `filterLogs` the pool's Swap events over the last ≤1,500 blocks in 100-block chunks. Fetch that span's 1-minute klines in 1 HTTP call (≤300 rows). Compute the markout/LVR sum inside node mode and return `{lvrSum, volume, nSwaps, fromBlock, toBlock}`.
  - Write one report. The hook adds the result to the window's running total. On the run that closes a window, the same report also sets the bounded premium and triggers checkpoint (see "Recommended CRE workflow").
- **Option 2: per-day cron through an indexer.**
  - Fetch the day's swaps from an indexer or subgraph over HTTP (1–3 calls; about 100–200 B per swap is under 250 KB per call for about 1,000 swaps/day). Fetch 1,440 klines in 2 calls.
  - Compute in node mode, write once.
  - Simpler, but the swap data then comes from a third party rather than the chain.
- **Not recommended: an EVM log trigger per swap.** Throughput is fine (10 per 6 s), but it means one execution and one write per swap.

## 3. Feed addresses and parameters

Parameters come from the docs feed directory JSON. Each listed proxy was checked on-chain where marked.

| Network | Feed | Proxy | Heartbeat | Deviation | Decimals | Verdict |
|---|---|---|---|---|---|---|
| Ethereum | **UNI / ETH** | `0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e` | 86,400 s (24 h) | **2%** | 18 | VERIFIED (on-chain `description()` = "UNI / ETH"; aggregator `0x08b3…04f5`, phase 3) |
| Ethereum | UNI / USD | `0x553303d460EE0afB37EdFf9bE42922D8FF63220e` | 3,600 s | 1% | 8 | VERIFIED (on-chain; aggregator `0xdef8…ea51`, phase 7) |
| Ethereum | ETH / USD (standard) | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 3,600 s | 0.5% | 8 | VERIFIED (on-chain; aggregator `0x7d4e…6fb5`, phase 7). SVR variants also exist: `0x5147…9649` and shared `0xd825…D409`. |
| Base | UNI / ETH | none | | | | NOT FOUND |
| Base | UNI / USD | none | | | | NOT FOUND |
| Base | ETH / USD | only SVR variants are listed: `0x50015f8b17fb2C290Dde41fDc246ed0dcEE93a8b` (shared-svr-2, 8 dec), `0xa4250cE1aA15Ff4cb5E5a8655293b65694e436Ed` (svr), `0x5731Ae06077c79A3B292498940211E0aE7130bd3` (shared-svr, 18 dec) | 1,200 s | 0.15% | | PARTLY (directory only, not read on-chain) |
| Arbitrum | UNI / ETH | none | | | | NOT FOUND |
| Arbitrum | UNI / USD | `0x9C917083fDb403ab5ADbEC26Ee294f6EcAda2720` | 86,400 s | 0.15% | 8 | VERIFIED (on-chain) |
| Arbitrum | ETH / USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | 1,755 s | 0.05% | 8 | VERIFIED (on-chain). SVR variants: `0xAfF2…b0DC` and `0xe4D0…5E3f` (shared, 18 dec). |
| Sepolia | UNI / ETH and UNI / USD | none | | | | NOT FOUND |
| Sepolia | ETH / USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | 3,600 s | 1% | 8 | VERIFIED (live; updated about 6 min before the read) |

Side finding: Sepolia lists ETH-USD 24 h, 7 d and 30 d **Realized Volatility** feeds (for example `0x31D04174D0e1643963b38d87f26b0675Bb7dC96e`). On-chain, their last update was **2024-08-30**, so they are stale and unusable. None are listed on Ethereum, Base or Arbitrum.

**Spec:** a native UNI/ETH Chainlink feed exists **only on Ethereum mainnet**. That fits the plan's mainnet fork.

## 4. How often rounds update, and whether grid-based variance is biased

**Method.**
- Collected `AnswerUpdated(int256,uint256,uint256)` logs from each current aggregator with `eth_getLogs`. The topic was checked: the last log's round 35394 and answer 223268826626 equal `latestRoundData()`, and round IDs are contiguous.
- Window: **2026-10-29 00:00 → 2026-11-05 00:00 UTC (7 days)**. No phase change happened inside it.
- Each feed was sampled on 5- and 10-minute grids by taking the last value at or before t. Realized variance (RV) is Σ(log return)².
- The reference is the **same asset's Arbitrum feed** (0.05% for ETH, 0.15% for UNI), which updates 500–700 times a day. It is itself a thresholded Chainlink series, not ground truth.
- Everything below is **derived** from those logs.

| Feed (Ethereum mainnet) | Rounds / day (7 days) | Mean | Heartbeat-driven | Median \|move\| per deviation update | 5-min grid steps with no change |
|---|---|---|---|---|---|
| ETH/USD (0.5%, 1 h) | 47, 49, 24, 24, 34, 27, 46 | **35.9** | 50% | 0.538% | **88%** |
| UNI/USD (1%, 1 h) | 56, 44, 27, 29, 30, 33, 40 | **37.0** | 42% | 1.072% | **88%** |
| UNI/ETH (2%, 24 h) | 11, 5, 1, 4, 1, 4, 2 | **4.0** | 7% | 2.045% | **98.6%** |
| *Reference:* Arbitrum ETH/USD (0.05%) | 942 … 249 | 701 | 0% | 0.072% | 15% |
| *Reference:* Arbitrum UNI/USD (0.15%) | 667 … 295 | 505 | 0% | 0.193% | 19% |

How the mainnet feed's RV compares with the reference RV:

| Series | 7-day ratio (5-min grid) | Daily ratios (5-min grid) | 7-day ratio (10-min grid) |
|---|---|---|---|
| ETH/USD mainnet | **1.00** (annualised vol 53.3% vs 53.2%) | 0.70 – 1.26 | 1.07 |
| UNI/USD mainnet | **0.98** (106% vs 107%) | 0.77 – 1.26 | 1.04 |
| UNI/ETH mainnet feed (direct) | **0.91** (78% vs 82%) | **0.00 – 1.32** | 0.93 |
| UNI/USD ÷ ETH/USD, both mainnet, same grid | **1.53** (102% vs 82%) | 1.04 – 2.04, always > 1 | 1.46 |

**Verdict: PARTLY.** The claim that rounds update only on deviation or heartbeat is **VERIFIED**. The fear that this badly biases variance is **CONTRADICTED for a single feed over a week**. It is **VERIFIED for the ratio construction**, and per-day estimates are noisy.

What this means:
- **A 5–10 minute grid adds no information.** ETH/USD and UNI/USD change on only about 12% of 5-minute steps, and UNI/ETH on about 1.4%. The feed decides the real sampling: about 36 points a day, or about 4 a day for UNI/ETH. Grid spacing barely matters (5-min and 10-min results agree within about 7%).
- **One feed is roughly unbiased over a week.** Deviation updates happen at stopping times (the price has moved at least θ). For a martingale price, the expected sum of squared returns sampled at stopping times equals the true quadratic variation, and the measured 7-day ratios of 0.98–1.00 agree. Two small residual biases remain:
  - Overshoot: each update moves slightly more than θ.
  - End-of-window truncation: up to θ² of variance after the last update is missed. That is ≤2.5e-5 for ETH/USD but up to **4e-4 for UNI/ETH**, about a third of a typical day's UNI/ETH variance.
- **Short windows are noisy.** Daily ETH/USD RV ranged 0.70–1.26× the reference. UNI/ETH daily RV ranged **0–1.32×**: on one day it recorded essentially zero variance because its only update was a heartbeat. With about 4 updates a day, a 1-day UNI/ETH settlement is close to a coin flip.
- **The ratio of two asynchronous feeds is biased upward**, by 1.46–1.53× in variance this week. UNI and ETH updates rarely fall in the same grid interval, so the shared ETH move is not cancelled: the correlation the grid sees drops from about 0.66 to about 0.35. This is the Epps effect.
- Levels: the UNI/ETH feed and UNI/USD÷ETH/USD differ by a median of 0.64% (max 2.19%) at hourly points.

**Spec:**
- Settle UNI/WETH on the **direct UNI/ETH feed** (mainnet `0xD6aA…e02e`), never on the ratio.
- Use windows of **≥ 7 days**.
- Sample **every round in the window** (tick-level RV) instead of a fixed grid. It is cheaper and equivalent: ETH/USD tick-level annualised vol was 52.2% vs 52.7% for the reference.
- If the grid is kept as a frozen decision, 10 minutes is as good as 5 and costs half the steps.

## 5. Walking getRoundData across phases

**Encoding: VERIFIED.**
- /data-feeds/historical-data: `roundId = uint80(uint256(_phase) << PHASE_OFFSET | _originalId)` with `PHASE_OFFSET = 64`, so phaseId = `roundId >> 64` and aggregatorRoundId = `uint64(roundId)`. The same lines are in `AggregatorProxy.sol` (contracts-v1.0.0, lines 23 and 399–409).
- On-chain: ETH/USD `latestRoundData().roundId = 129127208515966896706`, which decodes to phase 7, aggregator round 35394. `phaseAggregators(1..7)` returns 7 distinct aggregators and `phaseAggregators(8) = 0`.

**Official guidance: VERIFIED, but the stopping rule is CONTRADICTED.**
- The docs say to loop over `getRoundData` from round 1 of a phase and increment "until you get a revert". They also say "roundId is NOT incremental. Not all roundIds are valid." They warn against looping on-chain because of gas.
- Measured: past the last round, the proxy **does not revert**. `getRoundData(phase 7, 35395)` and `getRoundData(phase 6, 23752)` return all zeros. Phase 0 does revert.
- **The walker must stop on `updatedAt == 0`**, not on a revert.

**Phases overlap in time: measured, and absent from the docs.**
- ETH/USD phase 7 round 1 has `updatedAt` 2024-09-18, but phase 6 kept posting until round 23751 at 2024-09-30.
- So timestamps are **not monotonic across a phase boundary**, and "highest phase whose round is at or before t" can choose a feed that was not yet live behind the proxy.

**Spec:**
- Walk by roundId inside the phase that `latestRoundData()` reports. Stop at `updatedAt == 0`.
- If a window crosses a `phaseId` change (an aggregator upgrade), either settle from the new phase only, from its first round onward, or flag the window for manual handling. Do not stitch phases by timestamp.
- Gas: `eth_estimateGas` for one cold `getRoundData` transaction through the proxy is about 35.3k including the 21k base, so roughly 14k for the call itself. A week of ETH/USD is about 251 rounds and UNI/ETH about 28, both cheap enough for `checkpoint()` to walk incrementally. This is derived from one estimate, not measured in a loop.

---

## Recommendations

**Recommended CRE workflow** (TypeScript SDK, Ethereum mainnet fork, simulated with `cre workflow simulate --broadcast`):
1. **Trigger:** cron every hour (`0 0 * * * *`). The run reads `lastProcessedBlock` from the hook (1 `callContract`).
2. **Swaps:** `filterLogs` for the pool's Swap events from `lastProcessedBlock+1`, at most 1,200–1,400 blocks, in ≤100-block chunks. That is ≤14 reads, staying under 15 per execution. On a backlog, process ≤1,400 blocks and let the next run continue.
3. **Prices:** one HTTP call for 1-minute klines covering that block span (≤300 rows, well under 250 KB). Compute the per-swap markout and LVR sum **inside the node-mode function**, and return only `{lvrSum, volume, nSwaps, toBlock}` (≪25 KB), aggregated with `median` / `ConsensusAggregationByFields`.
4. **Write:** one report to the hook's `onReport` (a `ReceiverTemplate` built with the mock forwarder `0xa3d1…a7d9`). The hook adds the hourly result to the window total. On the run that closes a window, the same report carries the **bounded premium** (clamped in the contract) and triggers `checkpoint()` inside `_processReport`. This keeps one write per run, since a per-run write count is undocumented.
5. **Fallback** if logs through EVM read prove awkward on the fork: a daily cron that pulls swaps from an indexer over HTTP. That uses 3–5 HTTP calls and the same reduce-then-consensus pattern.

**Feeds and sampling grid for settlement:**
- Ethereum mainnet ETH/USD `0x5f4e…8419` for ETH variance, and **UNI/ETH `0xD6aA…e02e`** for the UNI/WETH pool. Do not use UNI/USD ÷ ETH/USD: it overstated variance by about 1.5× this week.
- Use **all rounds in the window** rather than a 5–10 minute grid. If a grid is mandatory, use 10 minutes.
- Use windows of **at least 7 days**. Stop round walks at `updatedAt == 0` and treat a phase change inside a window as a special case.

**Is UNI/ETH variance settlement viable on Chainlink data?**
- **Weekly: yes, with a stated noise band.** The 7-day estimate came within about 9% of the reference, from about 28 updates.
- **Daily: no.** About 4 updates a day, daily ratios of 0–1.32, and up to about 4e-4 of missed end-of-window variance make daily settlement unreliable.
- **Ethereum mainnet only.** The UNI/ETH feed exists on no other network checked (Base, Arbitrum, Sepolia).
- If daily windows are required, settle on ETH/USD only and say plainly that mid-cap pairs need weekly windows.
