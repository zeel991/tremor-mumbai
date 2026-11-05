# Tremor: specification (ETHGlobal Mumbai 2026)

> **Status:** v1.0, written Fri 6 Nov 2026 IST. This spec is the build contract. Change it by editing it in the repo, not in chat.
> **Spec-driven disclosure:** ETHGlobal requires teams that build from a spec to commit "all spec files, prompts, and planning artifacts". Commit this file, `tremor_mumbai_plan.md`, `research/*.md`, `data/` and `1inch_workshop/notes.md` to the repo.
> **Prior work:** Tremor's ETHOnline 2026 submission (`github.com/zeel991/tremor`) is disclosed in §15. No code, design or asset from it is reused. Every formula here is re-derived.

**What "Verified" means in this document:**
- `[S]` is a **source-read**: code or docs were read, nothing was run.
- `[M]` is **measured**: a query or RPC call ran.
- Unmarked statements are **design decisions**.

---

## 0. Repository: a brand-new repo, committed and pushed throughout

**This is a hard requirement, not a style preference.** ETHGlobal requires work to begin after kickoff (Thu 5 Nov, 21:00 IST) and treats "single commits of large files without proper history" as unqualified. 1inch disqualifies single-commit final days. Judges check the remote history.

1. **Create a NEW, empty, public GitHub repo** (e.g. `zeel991/tremor-mumbai`).
   - **Not** a fork, branch or copy of `zeel991/tremor` (v1): its history and files are pre-existing work.
   - Start with no template files.
   - Create it after kickoff, so its creation date and first commit are inside the hackathon window.

   ```bash
   gh repo create zeel991/tremor-mumbai --public --description "Tremor: hook-funded variance cover for Uniswap LPs (ETHGlobal Mumbai 2026)"
   ```

   ```bash
   git clone https://github.com/zeel991/tremor-mumbai.git && cd tremor-mumbai
   ```

2. **First commit, pushed immediately:** the planning artifacts, which the spec-driven rule requires. That's `docs/spec.md` (this file), `docs/tremor_mumbai_plan.md`, `docs/research/*.md`, `docs/1inch_workshop/notes.md`, `data/` (the lvr_check scripts + README) and `README.md` (a stub). Add `PRIOR_WORK.md` and `AI_USAGE.md`.

   ```bash
   git add -A && git commit -m "docs: spec, plan, research and data method" && git push -u origin main
   ```

3. **Add dependencies as submodules pinned to the verified versions** (§4), then commit and push:
   - `lib/swap-vm` @ `v1.0.2`
   - `lib/aqua` @ `v1.0.1`
   - `lib/uniswap-hooks` @ `v1.3.0`
   - `lib/v4-core`
   - `lib/solady`
4. **Commit small and push often, from every member's own account:**
   - Commit after each working step; push at least **every hour**.
   - The remote history must show steady progress across Fri and Sat, not one upload at the end.
   - Use one branch per person (`a/market`, `b/aqua`, `c/hook-cre`, `d/web`) and merge into `main` with **merge commits**, not squash, so individual history survives.
   - **Never force-push, rebase or squash `main`.** Rewritten history looks like a single dump.
5. **Before every push:** make sure no file comes from v1. No v1 code, UI designs, assets or test vectors (§15).
6. **Final push** must happen before submission (target Sat 08:00 IST; deadline 09:00 IST). Then submit the repo URL on ETHGlobal and in the Uniswap Developer Feedback Form, and tag `submission`:

   ```bash
   git tag submission && git push origin submission
   ```

## 1. Purpose

Liquidity providers in mid-cap Uniswap pools lose most of their fees to arbitrage. In UNI/WETH 0.3%, arbitrage took 93% of LP fees over 104 weeks, and LPs lost money in 14 of those weeks `[M]` (data/). Tremor does three things:

1. **Measures** last window's arbitrage loss, off-chain via Chainlink CRE, by valuing every swap at exchange prices.
2. **Charges** a capped Uniswap v4 **hook fee** sized from that measurement.
3. **Spends** the fee on **variance cover**: LONG claims on realized UNI/ETH variance, sold from a 1inch Aqua strategy through a custom SwapVM instruction. It settles from Chainlink UNI/ETH rounds and **donates** the payout back to the pool's LPs.

**Non-goals:**
- An LP-fee curve. Uniswap Labs' VolatilePair already does that.
- Production deployment.
- Any public-testnet deployment except the optional CRE leg.
- Multiple pools.
- Governance.

## 2. Glossary and units

| Term | Meaning |
|---|---|
| WAD | 1e18 fixed point |
| `S` | Payout of one LONG + one SHORT, in WETH per whole claim token. Default **1 WETH** (`1e18`) |
| Window | `[t0, t1)`, at least 7 days. One LONG/SHORT pair of ERC-20s per window |
| `V` | Realized variance of ln(UNI/ETH), annualized, WAD |
| `V_cap` | Variance cap, WAD. Default `2.25e18` (150% vol) |
| Set | 1 LONG + 1 SHORT, backed by exactly `S` WETH locked in `VarianceMarket` |
| pips | Hook fee units, 1e-6 (so 3,000 pips = 0.30%) |
| LVR (measured) | Σ over swaps of (LP fee earned − LP markout vs exchange price), in USD |

