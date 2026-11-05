# Uniswap v4: checking the technical claims behind Tremor

Researched 2026-11-06. Sources are limited to official Uniswap docs, `Uniswap/v4-core`, `Uniswap/v4-periphery` and `OpenZeppelin/uniswap-hooks`. No code was built or run, and no on-chain call was made. Every finding below comes from reading source code or docs (a **structural** check).

## Sources and pinned commits

| Source | Commit / fetch | Local copy |
|---|---|---|
| github.com/Uniswap/v4-core | `bea7f6d1` (2026-10-23) | `…/scratchpad/research_src/v4-core` |
| github.com/Uniswap/v4-periphery | `c6e4754d` (2026-10-26) | `…/scratchpad/research_src/v4-periphery` |
| github.com/OpenZeppelin/uniswap-hooks | `b5f10574` (2026-10-07), package v1.3.0 | `…/scratchpad/research_src/uniswap-hooks` |
| Uniswap docs | fetched 2026-11-06 | `…/scratchpad/research_src/uniswap_docs/*.md` |

The scratchpad root is `<scratchpad>`.

**Docs host:** `docs.uniswap.org/contracts/v4/*` now returns a 301 redirect to `developers.uniswap.org/docs/protocols/v4/*`. The pages were read through the official raw-markdown mirror at `developers.uniswap.org/llms.mdx/docs/...`. Doc URLs below use the human-readable form.

**Repo layout change (affects every import path in the docs):** v4-periphery commit `5da22e609f` (2026-02-06, "remove hooks and move to hook repo (#510)") removed `src/utils/BaseHook.sol` and `src/utils/HookMiner.sol`. The official docs still import `v4-periphery/src/utils/BaseHook.sol` and `v4-periphery/src/utils/HookMiner.sol`, and neither path exists on `main`. The v4-periphery `README.md:17` now points BaseHook users to `Uniswap/v4-hooks-public`, a repo outside the allowed sources that was not read. **The spec should use OpenZeppelin's `BaseHook`** (`uniswap-hooks/src/base/BaseHook.sol`).

---

## 1. A hook taking a fee for itself on swaps: **PARTLY**

The mechanism is VERIFIED. The plan's claim that the fee must be taken *in beforeSwap with beforeSwapReturnDelta* is only one of two documented routes. OpenZeppelin's ready-made base uses **afterSwap + afterSwapReturnDelta** instead.

**Evidence: core mechanics**
- `v4-core/src/types/BeforeSwapDelta.sol:4-16`: `BeforeSwapDelta` is an int256. The upper 128 bits are the **specified**-currency delta and the lower 128 bits are the **unspecified** delta. Built with `toBeforeSwapDelta(int128 specified, int128 unspecified)`.
- `v4-core/src/libraries/Hooks.sol:111-112`: `BEFORE_SWAP_RETURNS_DELTA_FLAG` without `BEFORE_SWAP_FLAG` is an invalid address. The same rule applies to the afterSwap pair.
- `Hooks.sol:266-279`: the specified delta is added to `amountToSwap`. If that flips exact-in/exact-out, the call reverts with `HookDeltaExceedsSwapAmount`.
- `Hooks.sol:295-312`: the before-swap unspecified delta and the afterSwap `int128` return are summed. Then "the caller has to pay for (or receive) the hook's delta" (`:311`), i.e. `swapDelta = swapDelta - hookDelta`.
- `v4-core/src/PoolManager.sol:224`: the hook delta is booked to `address(key.hooks)` and the swapper's delta to `msg.sender` (`:226`). A positive hook delta is a credit to the hook.
- **Specified vs unspecified:** the specified currency is `currency0` iff `(amountSpecified < 0) == zeroForOne` (`uniswap-hooks/src/base/BaseCustomCurve.sol:100-101`, `fee/BaseHookFee.sol:70-72`). For exact-in (`amountSpecified < 0`), specified is the input and unspecified is the output. For exact-out, specified is the output and unspecified is the input. The docs confirm this mapping: "exactIn → unspecified = output token" (developers.uniswap.org/docs/protocols/v4/guides/custom-accounting).

