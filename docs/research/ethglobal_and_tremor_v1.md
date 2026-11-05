# ETHGlobal Mumbai rules + Tremor v1 (ETHOnline 2026) repository: fact check

Retrieved 2026-11-06. Primary sources only. Verdicts: VERIFIED / CONTRADICTED / PARTLY / NOT FOUND.

**How the evidence was gathered (what kind of check each verdict rests on)**

- ETHGlobal: I fetched the pages over plain HTTP (`curl`). Where text was only in the Next.js `self.__next_f.push` payload, I decoded it locally. Saved copies are in `<scratchpad>/pages/`.
- Line numbers labelled `details L…`, `start L…`, `prizes L…`, `rules L…` and `faq L…` refer to my tag-stripped text extracts in that folder:
  - `events_mumbai_info_details.txt`
  - `events_mumbai_info_start.txt`
  - `events_mumbai_prizes.txt`
  - `rules.txt`
  - `mumbai_faq.txt`
- `https://ethglobal.com/events/mumbai` returned **HTTP 500** but still carried its data payload. The FAQ and schedule below come from that payload.
- `https://ethglobal.com/faq`, `/events/mumbai/faq` and `/events/mumbai/rules` all serve a **404 page**. The real Mumbai rules page is `https://ethglobal.com/events/mumbai/info/details`.
- Repo: shallow clone of `https://github.com/zeel991/tremor` (`main` @ `5c647e6`, 2026-09-12) into `research_src/tremor-v1`. I also fetched branch `feat/v4-continuous-variance` (`e27e811`, 2026-09-13) as `origin/v4`, because **the showcase text describes the v4 branch, not `main`**: `TremorPortfolioMarketV4`, `TremorPortfolioLensV4` and `PortfolioPricing` exist only on `origin/v4`.
- Nothing was built or run. Every repo verdict is a **structural** check (source read). None is a runtime verification.
- `<scratchpad>` = `<scratchpad>`.

**Naming hazard: "v1" means two different things**

- In this brief, "Tremor v1" = the ETHOnline 2026 submission.
- Inside the repo, "v1" is an *earlier internal* iteration. The repo's comments say that iteration had different properties:
  - "v1's private opcode bank required Tremor's own router" (`contracts/src/libs/TremorOrderBuilder.sol:24`).
  - "In Tremor v1 the maker was the writer's wallet" (`contracts/src/TremorMakerVault.sol:13`).
  - "Tremor v1 computed the whole window inside the first settlement swap" (`contracts/src/VarianceAccumulator.sol:13`).
- The submitted code is the repo's v2 (series), v3 (portfolio, `main`) and v4 (continuous portfolio, branch).

---

## Part 1: ETHGlobal rules

### 1.1 What "built from scratch" requires

**Start time and pre-existing code: VERIFIED**
- `https://ethglobal.com/rules`, rules L54: "must begin your project when hacking officially begins at event kick-off". Also: "Pre-existing project-specific code, designs, or assets are not allowed".
- Mumbai details L37: work must "begin after the hackathon officially starts".
- FAQ L34 ("Can I start working…", Track 1 From Scratch): "start building from an empty repo".
- Mumbai schedule (event payload): "Hacking Begins!" at `2026-11-05T15:30Z` (21:00 IST, 5 Nov).

**Libraries, boilerplate and starter kits: VERIFIED (allowed)**
- Details L37: prior work is not allowed "unless they're from public libraries or starter kits".
- Details L40: "welcome to use open-source libraries and starter kits… but be transparent".
- Start L54: "You may use public libraries or boilerplate".
- So vendoring 1inch `swap-vm`, OpenZeppelin or solady is fine. Copying Tremor's own `contracts/src/*` is not: that is project-specific code.

**Rebuilding your own earlier hackathon project with new code: NOT FOUND (no explicit rule; there is a real risk)**
- No page addresses "same team re-implements its own prior hackathon project from scratch."
- FAQ L106 (Q21) is the closest text. It says pre-event work is not allowed, then: "porting or continuing existing projects" → "you won't be eligible for being an ETHGlobal Finalist."
- Rules L56: "In all cases, you must disclose any pre-existing work in writing to the ETHGlobal team". It also says submissions must include "full details in your submission (repo history, video, and description)". Undisclosed pre-existing work → "disqualified, prizes revoked… banned".
- A from-scratch rebuild of Tremor could be read as "porting". **Ask ETHGlobal staff in writing before relying on finalist or from-scratch partner eligibility.**