`YEAR = 31_536_000` seconds (365 days).

## 3. System overview

```
                 (hourly)                              (window close)
 CRE workflow ──report──► TremorReceiver ──setPremium──► TremorHook ──hook fee on swaps──► (ERC-6909 claims)
  │ filterLogs (pool swaps)        │                         │ handleHookFees(): unlock→burn→take→UNI→WETH
  │ HTTP Binance 1m klines         └─checkpoint()──► VarianceMarket ◄─────────────┐ │
  │ callContract (Multicall3 ts)                       │ mintSet/redeem/finalize │ ▼
  └ compute LVR in node mode                           │ Chainlink UNI/ETH rounds  router.swap(WETH→LONG)
                                                       ▼                                  │
                       TremorVault (maker) ──ship [WETH,LONG,SHORT]──► Aqua ◄── TremorAquaSwapVMRouter
                                                                              (SwapVM v1.0.2 + CappedPayoffCurve @0x22)
 After t1: finalize() ─► hook.claimPayout() ─► redeem LONG ─► drip donate(WETH) to in-range LPs
```

**The four invariants the whole design rests on:**
- **I1, solvency.** Every outstanding claim token is backed by locked WETH: `lockedWETH(w) == setsOutstanding(w) · S`.
- **I2, payouts are fixed by data alone.** `payoutLONG + payoutSHORT == S` exactly, and both depend only on Chainlink rounds.
- **I3, external data never moves payouts.** CRE data affects premiums only.
- **I4, quote matches swap.** `quote` and `swap` run identical pricing, so the same state gives the same amounts.

## 4. Environment and addresses

**Chain:** an Anvil fork of **Ethereum mainnet**. It's the only chain that has the UNI/ETH feed, Aqua, the v4 PoolManager and the CRE mock forwarder together.

| Item | Address | Verified |
|---|---|---|
| Chainlink UNI/ETH proxy (2%, 24 h, 18 dec), phase 3 since 2024-07-12 | `0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e` | [M] `description()` = "UNI / ETH"; `getRoundData(phase3, 1)`.updatedAt = 2024-07-12 |
| Chainlink ETH/USD (0.5%, 1 h); UI only | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | [M] research/chainlink.md |
| Aqua registry (`AquaRouter`) | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` | [M] code present (5,619 bytes) |
| Deployed AquaSwapVMRouter v1.0.2 (fallback only) | `0x111111338c5091e8440b67b168bae16a668ac0de` | [M] code present (20,541 bytes) |
| Uniswap v4 PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | [M] code present |
| CRE MockKeystoneForwarder (mainnet) | `0xa3d1ad4ac559a6575a114998affb2fb2ec97a7d9` | [M] code present (4,579 bytes) |
| CREATE2 deployer (HookMiner) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | [M] code present |
| Multicall3 (block timestamp at a block) | `0xcA11bde05977b3631167028862bE2a173976CA11` | [M] `getCurrentBlockTimestamp()` at block 23,615,117 = header timestamp |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | [M] used in lvr_check |
| UNI | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | [M] `token0()` of the v3 pool |
| Reference v3 UNI/WETH 0.3% pool (CRE demo source) | `0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801` | [M] `token0`=UNI, `token1`=WETH, fee 3000 |
| VolatilePair hook (prior art; cite it, don't integrate) | `0x000022Ec4eBD6b12294396E852E4C3876b253Cc0` | [M] code present |

**Toolchain:** Foundry, solc **0.8.30**, `evm_version = cancun`, `via_ir = true` (swap-vm v1.0.2 requirements `[S]`).

**Dependencies, as git submodules pinned by tag or commit:**
- `1inch/swap-vm` **tag `v1.0.2`**. Do not use `main`: it has a different ABI and opcode scheme `[S]`.
- `1inch/aqua` `v1.0.1`.
- `OpenZeppelin/uniswap-hooks` **v1.3.0**.
- `Uniswap/v4-core`.
- `solady`.

**Licences:**
- swap-vm is `LicenseRef-Degensoft-SwapVM-1.1` and Aqua is `Aqua-Source-1.1` `[S]`. Neither is MIT. Keep their LICENSE files and say so in the README.
- Tremor's own code is MIT.

## 5. Repository layout

```
tremor/
  contracts/            Foundry project
    src/  VarianceMarket.sol  ClaimToken.sol  RealizedVariance.sol (lib)  Pricing.sol (lib)
          CappedPayoffCurve.sol  TremorOpcodes.sol  TremorAquaSwapVMRouter.sol  TremorVault.sol
          TremorHook.sol  TremorReceiver.sol
    test/ unit/  fork/  invariant/  vectors/ (JSON from reference/)
    script/ DeployFork.s.sol  Demo.s.sol
    lib/  (submodules)
  reference/            Python: pricing_reference.py (exact Fraction/mpmath), gen_vectors.py
  cre/                  CRE TS workflow: workflow.ts, project.yaml, config.{fork,sepolia}.json, backfill.sh
  web/                  Next.js + viem/wagmi (new design)
  data/                 lvr_check scripts + README (measurement method), backtest_premium.py
  docs/                 spec.md (this file), plan, research/, AI_USAGE.md, PRIOR_WORK.md
  FEEDBACK.md           Uniswap feedback (required)
  README.md