**Evidence: how the hook receives the currency**
- `PoolManager.sol:291-297` `take()` debits the hook's delta and transfers ERC-20. `:322-329` `mint()` debits the delta and mints **ERC-6909 claims**. `:332-336` `burn()` reverses `mint()`.
- Docs (custom-accounting, Step 2.2 note): `take()` "requires an ERC20 balance on the PoolManager". The docs recommend `poolManager.mint()` instead. Inside `beforeSwap` the swapper has not paid yet, so **use `mint`, not `take`**.
- OZ `uniswap-hooks/src/utils/CurrencySettler.sol:82-89` `take(..., claims=true)` calls `poolManager.mint`. `:48-72` `settle(..., burn=true)` calls `poolManager.burn`.

**Official and OpenZeppelin examples**
- Docs: "Implementing Hook Fees" (custom-accounting). The beforeSwap variant calls `take()` on the *specified* currency and returns `toBeforeSwapDelta(+fee, 0)`. The afterSwap variant returns `int128(fee)` on the unspecified currency.
- **OpenZeppelin `src/fee/BaseHookFee.sol`** (v1.3.0, lines 35-126): `_afterSwap` computes `fee = ceil(|unspecifiedAmount| * hookFee / 1e6)` (`:82`), mints claims to the hook (`:86`) and returns `feeAmount` as the afterSwap delta (`:95`). The abstract `_getHookFee(...)` (`:50-56`) is a per-swap **view**, so the fee can depend on our variance reading. The abstract `handleHookFees(Currency[])` (`:101`) is where the accrued fees are spent. Flags: `afterSwap` + `afterSwapReturnDelta` (`:108-125`).
- Redeem pattern: `src/mocks/fee/BaseHookFeeMock.sol:42-61`. The hook calls `poolManager.unlock`. In `unlockCallback` it burns claims (`settle(..., true)`) and then takes the ERC-20 (`take(..., false)`).
- Custom-curve example (full NoOp): `src/base/BaseCustomCurve.sol:90-156`, with exact-in and exact-out branches at `:112-128`.

**Pitfalls (from the sources)**
- **Partial fills:** a beforeSwap fee is computed on the *requested* amount. The docs say afterSwap charges "on the **actual output**" and is preferable when swaps hit price limits (custom-accounting, "When to prefer afterSwap?").
- **Fee currency differs by direction:** with the afterSwap/unspecified approach, the premium accrues in **both** tokens (output token on exact-in, input token on exact-out). The Aqua leg must handle both currencies, or convert one.
- **Composition:** an afterSwap fee "does not apply to the amount consumed by a `BeforeSwapDelta`" (`uniswap-hooks/src/base/BaseHook.sol:28-29`). If two parents override the same callback, the final contract must merge them explicitly (`BaseHook.sol:24-26`).
- **Self-calls skip hooks:** if `msg.sender == hook`, the hook calls and fees are skipped (`Hooks.sol:253`, `:293`).
- **NoOp risk:** a `BeforeSwapDelta` that consumes the whole input bypasses the curve. The docs cite the Bunni exploit (developers.uniswap.org/docs/protocols/v4/security, "BeforeSwapDelta and NoOp override risks").
- **Integrator caveat:** hooks with return-delta flags "may alter the swap input/output" (`v4-core/src/interfaces/IPoolManager.sol:143-144`).
- **Fee-on-transfer tokens** are unsupported by `CurrencySettler` (`CurrencySettler.sol:21-22`).

**What the spec should say:** Tremor charges its premium as a **hook fee**, not an LP fee. The spec should inherit OZ `BaseHookFee` and override `_getHookFee` so that it returns `premiumPips` when `VarianceMarket.realizedVariance() > threshold` and 0 otherwise. Flags: `AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA`. The fee is taken in the unspecified currency, rounded up, and minted to the hook as ERC-6909 claims. If the team insists on beforeSwap, follow the docs' "Implementing Hook Fees" variant, with `mint` instead of `take` and `BEFORE_SWAP | BEFORE_SWAP_RETURNS_DELTA`. In that case the spec must state the partial-fill overcharge.