**Reusing an idea: NOT FOUND (no rule either way)**
- No page restricts ideas.
- The judging criterion "Originality" (details L63–64) asks whether the project introduces "a new idea".
- Rules L59 note that projects mostly made of pre-existing work historically "do not score as high".

**Version-control requirement: VERIFIED**
- Rules L58: "single commits of large files without proper history will be default assumed to be unqualified".
- Details L39 says the same.
- 1inch also requires "no single-commit entries on the final day" (prizes L224).

### 1.2 Continuity program / batch

**What it is: VERIFIED**
- Rules L55 names the tracks: "Extend Open Source" or "Ship a Feature". You may build on an existing codebase.
- Requirements: you must "clearly document what work existed before the hackathon" and include "substantive new features". New parts "must remain open source".
- FAQ L34 (Track 2): you cannot start the new feature before the hackathon; "Everything new has to be built during the event."
- The Mumbai prizes page links "ETHGlobal Continuity Track" to `https://x.com/ETHGlobal/status/2056399209767866682` (2026-05-18). That tweet announces "3 ways to hack": classic from scratch, extend an open source repo, ship a new feature. The tweet text is truncated, and the linked X article (`x.com/i/article/2056258666123415552`) was not retrievable without login.

**How projects get into it: NOT FOUND**
- The ETHGlobal pages only say a team has "selected a Continuity track" (rules L55; details L38). They give no application or approval process.
- Arkiv's prize text alone uses "existing project in ETHGlobal's Continuity batch" (prizes L969, L1048). No page defines "batch".
- Rules L57 says "approved Continuity track", which implies some approval step, but no page describes it.

**Deadline to join: NOT FOUND**
- The only deadline in the payload is "Deadline to Apply" (`2026-10-30T18:29Z`), which is the hacker application. No Continuity-specific deadline was found.

**Can a continuity project also enter from-scratch tracks? PARTLY (sources conflict)**
- Every Mumbai prize carries a `category` field in the payload: `building-from-scratch` or `continuity-track`.
  - `building-from-scratch`: "Build an Aqua App" $5,000, "Build with Uniswap" $10,000, "Best workflow with CRE" $1,500.
  - `continuity-track`: "Build an Aqua App - Continuity Track" $2,000 and "Build with Uniswap" $5,000. Their prize text says "only available to Continuity Track participants".
  - **Chainlink has no continuity prize.** The CRE track is from-scratch only.
- Rules L57: non-Continuity pre-existing work → "ineligible for Partner prizes and the Finalist category". For Continuity submissions, "eligibility for specific partner prizes may vary".
- Details L37: projects built before the event "won't qualify for partner prizes or the Finalist category".
- FAQ L113 (Q22) contradicts that: "Partners are able to award prizes to any project submitted on their technology".
- Arkiv's from-scratch prizes explicitly require "Built from scratch at ETHGlobal Mumbai" (prizes L883, L927).
- Data quirk: Whitechain's "Continuity · Bring Your Product to Whitechain" is tagged `building-from-scratch`.

### 1.3 Partner-prize count, one submission per team

**Up to 3 partner prizes: VERIFIED**
- Details L35: "you can select up to 3 Partner Prizes". A partner with several tracks counts as 1.
- FAQ L15: "maximum of **3** Partner Prizes", and "The ETHGlobal Finalist Track is separate and does not count".

**One submission per team: PARTLY**
- FAQ L81 (Q7) "Can I join two teams/projects?" is answered "No." Per person, that means one team and one project.
- No sentence literally says "one submission per team". The dashboard flow is "create your own project… or join a team" (start L58–60).

### 1.4 AI disclosure, team size, demo video, deadline

**AI disclosure: VERIFIED**
- Details L44 (Attribution): "Clearly document… where and how AI tools were used". Specify parts, files or assets.
- Details L45 (Involvement): AI-only work "may not be eligible for partner prizes or finalist consideration".
- **Details L46 (Spec-Driven Development): if you use OpenSpec, Kiro, spec-kit or similar, "you must include all spec files, prompts, and planning artifacts" in the repo.** This applies directly to the spec we are about to write.
- The FAQ version (FAQ L4) omits the spec-driven clause. The details page is the stricter source.

**Team size: VERIFIED**
- Start L45: "Teams can have up to 5 people".
- FAQ L61: "maximum of **five** members". Each member applies and stakes individually.