```

## 6. Contracts

### 6.1 `ClaimToken` (ERC-20, 18 decimals)
- Two per window: `T-LONG-<id>` and `T-SHORT-<id>`.
- `mint` and `burn` callable only by `VarianceMarket`.
- No other privileges.
- Plain `transferFrom`, which Aqua requires `[S]`.

### 6.2 `VarianceMarket`

**State, per window `w`:**

```solidity
struct Window {
  uint64 t0; uint64 t1;            // t1 - t0 >= MIN_WINDOW (7 days)
  uint256 S; uint256 vCap;         // WAD
  uint256 vFwd;                    // writer's forward variance for quoting, WAD (annualized)
  uint16 phaseId;                  // Chainlink phase at creation; must not change
  uint80 lastRound;                // last ingested aggregator round id (full proxy roundId)
  uint256 lastAnswer;              // price at lastRound
  uint64 lastUpdatedAt;
  uint256 q;                       // Σ r_i^2, WAD (not annualized)
  uint256 setsOutstanding;         // in claim-token wei
  bool finalized; uint256 payoutLong; // per whole token, WETH wei; payoutShort = S - payoutLong
  ClaimToken long; ClaimToken short;
}
```

**Functions:**

```solidity
function createWindow(uint64 t0, uint64 t1, uint256 S, uint256 vCap, uint256 vFwd) external returns (uint256 id);
  // reverts WindowTooShort if t1-t0 < 7 days; PastWindow if t0 < block.timestamp unless ALLOW_PAST_WINDOWS (immutable; true only in the fork demo build)
  // sets phaseId = latestRoundData().roundId >> 64; anchors p0 = answer of last round with updatedAt <= t0 (binary search on aggregator round ids within phaseId)
function mintSet(uint256 id, uint256 n) external;          // pulls ceil(n*S/1e18) WETH, mints n LONG + n SHORT to msg.sender; only before t1
function burnSet(uint256 id, uint256 n) external;          // inverse of mintSet, any time before finalize
function checkpoint(uint256 id, uint256 maxRounds) external returns (uint256 ingested); // permissionless
function finalize(uint256 id) external;                    // permissionless
function redeem(uint256 id, uint256 nLong, uint256 nShort) external returns (uint256 wethOut); // after finalize
function projectedVariance(uint256 id) external view returns (uint256 vProj);   // WAD, see §7.3
function quote(uint256 id, Side side, bool takerBuys, bool exactIn, uint256 amount, int256 inventorySkewUnits)
  external view returns (uint256 amountIn, uint256 amountOut);                 // §7.4; used by CappedPayoffCurve