## 2. Dynamic fees go to LPs: **VERIFIED**

The plan's belief in (d) is correct: a dynamic **LP** fee cannot be routed to the hook.

**Evidence**
- Docs: dynamic fees are "a specific type of swap fee paid by swappers that directly accrue to liquidity providers", "distinct from protocol fees and hook fees" (developers.uniswap.org/docs/protocols/v4/concepts/dynamic-fees).
- **Override mechanics:**
  - The pool must be created with `fee == DYNAMIC_FEE_FLAG (0x800000)`. Dynamic-fee pools start at fee 0 (`v4-core/src/libraries/LPFeeLibrary.sol:15,47-55`).
  - `beforeSwap` returns `fee | OVERRIDE_FEE_FLAG (0x400000)` (`LPFeeLibrary.sol:17-19`). It is honoured only for dynamic-fee pools (`Hooks.sol:261-263`) and applied in `Pool.sol:303-304`.
  - Alternatively, `PoolManager.updateDynamicLPFee` (`PoolManager.sol:339-345`) can be called only by `key.hooks`, and only on a dynamic-fee pool.
  - OZ bases: `src/fee/BaseOverrideFee.sol:56-65` (per swap) and `src/fee/BaseDynamicFee.sol` (via `updateDynamicLPFee`).
- **Where the fee goes:** `Pool.sol:384-397` carves out the protocol share. `:400-405` adds the remainder to `feeGrowthGlobal` for in-range liquidity. Nothing in core sends LP fees to the hook.
- **Ways to get value to the hook:**
  - (i) A **hook fee** via a return delta (item 1). A *dynamic hook fee* is simply a variable `_getHookFee`.
  - (ii) Hook-owned liquidity: OZ `src/base/BaseCustomAccounting.sol:23-30` makes "the hook … the sole owner of the liquidity". LP fees then accrue to the hook's position, but this changes the whole LP model.
  - OZ `src/fee/BaseDynamicAfterFee.sol` is named "dynamic" but is a **hook** fee (target-based, afterSwap).
- **Doc inconsistency:** the dynamic-fees doc says the beforeSwap hook "calls the `updateDynamicLPFee` function". Per-swap overrides actually work through the return value (`Hooks.sol:263`). Trust the code.

**What the spec should say:** "The fallback (dynamic LP fee via `BaseOverrideFee`) pays LPs directly through `feeGrowthGlobal` (v4-core `Pool.sol:400-405`). It cannot fund the variance purchase. If we need a dynamic charge that funds (b), it is a dynamic *hook* fee (`BaseHookFee._getHookFee`)."

## 3. `donate()`: **PARTLY**

Semantics, permissions and the JIT risk are VERIFIED. "Drip over many blocks" is NOT FOUND as an official mitigation.

**Evidence**
- **Who receives it:** in-range liquidity only. `IPoolManager.sol:149` says "Donate … to the in-range liquidity providers of a pool". `:152-155`: it donates at `slot0.tick`, which in an edge case can be one tick below the tick implied by the price.
- `Pool.sol:466-480`: `feeGrowthGlobal += amount * Q128 / liquidity`. It reverts with `NoLiquidityToReceiveFees` when active liquidity is 0 (`:468`).
- **Who can call:** any address, as long as the PoolManager is unlocked (`PoolManager.sol:256-259`, `onlyWhenUnlocked`).
  - The donor's delta is negative (`:270`, `_accountPoolBalanceDelta(key, delta, msg.sender)`) and must be settled before the outer `unlock` returns. Otherwise the call fails with `CurrencyNotSettled` (`:112`).
  - Settle with `sync` + ERC-20 transfer + `settle()`, or by burning ERC-6909 claims (`CurrencySettler.sol:48-72`).
  - When the pool's own hook donates, `beforeDonate`/`afterDonate` are skipped (`Hooks.sol:171-175`, `noSelfCall`).