**Demo video: VERIFIED (2–4 minutes)**
- Details L34: optional but "strongly encourage… 2-4 minute demo video".
- Details L72: "Videos under 2 minutes or over 4 minutes will be automatically rejected".
- Also: at least 720p, no speed-up, no AI voiceover or TTS, no phone recording.
- Some partners add their own limits:
  - 0G: "Demo video (under 3 mins)" (prizes L320, L368, L408, L451).
  - Hedera continuity: "5 minutes or less".

**Submission deadline: VERIFIED**
- Details L32 and start L71: "Saturday, November 7th 2026 at 09:00 am IST".
- The payload has `submissionDeadline: 2026-11-07T03:30:00.000Z` (the same instant).

**Event dates and venue: PARTLY**
- Schedule runs from "ETHGlobal Mumbai" 2026-11-05 to "ETHGlobal Mumbai 2026 Ends" `2026-11-07T12:30Z`. So Nov 5–7 is correct.
- The venue in the payload is "Jio World **Convention** Centre", not "Jio World Centre".
- The FAQ calls it "a 36-hour hackathon" alongside Devcon 8 India.

### 1.5 Finalists: selection and rewards

**Selection: PARTLY**
- Finalists are "For the top 10 teams" (prizes L21).
- To be considered you choose the "Finalist and Partner Prizes" option at submission and present in a finalist judging session: "7 minutes… 4 minutes for the demo… 3 minutes for Q&A" (details L49–56).
- Criteria: Technicality, Originality, Practicality, Usability (UI/UX/DX), WOW Factor (details L62–67).
- Schedule:
  - "Main Finalist Judging" at `2026-11-07T04:00Z`, 180 minutes, in "Live Judging Rooms".
  - "Finalists Notified" at `09:45Z`.
  - "Closing Ceremonies" at `10:00Z`.
- How the top 10 are picked from the session scores: NOT FOUND.

**Rewards: VERIFIED**
- Prizes L51–57, per person by team size:

  | Team size | Prize per person | Travel per person |
  |---|---|---|
  | Solo | 250 USDC | none |
  | 2 people | 250 USDC | 250 USDC |
  | 3–5 people | 1,000 USDC | 500 USDC |

- Travel reimbursement is usable for one in-person ETHGlobal hackathon within 365 days.
- Finalist Pack: $828 off ETHGlobal Plus, a finalist hoodie, $10,000 AWS credits.

**Partner judging: PARTLY (internal contradiction)**
- Details L69: booth visits are "not required for partner judging".
- Start L77: "you'll present your project at the partner booths".

### 1.6 From-scratch track requirements we are targeting (prizes page)

**1inch "Build an Aqua App", $5,000 (2,500 / 1,500 / 1,000; L209–224)**
- You "may modify SwapVM opcodes and define your own instructions".
- "Projects that utilize SwapVM will be scored higher."
- "Official Aqua/SwapVM contracts must be used (redeployments of a modified SwapVM contract is allowed)".
- Onchain token transfers must be shown in the demo; local forks are OK.

**Uniswap "Build with Uniswap", $10,000 (4,000 / 3,000 / 2,000 / 1,000; L498–513)**
- Requires a public repo, a `FEEDBACK.md`, and a completed Uniswap Developer Feedback Form linking to it.

**Chainlink "Best workflow with CRE", $1,500 (L1719–1728)**
- A CRE workflow that integrates a blockchain with an external API, system, data source, LLM or agent.
- Show a successful CRE CLI simulation or a live deployment.
- The workflow must be "meaningfully used".

---

## Part 2: Tremor v1 repository

**Links on the showcase page** (`https://ethglobal.com/showcase/tremor-q9ye1`, found in the HTML)
- Source Code: `https://github.com/zeel991/tremor`
- Live Demo: `https://tremor-taupe.vercel.app`. It answered HTTP 200 on 2026-11-06. I did not inspect it further.

### 2.1 Licence, layout, chain and addresses

**Licence: PARTLY**
- There is no top-level LICENSE file.
- All 26 Tremor source files are `SPDX-License-Identifier: MIT`, per file.
- The vendored `contracts/lib/swap-vm` is `LicenseRef-Degensoft-SwapVM-1.1` (its `LICENSE` L1). `LICENSES/` also includes `Aqua-Source-1.1.txt`. **This is not MIT.** A rebuild that vendors swap-vm or Aqua inherits those terms.