```

**Chainlink round ingestion** (`RealizedVariance` library; every rule here is from research/chainlink.md §5):
- Walk proxy round ids `(phaseId << 64) | k` for `k = lastAggRound + 1 …`.
- **Stop** at the first of:
  - `updatedAt == 0` (past the latest round; the proxy returns zeros, it does not revert `[M]`);
  - `updatedAt >= t1`;
  - `maxRounds` reached.
- **Validity:** a round counts only if `answer > 0` and `updatedAt >= lastUpdatedAt`. Otherwise revert with `BadRound(roundId)`.
- For each valid round with `t0 < updatedAt < t1`: `r = lnWad(answer·1e18 / lastAnswer)`, then `q += r·r / 1e18`.
- **Phase change:** if `latestRoundData().roundId >> 64 != phaseId`, revert `PhaseChanged`. Never stitch phases: they overlap in time `[M]`.
- **Sampling** is every round (tick level), not a grid. For UNI/ETH that's about 4 rounds a day, about 28 a week `[M]`.

**Finalize:**
- Requires `block.timestamp >= t1 + FINALIZE_DELAY` (default 1 hour).
- Requires that ingestion has reached a round with `updatedAt >= t1`, or the latest round.
- Computes `V = q · YEAR / (t1 − t0)` and `payoutLong = floor(S · min(V, vCap) / vCap)`.
- Emits `Finalized(id, V, payoutLong)`.

**Events:** `WindowCreated`, `SetMinted`, `SetBurned`, `Checkpoint(id, fromRound, toRound, q)`, `Finalized`, `Redeemed`.

**Errors:** `WindowTooShort`, `PastWindow`, `NotFinalized`, `AlreadyFinalized`, `TooEarly`, `PhaseChanged`, `BadRound`, `NoQuote`, `InsufficientInventory`.

### 6.3 `CappedPayoffCurve` (SwapVM instruction at index `0x22`)

`TremorOpcodes is AquaOpcodes, CappedPayoffCurve` overrides `_opcodes()`. It copies the 34 entries of `super._opcodes()` (indices `0x00–0x21`) into a new array of length 35 and sets `[0x22] = _cappedPayoffCurve` `[S]` (research/1inch_aqua.md §2).

**Instruction args** (packed, from `order.data`): `market (20 B) | windowId (8 B) | shippedLong (16 B) | shippedShort (16 B)`.

**Behaviour.** It must be identical in `quote` and `swap`: no state writes, no dependence on `isStaticContext`, and no logic placed only in maker hooks, because `quote` skips hooks `[S]`.
1. Identify the token pair from `ctx.query.tokenIn` / `tokenOut`. One side must be WETH and the other this window's LONG or SHORT; otherwise revert `NoQuote`.
2. Inventory:
   - `bL = AQUA.rawBalances(ctx.query.maker, address(this), ctx.query.orderHash, LONG).balance`, and likewise `bS` for SHORT.
   - `soldL = shippedLong − bL`; `soldS = shippedShort − bS`.
   - `skew = int(soldL) − int(soldS)` for LONG, and the opposite sign for SHORT.
3. Call `market.quote(windowId, side, takerBuys, ctx.query.isExactIn, amount, skew)`.
   - `amount` is `ctx.swap.amountIn` if exact-in, else `ctx.swap.amountOut`.
   - Write the returned amounts to `ctx.swap.amountIn` / `amountOut`.
4. If the taker buys and `amountOut > bL` (or `bS`), revert `InsufficientInventory`. Aqua would revert anyway; this gives a named error in `quote` too.

**Size budget:** the deployed v1.0.2 router is **20,541 bytes** `[M]`, leaving about **4,035 bytes** under EIP-170. Keep the instruction thin and put all maths in `VarianceMarket` (an external view call). **Gate:** `forge build --sizes` shows `TremorAquaSwapVMRouter` ≤ 24,576 bytes, by hour 2.

### 6.4 `TremorAquaSwapVMRouter`

```solidity
contract TremorAquaSwapVMRouter is Simulator, SwapVM, TremorOpcodes {
  constructor(IAqua aqua, IWETH weth, address owner, string memory name, string memory version) SwapVM(...) {}
  function _instructions() internal pure override returns (function(Context memory, bytes calldata) internal[] memory) { return _opcodes(); }
}
```

- Mirrors `AquaSwapVMRouter` in v1.0.2 (`src/routers/AquaSwapVMRouter.sol:16-28`) `[S]`.
- Constructed against the **deployed** Aqua registry.
- Strategies must be shipped with `app = TremorAquaSwapVMRouter`, because programs are not portable across routers `[S]`.
- **External ABI** (v1.0.2) `[S]`:
  - `quote(Order, tokenIn, tokenOut, amount, takerTraitsAndData) view returns (amountIn, amountOut, orderHash)`
  - `swap(...)`, same arguments and return values.
  - `hash(Order)`, `asView()`.
- **Slippage** comes from taker traits: `threshold` is the minimum output for exact-in and the maximum input for exact-out. It is built with `TakerTraitsLib` (`src/libs/TakerTraits.sol:36-59,180-195`) `[S]`.

### 6.5 `TremorVault` (the writer; one per writer, owned by the writer)

```solidity
function openWindow(uint256 id, uint256 nSets, uint256 wethForBuybacks, uint64 deadline, bytes32 salt) external onlyOwner;
  // market.mintSet(id, nSets); approve AQUA (the registry, never the router) for WETH, LONG, SHORT;
  // order = Order{maker: this, traits: MakerTraitsLib.build({useAquaInsteadOfSignature: true, ...}), data: program}
  // program = Salt(0x14, salt) · Deadline(0x0d, deadline=min(deadline, t1)) · CappedPayoffCurve(0x22, args)
  // AQUA.ship(router, abi.encode(order), [WETH, LONG, SHORT], [wethForBuybacks, nSets, nSets]); store order