- **Precedent of a hook donating from inside a callback:** OZ `src/general/LiquidityPenaltyHook.sol:167-169` calls `poolManager.donate(key, …)` inside `_afterRemoveLiquidity`, after a `getLiquidity == 0` guard (`:165`).
- **JIT risk (documented):** `IPoolManager.sol:150`: "Calls to donate can be frontrun adding just-in-time liquidity". Also `:151`: "Donors should keep this in mind". `IPoolManager.sol:131-132` adds that a lone LP can donate to themselves to inflate `feesAccrued`.
- **Mitigation:**
  - Core docs give no specific recommendation (**NOT FOUND**). No source recommends dripping.
  - OZ ships `src/general/LiquidityPenaltyHook.sol`. It withholds or penalises fees for liquidity added fewer than `blockNumberOffset` blocks ago and donates the penalty to in-range LPs (`:23-27`).
  - Its own warning (`:35-39`): the penalty goes to all in-range liquidity, including liquidity the remover controls, so thin pools stay vulnerable.
  - `AntiSandwichHook.sol:44-46` recommends combining with it.
- **Inference (not from sources):** a permissionless `drip()` can be sandwiched atomically in one transaction: add liquidity, `drip()`, remove liquidity, each in its own unlock. Dripping only caps the value per call. It does not prevent the capture.

**What the spec should say:** "Payouts are donated with `PoolManager.donate()` to liquidity in range at `slot0.tick`. The donation is drip-rate-limited per block, guarded by `getLiquidity > 0`, and settled in the same unlock. Core docs flag donate as JIT-frontrunnable (`IPoolManager.sol:150`). We additionally inherit or port OZ `LiquidityPenaltyHook` (`blockNumberOffset` ≥ drip period) so liquidity added inside the window forfeits donated fees. Dripping alone is our own heuristic, not an official mitigation."

## 4. External calls from beforeSwap/afterSwap: **VERIFIED** (allowed, with constraints)

**Evidence**
- Nothing in core forbids external calls from hook callbacks. The PoolManager only checks the return length and selector (`Hooks.sol:131-157`).
- **Lock constraints:**
  - During a swap the manager is already unlocked by the router. A hook calling `poolManager.unlock()` reverts with `AlreadyUnlocked` (`PoolManager.sol:105`).
  - The hook *can* call `take`/`settle`/`mint`/`burn`/`donate`/`swap` directly, because they only require `onlyWhenUnlocked` (`:96-99`).
  - Any delta the hook creates must net to zero before the router's `unlock` returns (`:112`).
  - Outside a swap (e.g. a keeper function), the hook must open its own `unlock` and implement `unlockCallback`, as in `BaseHookFeeMock.sol:42-61`.
- **Security framework** (developers.uniswap.org/docs/protocols/v4/security, "External calls, reentrancy, and state drift"):
  - "Any external call made during `beforeSwap`, `afterSwap` … reopens the entire execution environment".
  - Core principle: "assume *every* piece of state may change".
  - The oracle-dependency section lists "stale or manipulated oracle prices".
  - The dynamic-fee risks include "Fees can be raised selectively after seeing a user's trade".
- `CurrencySettler.sol:24-28`: ERC-20 or native transfers hand control to external code while the manager is unlocked. Follow checks-effects-interactions.
- OZ BaseHook entry points are `onlyPoolManager` (`BaseHook.sol:69-72`). Use `onlyValidPools` for externally callable functions that take a `PoolKey` (`:83-86`).

**What the spec should say:** "`_getHookFee` makes one `view` (STATICCALL) read of `VarianceMarket`. **No Aqua calls happen inside swap callbacks.** The Aqua purchase happens in a separate, rate-limited `handleHookFees()`/`rollPremium()`. That function unlocks the manager, burns claims, takes the ERC-20, exits the unlock, then calls Aqua under a reentrancy guard. VarianceMarket's variance must not be manipulable within the same block or transaction, because the swapper controls ordering."

## 5. Deployment: flag bits, HookMiner, local fork: **PARTLY**

Mechanics are VERIFIED. The docs' HookMiner import path is CONTRADICTED by current v4-periphery `main`. Local-fork specifics are NOT FOUND beyond `deployCodeTo`.