**Layout: VERIFIED**
- `contracts/`: Foundry, solc 0.8.30. Sub-folders: `src`, `src/portfolio`, `src/libs`, `test`, `test/vectors`, `tools/reference`, `script`, `deployments`.
- `backend/`: Rust, axum.
- Also `web/`, `subgraph/`, `sim/`, `docs/`.
- `contracts/lib/swap-vm` and `contracts/lib/solady` are **vendored files**, not submodules, despite `.gitmodules`.
- The `@1inch/aqua`, OpenZeppelin and forge-std remappings point into `lib/swap-vm/node_modules`, which is not committed (`contracts/remappings.txt`).

**Chain and addresses: VERIFIED**
- Chain: Base Sepolia, chainId 84532, deployment block 46685189 (`contracts/deployments/84532.json`).

  | Contract | Address |
  |---|---|
  | `AquaSwapVMRouter` | `0xb8dcED3Cf6266Dd8fEc05849fce3734B79A7e722` |
  | Aqua | `0x3B568C149DDf92Bd1f7deF40bDD8930503e70B31` |
  | `TremorPortfolioMarket` (v3) | `0x72798A6697Cb648847ec0E5ba0bc6491B2901ddb` |
  | Portfolio accumulator | `0xea5A9Cfb462509f51420E10f5732891481fE634F` |
  | Chainlink ETH/USD feed | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` |
  | Quote token (**MockUSDC**, a test token) | `0x13a058bE25Da579e0858d689F5982eDaCE8356B7` |

- `origin/v4` adds (schemaVersion 4, `v4DeploymentBlock` 46702169):
  - `portfolioMarketV4` `0x67502D74d03f56892BAa2B5E99d1123AA14078a0`
  - `portfolioLensV4` `0x1C2c0bc1665fE7ad5Eef355baD52d7C70433Dccc`
  - `portfolioAccumulatorV4` `0xB8B817F4C3806121396CFa949097562bacE3F11D`
- Aqua and the router on Base Sepolia were **deployed by Tremor from the vendored source**, not the canonical deployments. `contracts/script/Deploy.s.sol:33,64-82` reads "unset => deploy a local Aqua". The README says canonical Aqua on Base is `0x1111113c…6a90a` (README L181).

### 2.2 1inch Aqua / SwapVM use

**Router: PARTLY**
- It is `AquaSwapVMRouter` built from vendored 1inch source, and the repo claims a bytecode match: "identical outside immutables" (`docs/submission/AQUA_SWAPVM_EVIDENCE.md` L26–36). I did not re-run that check.
- But it is **not the canonical on-chain router**. `contracts/test/RouterCompat.t.sol:57-82` asserts that the canonical Base router "exposes a different swap ABI" ("deployed router unexpectedly accepts the pinned quote ABI").
- `routerSourceCommit` is `"unknown"` (README L197). The upstream commit of the vendored copy is unrecoverable from the repo.

**Instructions used: VERIFIED (structural)**
- Only `Salt` (0x02), `Deadline` (0x20) and `Extruction` (0x04) (`contracts/src/portfolio/PortfolioOrderBuilder.sol:13-18,66-79`).
- `origin/v4:contracts/test/PortfolioV4Opcodes.t.sol` walks the six programs' bytes and fails on any other opcode.

**How strategies are built: VERIFIED**
- There are six orders per risk group: ISSUE, EXIT and SETTLE × HIGH/CALM.
- Program: `Salt(g,mode) · [Deadline(saleEnd|expiry)] · Extruction(market, [ver,mode,g])`. SETTLE has no Deadline.
- MakerTraits settings (`PortfolioOrderBuilder.sol:130-158`):
  - `useAquaInsteadOfSignature: true`
  - `receiver: 0`
  - a `postTransferIn` hook pointing at the receipt token, for EXIT and SETTLE
- Args version: v3 = 2; v4 = 4 (`origin/v4:…/PortfolioOrderBuilderV4.sol`, `ARGS_VERSION = 4`). That file's own doc comment still says "args version is 2".
- The market checks every shipped hash: `require(shipped == h, ShippedHashMismatch…)` (`origin/v4:…/TremorPortfolioMarketV4.sol:318`).

**How the Extruction callback prices swaps: VERIFIED**
- The market implements `IExtruction.extruction` and requires `msg.sender == ROUTER` (`TremorPortfolioMarket.sol:299-326`).
- It overwrites `SwapRegisters` (`amountIn` / `amountOut`) and returns `choppedLength = 0`.
- State is written only when `!isStaticContext`, and only for ISSUE. EXIT and SETTLE state moves in `onBurn`, which the receipt's router-only hook calls (`VarianceReceipt.sol:78-83`).
- **On `main` (v3), pricing is fixed**: `askHigh`, `askCalm`, `bidHigh`, `bidCalm` are constants (`TremorPortfolioMarket.sol:339,383`).
- **Continuous pricing exists only on `origin/v4`**: `_quote` → `PortfolioPricing.quote`, plus `_requireCurrent` (`TremorPortfolioMarketV4.sol:380-395,397-444`).

**MakerVault allowance model: VERIFIED**
- In its constructor the vault gives Aqua an unlimited allowance: `forceApprove(aqua, type(uint256).max)`. No code path re-approves (`TremorMakerVault.sol:85`). Receipts get the same treatment (`:160`).
- `shipStrategy` calls `IAqua.ship(ROUTER, …)` and is controller-only (`:164-171`).
- The owner can withdraw only `balance - lockedQuote`, and every mutation asserts solvency (`:129-137,180-184`).
- The vault comment says "Aqua is an allowance layer, not an escrow" (`:13`).
- Ship amounts are virtual. ISSUE ships the receipt inventory. EXIT and SETTLE each ship the side's standalone `maxLiability` (`PortfolioOrderBuilder.sol:107-124`).

**Claim: "v1 used only stock instructions and an unmodified router"**
- Stock instructions only: **VERIFIED** (structural).
- Unmodified router: **PARTLY**. The router is built from unmodified source and self-deployed. It is not the canonical deployed router, and the source commit is unknown. The repo also documents an earlier internal "v1" that used a private opcode bank and its own router (`TremorOrderBuilder.sol:24`).

**Claim: "the max(long, short) collateral saving is done in Tremor's own market contract, not by Aqua"**
- **VERIFIED.** `PortfolioMath.reserve(h,c,S) = ceil(max(h,c)·S/1e18)` (`contracts/src/portfolio/PortfolioMath.sol:22,37-40`).
- It is applied in `TremorPortfolioMarket._applyIssue` / `_reserveAfterExit` (`:435,683-688`) and enforced through `vault.lockedQuote`.
- Aqua only holds per-strategy virtual balances. The showcase's line "That is the 1inch Aqua contribution" (showcase text L34) overstates Aqua's role.

### 2.3 Chainlink accumulator

**Feeds: VERIFIED**
- One ETH/USD `AggregatorV3` proxy, fixed per accumulator as `FEED` immutable (`VarianceAccumulator.sol:50-58`).
- Addresses:
  - Base Sepolia: `0x4aDC…7cb1`
  - Base mainnet fork: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` (`Deploy.s.sol:38`)