function currentOrder(uint256 id) external view returns (ISwapVM.Order memory);
function closeWindow(uint256 id) external onlyOwner;     // AQUA.dock(router, hash, [WETH, LONG, SHORT]) (must list all tokens [S])
function settle(uint256 id) external onlyOwner;          // after finalize: redeem unsold LONG/SHORT inventory via market.redeem
function withdraw(address to, uint256 amount) external onlyOwner; // free WETH only
```

- Re-shipping the same order reverts with `StrategiesMustBeImmutable`, so every re-ship uses a new `salt` `[S]`.
- In Aqua mode the receiver must be the maker, and WETH unwrap is disallowed `[S]`.
- **Effective vs actual:** `nSets · S` WETH backs `2 · nSets` claims. The frontend shows this ratio, read live from contract state.

### 6.6 `TremorHook` (Uniswap v4)

Inherits OpenZeppelin `BaseHookFee` (uniswap-hooks v1.3.0, `src/fee/BaseHookFee.sol`), `IUnlockCallback` and `ReentrancyGuard`, and uses `CurrencySettler` `[S]`.

**Permissions:**
- `afterSwap | afterSwapReturnDelta` = **`0x44`**.
- With the optional JIT penalty, add `afterAddLiquidity | afterRemoveLiquidity | afterAddLiquidityReturnDelta | afterRemoveLiquidityReturnDelta`, for **`0x547`** in total.
- The deployed address must encode exactly these bits. Use HookMiner (copied from `v4-periphery/test/shared/HookMiner.sol`; it's no longer under `src/` `[S]`) through the CREATE2 deployer. Tests use `deployCodeTo`.

**Pool:** a new v4 pool `PoolKey{currency0: UNI, currency1: WETH, fee: 3000, tickSpacing: 60, hooks: TremorHook}`, created and seeded on the fork. UNI < WETH by address, so UNI is `currency0`.

**State:** `premiumPips` (uint24), `premiumValidUntil` (uint64), `receiver`, `market`, `vault`, `router`, `pendingPayout` (WETH), `dripStart`, `dripBlocks`, `lastHandle`.

**Functions:**

```solidity
function _getHookFee(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
  internal view override returns (uint24) {
  return block.timestamp <= premiumValidUntil ? premiumPips : 0;     // fail-safe: stale -> 0
}
function setPremium(uint24 pips, uint64 validUntil) external;        // onlyReceiver; require(pips <= MAX_PREMIUM_PIPS)
function handleHookFees(Currency[] memory) public override nonReentrant;  // permissionless, >= HANDLE_INTERVAL apart
  // 1) poolManager.unlock(REDEEM): burn ERC-6909 claims, take UNI and WETH;
  //    swap UNI->WETH in this pool (self-call: hook fees skipped [S] Hooks.sol:253) with sqrtPriceLimit set from
  //    Chainlink UNI/ETH +/- MAX_CONVERT_SLIPPAGE; settle
  // 2) outside the unlock: (amountIn, amountOut) = router.quote(vault.currentOrder(w), WETH, LONG, wethBal, traits);
  //    router.swap(..., traits with threshold = amountOut * (1 - SLIP))  -> hook holds LONG
function claimPayout(uint256 id) external;   // after finalize: market.redeem(id, longBal, 0); pendingPayout += out; start drip
function drip() external;                    // permissionless: amount = released-so-far - donated; poolManager.unlock(DRIP)
function unlockCallback(bytes calldata) external onlyPoolManager returns (bytes memory);
  // REDEEM branch as above; DRIP branch: require(poolManager.getLiquidity(id) > 0); donate(key, 0, amount); settle WETH
```

**Constraints** (research/uniswap_v4.md §1–4):
- The fee is charged in `afterSwap` on the **unspecified** currency (the output for exact-in). It accrues in **both** UNI and WETH as ERC-6909 claims via `mint`, never via `take` inside the swap.
- **No external protocol calls inside swap callbacks.** `_getHookFee` makes at most `view` reads.
- The hook cannot call `unlock` during a swap (`AlreadyUnlocked`). Deltas must net to zero within each unlock.
- `donate` goes only to **in-range** liquidity at `slot0.tick` and is JIT-frontrunnable (`IPoolManager.sol:150`) `[S]`.
  - Dripping caps the value per call; it is our own heuristic, not an official mitigation.
  - The optional `LiquidityPenaltyHook` port withholds fees from liquidity added within `blockNumberOffset ≥ dripBlocks`.
- Rounding of the OZ fee: `ceil(|unspecified| · pips / 1e6)` `[S]`.

### 6.7 `TremorReceiver` (CRE consumer)

Inherits Chainlink `ReceiverTemplate(forwarder)` and overrides `_processReport`.
- `forwarder` = the mock forwarder `0xa3d1…a7d9` in demos.
- **Do not** configure expected workflowId, owner or name: the mock supplies no metadata, and simulation fails if you do `[S]`.
- Accept metadata of **64 bytes** (never `require(len == 62)`).

**Report** (`abi.encode`):

```
(uint64 fromBlock, uint64 toBlock, uint64 toTimestamp, int256 lvrUsdWad, uint256 volumeUsdWad, uint32 nSwaps)
```

**Logic:**
1. **Contiguity:** if `lastProcessedBlock != 0`, require `fromBlock == lastProcessedBlock + 1`. Then `lastProcessedBlock = toBlock`.
2. **Epoch:** `epoch = (toTimestamp − EPOCH_ORIGIN) / 7 days`, with `EPOCH_ORIGIN = 1_730_678_400` (Mon 2024-11-04 00:00 UTC).
3. **On epoch advance:** close the previous epoch:
   - `pips = min(MAX_PREMIUM_PIPS, max(0, K · lvr / volume · 1e6))`, with K = 0.5 by default;
   - `hook.setPremium(pips, EPOCH_ORIGIN + (epoch+1)·7 days + GRACE)`;
   - `market.checkpoint(currentWindow, 64)`.
4. **Otherwise:** `lvr += lvrUsdWad; volume += volumeUsdWad`.
5. Emit `Measured(fromBlock, toBlock, lvrUsdWad, volumeUsdWad, nSwaps)` and `PremiumSet(epoch, pips)`.

**Known approximation:** a report straddling an epoch boundary is attributed to the epoch of `toTimestamp`. That's at most about 4.7 hours of 168. Document it.

## 7. Mathematics (re-derived; no v1 sources used)

### 7.1 Realized variance (annualized)
- `p0` is the answer of the last round with `updatedAt ≤ t0`. `p_i` are the answers of valid rounds with `t0 < updatedAt_i < t1`, in order.
- `Q = Σ (ln(p_i / p_{i−1}))²`.
- `V = Q · YEAR / (t1 − t0)`.
- **Known biases** `[M]`:
  - End-of-window truncation: up to θ² ≈ 4e-4 for a 2% deviation threshold.
  - The 7-day UNI/ETH estimate was within about 9% of a high-frequency reference; daily estimates ranged 0–1.32×. Hence `MIN_WINDOW = 7 days`.

### 7.2 Payoff
- `payoutLong = floor(S · min(V, V_cap) / V_cap)` per whole token.
- `payoutShort = S − payoutLong`.
- Therefore `payoutLong + payoutShort = S` exactly (I2).

### 7.3 Projected variance (pricing only)

For time `τ` = `updatedAt` of the last ingested round, clamped to `[t0, t1]`, and `T = t1 − t0`:

```
Vp = (Q · YEAR + vFwd · (T − (τ − t0))) / T
```

At `τ = t1` this equals the settlement `V`. `vFwd` is the writer's view, set per window.

### 7.4 Quotes (`VarianceMarket.quote`)

**Setup.** `e = τ − t0`; `mid_L = S · min(Vp, V_cap) / V_cap`; `mid_S = S − mid_L`. For side `X ∈ {L, S}`:
- skewed mid: `m = clamp(mid_X + κ · skew_X, 0, S)`, where `skew_X` is in whole-token units;
- half-spread: `h = S · (hMin + (h0 − hMin) · (T − e) / T)`, tightening towards expiry;
- impact `λ > 0`, in WETH per whole token, per whole token.

**Taker buys `n` claims of side X.**
- The unit ask rises: `a(q) = a0 + λq`, where `a0 = m + h`.
- Require `a0 < S`, else `NoQuote`. Maximum size: `n ≤ (S − a0) / λ`.
- Exact-out `n`: `amountIn = ceil(n · a0 + λ n² / 2)`.
- Exact-in `x` WETH: `n = floor((−a0 + sqrt(a0² + 2λx)) / λ)`. Use `sqrt` rounded down (solady `FixedPointMathLib.sqrt`).

**Taker sells `n` claims of side X back.**
- The unit bid falls: `b(q) = b0 − λq`, where `b0 = m − h`. Require `b0 > 0`, else `NoQuote`.
- Exact-in `n`: `amountOut = floor(n · b0 − λ n² / 2)`. Require `n ≤ b0 / λ`.
- Exact-out `x` WETH: `n = ceil((b0 − sqrt(b0² − 2λx)) / λ)`. Require `b0² ≥ 2λx`.
- The WETH paid out must be ≤ the strategy's WETH virtual balance, else `InsufficientInventory`.

**Rounding favours the maker everywhere:**
- the amount the taker pays: ceil;
- the amount the taker receives: floor;
- units sold to the taker: floor;
- units taken from the taker: ceil.

### 7.5 Measured LVR (CRE and `data/`)

For each swap, with amounts from the **pool's** point of view:
- **v3:** event amounts are already pool-perspective (positive = pool received) `[M]`, consistent with DefiLlama fees within 1–12%.
- **v4:** event amounts are **swapper**-perspective (negative = swapper paid) per `Pool.sol:453-460`, despite the NatSpec. **Negate them** `[S]`.

```
value_i  = a0·P_UNI(t) + a1·P_ETH(t)          # USD, P = Binance 1m kline interpolated to the swap's second
fee_i    = feeRate · (positive leg value)
lvr_i    = fee_i − value_i
volume_i = |a0| · P_token0(t)   # token0 leg; matches data/markout_pool.py and the backtest calibration
```

`LVR = Σ lvr_i`; `volume = Σ volume_i`.

### 7.6 Premium rule

`pips_next = min(MAX_PREMIUM_PIPS, max(0, K · LVR_prev / volume_prev · 1e6))`, with defaults `K = 0.5` and `MAX_PREMIUM_PIPS = 3000`.

**Backtest** on 102 real consecutive UNI/WETH week pairs (`data/backtest_premium.py`) `[M]`, derived:
- charged $4.83M, equal to 49% of measured arbitrage loss;
- never exceeded that week's loss;
- **upper bound:** it assumes the premium causes no lost volume.

## 8. CRE workflow (`cre/workflow.ts`, TypeScript SDK `@chainlink/cre-sdk`)

All limits are from research/chainlink.md §2, and the simulator enforces them: 15 EVM reads, 15 HTTP calls of 250 KB each, 100 blocks per `filterLogs`, 25 KB of consensus input, 5 minutes per run.

**Run budget** (one execution):

| Step | Capability | Calls |
|---|---|---|
| 1. `lastProcessedBlock` from `TremorReceiver` | `callContract` | 1 |
| 2. Swap logs `[from, from + 1,199]` in 100-block chunks | `filterLogs` | 12 |
| 3. Timestamps of the span's first and last block via `Multicall3.getCurrentBlockTimestamp()` at those blocks `[M]` | `callContract` | 2 |
| 4. Binance `UNIUSDT` and `ETHUSDT` 1m klines for `[tsFrom − 60 s, tsTo + 60 s]` (≤ 300 rows each) | HTTP | 2 |
| 5. Per swap: timestamp interpolated linearly by block within the span (≤ a few slots of error); prices interpolated within the minute; §7.5 maths | node mode | – |
| 6. Return `{fromBlock, toBlock, toTimestamp, lvrUsdWad, volumeUsdWad, nSwaps}`; consensus via `ConsensusAggregationByFields` (identical integers expected) | consensus | 1 |
| 7. `runtime.report` + `evmClient.writeReport` to `TremorReceiver` | write | 1 |

That is 15 EVM reads (at the limit) and 2 HTTP calls.

**Trigger:**
- Cron `0 0 * * * *` (hourly) in production. 1,200 blocks is about 4 hours, so hourly runs keep up with about 3× headroom.
- **Backfill** for the demo: `cre/backfill.sh` loops `cre workflow simulate --broadcast --non-interactive --trigger-index 0` until `lastProcessedBlock` reaches the target. A week is about 50,400 blocks, so about 42 runs.

**Source config:**
- **Fork demo:** `source = {kind: "v3", address: 0x1d42…d801}`. This measures the real UNI/WETH flow. The new v4 pool on the fork has only scripted swaps.
- **Production:** `{kind: "v4", poolManager, poolId}`. Swap events are filtered by the `id` topic, and amounts are negated (§7.5).

**Simulation against the fork** `[S]`, not documented, based on the cre-cli source:
- Point the `ethereum-mainnet` RPC in `project.yaml` at the Anvil fork. The mock forwarder `0xa3d1…a7d9` already exists in forked state.
- Fallback: an `experimental-chains` entry with `--allow-unknown-chains`.
- Needs `cre login`.
- **Gate:** one successful `--broadcast` write on the fork by hour 2.

## 9. Frontend (`web/`, new design; v1 UI is not reused)

1. **LP view:**
   - the pool's measured LVR and the premium for this epoch (from `Measured` / `PremiumSet` events);
   - hook-fee balance; LONG held and its current mark (`market.quote`, labelled "estimate");
   - pending and dripped payouts.
2. **Trader view:**
   - buy or sell LONG or SHORT for the live window via `router.quote`, then `router.swap`;
   - the shown price is the exact `quote` result for that size (I4);
   - the effective-vs-actual collateral ratio.
3. **Data view:**
   - the 104-week UNI/WETH chart (from `data/`) and the backtest, labelled "measured" and "derived, upper bound".

## 10. End-to-end flows

**F1, setup (fork):**
1. Deploy market, router, vault and receiver; mine and deploy the hook.
2. Create the v4 pool and seed liquidity.
3. `createWindow` for the live week, plus demo windows `[2025-10-06, 2025-10-13)` and `[2025-02-24, 2025-03-03)`, which need `ALLOW_PAST_WINDOWS`.
4. The vault calls `openWindow` for each.

**F2, CRE measures:** backfill the week before the demo window → the epoch closes → `PremiumSet`.

**F3, fee accrual:** scripted swaps on the v4 pool pay `premiumPips` as ERC-6909 claims to the hook.

**F4, buy cover:** `handleHookFees` → UNI converted to WETH → `router.swap(WETH → LONG)` through `0x22`. The trace shows instruction index 0x22.

**F5, settle:**
1. `checkpoint` until done, then `finalize` on the demo window. This uses real Chainlink rounds; the payout is fixed by the data alone.
2. `hook.claimPayout`, then `drip` over N blocks → `Donate` events.

**F6, vault close:** `closeWindow` (dock) → `settle` → `withdraw`.

## 11. Parameters (defaults, all immutable or owner-set before `openWindow`)

| Parameter | Default | Basis |
|---|---|---|
| `MIN_WINDOW` | 7 days | [M] noise of daily vs weekly estimates |
| `S` | 1e18 (1 WETH) | |
| `V_cap` | 2.25e18 (150% vol) | [M] UNI/ETH weekly vol: median 57%, p90 104%, max 436% (week of 2025-10-06) |
| `vFwd` | 0.33e18 (≈57% vol) | median measured weekly vol |
| `h0` / `hMin` | 5% / 1% of S | design |
| `λ` | 0.002·S per whole token | design; tune with reference vectors |
| `κ` | 0.001·S per whole token of skew | design |
| `FINALIZE_DELAY` | 1 hour | design |
| `K`, `MAX_PREMIUM_PIPS` | 0.5, 3000 | [M] backtest |
| `GRACE` | 1 day | design |
| `HANDLE_INTERVAL` | 1 hour | design |
| `MAX_CONVERT_SLIPPAGE`, `SLIP` | 1%, 1% | design |
| `dripBlocks` | 300 (≈1 h) | design |

## 12. Tests and acceptance criteria

**Unit and fuzz (Foundry)**
- **RealizedVariance:**
  - stops at `updatedAt == 0`, `updatedAt ≥ t1` and `maxRounds`;
  - `PhaseChanged`;
  - `BadRound`;
  - p0 anchoring;
  - Q matches `reference/` vectors within 1 wei.
- **Payoff:** `payoutLong + payoutShort == S` for fuzzed V (I2), and the cap holds.
- **Pricing:**
  - every quote branch matches `reference/pricing_reference.py` vectors exactly (an independent exact-rational model, written from §7.4);
  - the inverse functions round-trip within one unit under maker-favouring rounding.
- **Market invariant (fuzz):** `WETH.balanceOf(market) ≥ Σ_w setsOutstanding_w · S` (I1) across mint, burn, finalize and redeem sequences.
- **Hook:**
  - fee = `ceil(|unspecified| · pips / 1e6)` for exact-in and exact-out in both directions;
  - fee is 0 after `premiumValidUntil`;
  - `setPremium` is only callable by the receiver and is capped;
  - `handleHookFees` makes no Aqua call while the PoolManager is unlocked;
  - `drip` reverts with no in-range liquidity;
  - the JIT penalty test, if built.
- **Receiver:** contiguity; epoch close sets pips per §7.6; 64-byte metadata accepted.

**Fork tests** (Anvil mainnet fork, pinned block)
- **A1:** `TremorAquaSwapVMRouter` ≤ 24,576 bytes. Shipping a strategy on the **deployed** Aqua works, and `quote` equals `swap` amounts for 20 fuzzed sizes (I4).
- **A2:** WETH → LONG and LONG → WETH fills through `0x22`, with Aqua `Pulled`/`Pushed` events and token transfers.
- **U1:** a swap through the hook mints the expected claims, and `handleHookFees` ends with the hook holding LONG.
- **C1:** `finalize` on `[2025-10-06, 2025-10-13)` from real UNI/ETH rounds yields V and a payout. Record both in the README as the measured result.
- **E2E:** F1–F5 in one script, printing a transaction hash per step.

**CRE:** `cre workflow simulate --broadcast` writes one report on the fork, and `Measured` is emitted. The backfill of one historical week produces a `PremiumSet`, whose pips are compared with `data/backtest_premium.py` for the same week.

**Done** = A1, A2, U1, C1, E2E and CRE all pass; the README has the evidence links; the video is 2–4 minutes.

## 13. Demo script (video 2–4 minutes, ≥720p, no TTS or speed-up; finalist slot is 4 minutes of demo + 3 of Q&A)

1. **Problem (20 s):** "In UNI/WETH, arbitrage took 93% of LP fees over two years. LPs lost $137,516 in the week of 6 Oct 2025."
2. **CRE (30 s):** the backfill measures that week from real swaps and Binance prices → `PremiumSet`.
3. **Hook (30 s):** a swap pays the hook fee; `handleHookFees` buys LONG; the trace shows `0x22`.
4. **Aqua (30 s):** a taker quotes, then swaps; effective vs actual collateral is shown.
5. **Settlement (30 s):** finalize the 6 Oct 2025 window from Chainlink rounds; payout; drip donate to LPs.
6. **Honesty (20 s):** the backtest recovers 49% as an upper bound, the volume risk is stated, and VolatilePair is complementary.

## 14. Compliance checklist

**ETHGlobal:**
- [ ] **New** public GitHub repo, created after kickoff (Thu 5 Nov, 21:00 IST). Not a fork or branch of v1 (§0).
- [ ] Planning docs were the first commit, pushed.
- [ ] Commits from every member, **pushed at least hourly**; no force-push or squash of `main`.
- [ ] Final push and `submission` tag before Sat 09:00 IST.
- [ ] `PRIOR_WORK.md` and written disclosure to staff.
- [ ] `AI_USAGE.md`.
- [ ] Spec and planning docs committed.
- [ ] Video 2–4 minutes.
- [ ] Submit by **Sat 7 Nov, 09:00 IST**.
- [ ] ≤ 3 partner prizes + Finalist.

**1inch:**
- [ ] Official Aqua registry.
- [ ] Redeployed modified SwapVM router (allowed).
- [ ] On-chain transfers in the demo.
- [ ] No single-commit final day.

**Uniswap:**
- [ ] Public repo.
- [ ] `FEEDBACK.md`.
- [ ] Developer Feedback Form with the link.
- [ ] README links the exact hook lines.

**Chainlink:**
- [ ] The workflow integrates a chain and an external API.
- [ ] Successful CLI simulation logged.
- [ ] Meaningfully used: premiums depend on it.

## 15. Prior work and provenance
- **Tremor (ETHOnline 2026)** `github.com/zeel991/tremor`. It was a variance market on Base Sepolia that used a self-deployed Aqua and router, stock SwapVM instructions with an `Extruction` callback, a fixed sampling grid, and MockUSDC. It won no prizes.
- **New in this build:**
  - a custom SwapVM instruction on the **deployed** Aqua registry;
  - one three-token strategy with complete-set collateral;
  - tick-level settlement on the UNI/ETH feed;
  - the Uniswap v4 hook-fee insurance loop;
  - CRE measurement of arbitrage loss;
  - the 104-week LVR dataset.
- **Ideas carried over:** variance claims, and LONG/SHORT complementarity. Both are re-derived here (§7); no code, design or asset is copied.
- **Pending:** ETHGlobal staff's written ruling on eligibility (plan §0).

## 16. Open items to close in hours 0–2
0. The new repo exists, and the first commit (the planning docs) is pushed (§0).
1. The written eligibility ruling from ETHGlobal staff.
2. The router size gate (§6.3).
3. A CRE `--broadcast` write on the Anvil fork (§8).
4. The v1.0.2 Aqua-mode token flow for `tokenIn`: confirm against `SwapVM.sol:217-287` in a fork test before building the frontend.
5. That CRE `filterLogs` returns `blockNumber` per log, needed for timestamp interpolation. If it also returns `blockTimestamp`, drop step 3 of §8.
6. That the v4 `Swap` event's sign (swapper-perspective) shows up as expected in a fork test.