**Evidence**
- Flags are the low 14 address bits (`Hooks.sol:27`, `ALL_HOOK_MASK = (1<<14)-1`). Individual bits are at `:29-47`; for example `BEFORE_SWAP = 1<<7`, `AFTER_SWAP = 1<<6`, `BEFORE_SWAP_RETURNS_DELTA = 1<<3`, `AFTER_SWAP_RETURNS_DELTA = 1<<2`.
- OZ `BaseHook` constructor calls `Hooks.validateHookPermissions(this, getHookPermissions())` (`BaseHook.sol:61-64,100-102`). A mismatched address reverts at deploy (`Hooks.sol:85-102`).
- HookMiner: `v4-periphery/test/shared/HookMiner.sol:23-41` loops salts up to `MAX_LOOP = 160_444` (`:14`) until `addr & FLAG_MASK == flags`. For `forge script` the deployer is `0x4e59b44847b379578588920cA78FbF26c0B4956C` (`:18`). For `forge test` it is the test contract or prank address (`:17`).
- The docs import `v4-periphery/src/utils/HookMiner.sol`, but GitHub history shows that file was moved ("move hook miner (#446)", 2025-02-12). The current file is `test/shared/HookMiner.sol`.
- Docs (developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment): "For local testing, `deployCodeTo` cheatcode in Foundry can be used". OZ tests do exactly this (`uniswap-hooks/test/fee/BaseHookFee.t.sol:39-40`).
- Docs: the Uniswap Foundation `v4-template` includes HookMiner deploy scripts "on local Anvil and production networks" (developers.uniswap.org/docs/community/tooling/v4-template). That repo was not read.

**What the spec should say:**
- Tests use `deployCodeTo` at `address(uint160(FLAGS))`.
- Fork and testnet deploys use HookMiner (copy `v4-periphery/test/shared/HookMiner.sol` into the repo, since it is no longer under `src/`) with the CREATE2 proxy `0x4e59…956C`, then `require(deployed == mined)`.
- CI asserts `uint160(hook) & ALL_HOOK_MASK == FLAGS`. The security doc says teams "must compute and verify the expected permission bitmap".
- Whether the CREATE2 proxy exists on the chosen fork is an open item. Check `eth_getCode` at runtime.

## 6. PoolManager and PositionManager addresses: **VERIFIED from the docs page**

These addresses come from developers.uniswap.org/docs/protocols/v4/deployments. They were **not** checked on-chain. The page warns integrators to "no longer assume … the same addresses across chains".

| Chain (id) | PoolManager | PositionManager |
|---|---|---|
| Ethereum (1) | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` |
| Base (8453) | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` |
| Unichain (130) | `0x1f98400000000000000000000000000000000004` | `0x4529a01c7a0410167c5740c487a8de60232617bf` |
| Sepolia (11155111) | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| Unichain Sepolia (1301) | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` | `0xf969aee60879c54baaed9f3ed26147db216fd664` |
| Base Sepolia (84532) | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80` |

Sources are lines 16/18 (Ethereum), 58/60 (Base), 30/32 (Unichain), 305/309 (Sepolia), 291/294 (Unichain Sepolia) and 320/323 (Base Sepolia) of the fetched `deployments.md`.

**What the spec should say:** cite this table with the fetch date. Before any deploy, re-check `eth_getCode` on the target RPC.

## 7. LVR, arbitrage and volatility fees: prior art to cite or differentiate from: **VERIFIED (found)**

**Prior art that makes a "volatility-aware fee" look derivative**
- **Uniswap Labs `VolatilePair` hook** (developers.uniswap.org/docs/protocols/uniswap-labs-hooks/volatile-pair/overview): "a Uniswap v4 dynamic fee hook for volatile pairs such as ETH/USDC".
  - Its goals include "**Lower LVR.** The side that informed flow trades on pays more" and "LPs share backrun value".
  - It is live on **Ethereum ETH/USDC** (pool id `0x98316e84…a3eea`, hook proxy `0x000022Ec4eBD6b12294396E852E4C3876b253Cc0`) and on Robinhood Chain (volatile-pair/deployments).
  - Its fees are **LP** fees. Only Uniswap Labs can create its pools.