**sampleInterval: PARTLY (sources disagree)**
- The code floor is `MIN_INTERVAL = 300` s (`VarianceSeriesFactory.sol:129`, `TremorPortfolioMarket.sol:189`, `TremorPortfolioMarketV4.sol:208`).
- The README says "30-minute floor on the sampling grid" (README L158-159). **That contradicts the code.**
- The v4 demo uses `sampleInterval: 600` (`origin/v4:contracts/script/PortfolioV4DemoFlow.s.sol:73`). Older demos use 7200, 3600 and 300.
- The showcase's reason for coarseness ("repeated rounds do not bias") differs from the v4 code comment, which picks 10 minutes because coarse grids moved results by 85% (`TremorPortfolioMarketV4.sol:211-230`).
- `MAX_SAMPLES` is 256 in v2/v3 and 4096 in v4. `MAX_SAMPLES_PER_CALL = 32`.

**Phase-aware round walking: VERIFIED**
- `RealizedVariance.sol:10-13,225-237` picks "highest phase whose FIRST round is <= t", then the largest round with `updatedAt <= t`.
- It gallops, then bisects (`:260-296`). `_findLast` probes non-current phases (`:240-257`).
- A round is valid only if `returnedId == requested && updatedAt != 0 && answeredInRound >= requested` (`:207-222`).
- Checkpoints are idempotent and bounded (`VarianceAccumulator.sol:95-144`). `finalize` is permissionless and requires every sample to be stored (`:148-157`).

**"Staleness revert": PARTLY**
- `CheckpointsStale` (`TremorMarketEngine.sol:53,373-379`; `TremorPortfolioMarketV4.sol:93,392-395`) fires when the **accumulator lags** (`stored < available` sample points, `VarianceAccumulator.sol:73-76`).
- It is **not** a feed-heartbeat check. No `updatedAt`-age check exists.
- Feed gaps silently repeat the last round, which gives a zero return (README L158).
- v3 `main` has no `CheckpointsStale` on the portfolio market at all.