- **`StablePair`** (Uniswap Labs): a dynamic LP fee from deviation against a reference rate.
- **Docs' dynamic-fees concept page** lists "Volatility-Based Fees: Adjust fees based on the historical or realized volatility" and "Cross-Pool Arbitrage Mitigation" as canonical use cases, and says "During high volatility, fees can increase to protect liquidity providers".
- **OZ examples to cite:**
  - `BaseHookFee` (our base).
  - `BaseOverrideFee`/`BaseDynamicFee` (the fallback).
  - `LiquidityPenaltyHook` (JIT).
  - `AntiSandwichHook` (block-open price bound, excess taken as a hook fee).
  - `BaseDynamicAfterFee`.
- Neither OZ hooks nor v4-core mention "LVR" (grep: 0 hits).

**What the spec should say:**
- Do **not** pitch Tremor as "a volatility-based dynamic fee". That is a listed docs use case and a live Uniswap Labs product on ETH/USDC.
- The differentiator to state: the premium is a **hook fee** that buys **external variance protection** (Aqua) and **returns payouts to LPs via donate**. It is an insurance loop, not a fee curve.
- Cite VolatilePair as the LP-fee approach we are complementary to.
- Prefer UNI/WETH over ETH/USDC to avoid direct overlap with the VolatilePair pool. That is a product suggestion, not a source finding.

---

## Recommended hook skeleton

**Inherit:**
- `BaseHookFee` (`OpenZeppelin/uniswap-hooks` `src/fee/BaseHookFee.sol`, v1.3.0). It brings `BaseHook` with `onlyPoolManager`, address validation and `IHookEvents`.
- `IUnlockCallback` (`v4-core/src/interfaces/callback/IUnlockCallback.sol`), for the keeper paths.
- Use `CurrencySettler` (`uniswap-hooks/src/utils/CurrencySettler.sol`).
- Optional for JIT defence: port `LiquidityPenaltyHook` logic and merge `getHookPermissions` manually (`BaseHook.sol:24-26`).

**Flags (minimal):** `AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG` = `(1<<6)|(1<<2)` = `0x44`.

**Flags with JIT penalty:** add `AFTER_ADD_LIQUIDITY | AFTER_REMOVE_LIQUIDITY | AFTER_ADD_LIQUIDITY_RETURNS_DELTA | AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA` = `(1<<10)|(1<<8)|(1<<1)|(1<<0)`. Total `0x547`.

| Function | Purpose |
|---|---|
| `getHookPermissions()` | Returns exactly the flags above; checked against the mined address in the constructor. |
| `_getHookFee(sender,key,params,delta,hookData)` (view) | Reads `VarianceMarket.realizedVariance()`; returns `premiumPips` if above the threshold, else 0. |
| `_afterSwap(...)` (inherited, optionally extended) | Mints the premium to the hook as ERC-6909 claims in the unspecified currency and returns it as the afterSwap delta. |
| `handleHookFees(Currency[])` (permissionless, rate-limited) | Calls `poolManager.unlock` to burn claims and take ERC-20, then buys the Aqua variance claim *outside* the unlock (nonReentrant). |
| `unlockCallback(bytes)` (`onlyPoolManager`) | Dispatches either REDEEM (burn claims + take) or DRIP (`donate` + settle the donor delta). |
| `onPayout(...)` / `drip(PoolKey)` | Records an Aqua payout, then donates `pending * blocksElapsed / dripBlocks` per call; skipped if `getLiquidity == 0`. |
| `_afterAddLiquidity` / `_afterRemoveLiquidity` (optional) | `LiquidityPenaltyHook`-style withholding so liquidity added within `blockNumberOffset` blocks cannot collect dripped donations. |

**Pool and deploy:**
- Pool key `fee` can stay static (e.g. 3000). A dynamic `0x800000` fee is needed only for the fallback, which would add `beforeSwap` + `afterInitialize` and `BaseOverrideFee`.
- Deploy with HookMiner (copied from `v4-periphery/test/shared/HookMiner.sol`) via CREATE2 `0x4e59…956C`.
- Use `deployCodeTo` in tests.