### 2.4 Pricing library

**Functions: VERIFIED** (`contracts/src/libs/VariancePricing.sol`)
- `decaySkew` (uses Solady `expWad`; v2 only)
- `forwardVariance` = clamp(anchor+skew, 0, cap)
- `projectedVariance` = (realized·elapsed + forward·remaining)/duration, uncapped
- `annualize` (YEAR = 31,536,000)
- `bidAskVariance`
- `perUnitPrice`, `maxPayoutPerUnit`
- `askImpactSlope`, `bidImpactSlope`
- `issuePremium` (closed-form integral), `issueUnitsFor` (cancellation-free quadratic inverse, ceil sqrt)
- `issueUnitsToCap`, `issueUnitsToCollateral`
- `exitProceeds`, `exitUnitsToZeroBid`
- `payoutPerUnit`, `settleProceeds`, `maxLiability`, `finalLiability`

**v4 additions: VERIFIED** (`origin/v4:…/PortfolioPricing.sol`)
- Stateless `inventorySkew = impact·(h−c)/1e18` (`:102-108`).
- Linearly tightening `effectiveHalfSpreadBps` (`:112-121`).
- SHORT priced as the exact complement: `shortBid = S − longAsk`, `shortAsk = S − longBid` (`:169-170`).
- `shortIssueUnitsFor` uses bisection (`:216-231`).
- `S = floor(unitNotional·cap/1e18)` (`:92-94`).

**Rounding rules: VERIFIED**
- Maker-favouring throughout (`VariancePricing.sol:17-22`):
  - ISSUE: units floor, premium ceil
  - EXIT and SETTLE: proceeds floor
  - liability: ceil
- Complements subtract a floored term from a ceiled one (`PortfolioPricing.sol:33-35,203-209`).

**Test vectors: PARTLY**
- `pricing_vectors.json` (60 cases) and `portfolio_vectors.json` (225 cases) come from **independent** Python references:
  - `tools/reference/pricing_reference.py`: "60-digit-precision", "written from the specification rather than transcribed".
  - `portfolio_reference.py`: exact `Fraction`.
- `rv_vectors.json` has 6 cases.
- **But the 144 v4 vectors are emitted by the Solidity itself** (`origin/v4:contracts/test/PortfolioV4Vectors.t.sol`: "The Solidity here is the source of truth"). They pin the replicas to the chain, not to an independent model.
- So the showcase's "all generated at 60 significant digits" (showcase text L42) is not accurate for those 144.
- Static count of contract tests: 300 `test*` functions in 26 files on `origin/v4` (226 in 20 on `main`). The showcase says 290 in 26. Nothing was executed.

### 2.5 Re-derive rather than copy

Write these fresh from the math, not from Tremor's files. Copying them would also be "pre-existing project-specific code" under rules L54.

**Payoff**
- LONG = `floor(S·min(V,cap)/cap)`; SHORT = `S − LONG`.
- Shared reserve = `ceil(max(h,c)·S/1e18)`.
- Saving vs separate caps = `min(h,c)/(h+c)`. I re-derived this: at h = c it is 1/2.

**Realized variance**
- `Σ ln(P_i/P_{i−1})² · 31,536,000 / (end−start)`, on a grid anchored at `start`.
- Choose the interval from data. The repo's own measurements say 2h → 85% grid-anchoring spread, 10m → 0.13%. That is a claim in a code comment, not something I verified.

**Pricing**
- Projected variance blend, spread, affine impact slope, closed-form premium and proceeds integrals, quadratic inverse.

**Constants to re-justify, not inherit**
- MIN_INTERVAL 300
- MAX_SAMPLES 256 / 4096
- MAX_SAMPLES_PER_CALL 32
- MAX_CAP_VARIANCE 4e18
- MIN_SAMPLES 2
- YEAR = 365 days
- Demo cap 1e18 (100% annualized vol)

**LVR sizing**
- `E[LVR] ≈ V·σ²·T/8` (`origin/v4:contracts/src/TremorLens.sol:347-348`; `backend/src/api.rs:997`). Re-derive it from the Milionis et al. paper; do not trust the comment.

**Known gaps to fix in a rebuild**
- The showcase says "no floats anywhere". The backend uses `f64` (for example `api.rs` LVR and `rv.rs`).
- EXIT was never executed on a public chain (`AQUA_SWAPVM_EVIDENCE.md` L49–55).
- The quote token was MockUSDC.
- Contracts were not verified on Basescan (README L173).
