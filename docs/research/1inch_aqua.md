# 1inch Aqua / SwapVM: checking the Tremor plan's claims

Researched 2026-11-06. Sources are the official repos and docs only. All checks are **structural**: I read the code and docs. I compiled nothing, ran no tests and made no on-chain calls.

## Sources

| Source | Revision |
|---|---|
| `github.com/1inch/aqua` `main` | `86abe30` (2026-11-05) |
| `github.com/1inch/aqua` tag `v1.0.1` | `7219b17`. `Aqua.sol`, `IAqua.sol`, `AquaApp.sol`, `AquaRouter.sol` and `Balance.sol` are byte-identical to `main` |
| `github.com/1inch/swap-vm` `main` | `f9f4acf` (2026-11-04). Paths are under `contracts/` |
| `github.com/1inch/swap-vm` tag `v1.0.2` | `32c687c` (2026-07-26). Paths are under `src/`. **This is the deployed router** (see claim 7) |
| Docs portal | `https://business.1inch.com/portal/documentation/aqua/...` |
| Prize page | `https://ethglobal.com/events/mumbai/prizes/1inch` |

In this file, `aqua:` means the aqua repo. `svm102:` means swap-vm `v1.0.2`. `svm-main:` means swap-vm `main`.

### Read this first: `main` is not what is deployed

The deployed router is **AquaSwapVMRouter v1.0.2** at `0x111111338c5091e8440b67b168bae16a668ac0de`. Sources:
- docs `/reference/contract-addresses`: "Built from the `v1.0.2` tag"
- docs `/help/swapvm-faq`: "build against v1.0.2, which matches the on-chain router"

swap-vm `main` has a different ABI and a different opcode mechanism:
- `svm-main:README.md:280-282`: the deployed router "exposes the v1.0 ABI, `swap(order, tokenIn, tokenOut, amount, takerData)`", and "`main` uses `swap(order, amount, takerTraitsAndData)`".
- `main` uses fixed opcode bytes from `contracts/libs/OpcodeList.sol` (Extruction = `0x04`). v1.0.2 uses a function-pointer array (Extruction = index `0x20`).

The prize page links `swap-vm/tree/main`. **The spec should build on the `v1.0.2` tag**, so programs, the SDK and the deployed router all agree.

---

## 1. LONG and SHORT on the same maker balance, with a `CappedPayoffCurve` instruction enforcing collateral ≥ max(long, short)·S

**Verdict: PARTLY.** An instruction can read another strategy's Aqua balance, and it can call external contracts. Two problems remain:
- Two strategies cannot reference each other's hashes.
- Aqua virtual balances never check real collateral.

The workable form is one strategy that holds both legs.

**Evidence**

*Instructions can make external calls, including to Aqua.* In v1.0.2, instructions are internal functions of contracts mixed into the router. They run in the router's context, and the router holds the Aqua registry as an immutable.
- `svm102:src/SwapVM.sol:74`: `IAqua public immutable AQUA;`
- `svm102:src/instructions/Fee.sol:74-77`: the Fee mixin stores its own `_AQUA` immutable.
- `svm102:src/instructions/Fee.sol:270`: an official instruction calls `_AQUA.pull(...)` mid-swap, inside `runLoop`.
- `svm102:src/instructions/Controls.sol:116`: `IERC20(token).balanceOf(ctx.query.taker)`, an external view call.
- `svm102:src/instructions/Extruction.sol:91-116`: calls a maker-chosen contract, `IStaticExtruction` in quote and `IExtruction` in swap.
- `svm102:README.md` ("What Instructions CAN Do") lists "Make external calls" and "Execute fee transfers".

*Any strategy's balance can be read.*
- `aqua:contracts/Aqua.sol:24-31`: `rawBalances(maker, app, strategyHash, token)` has no access control and no activity check.
- `aqua:contracts/Aqua.sol:33-53`: `safeBalances(...)` reverts unless the token is in an active strategy.
- There is **no** function called `balances(...)`. The spec must use `rawBalances` or `safeBalances`.

*Problem A: mutual reference is impossible.*
- The strategy hash equals the order hash, which is `keccak256(abi.encode(order))` (`svm102:src/SwapVM.sol:97-100`).
- `order.data` contains the program (`svm102:src/libs/MakerTraits.sol`, Program slice).
- So if the LONG program embeds the SHORT strategy's hash and the SHORT program embeds the LONG hash, the hashes form a cycle. Only a one-way reference is possible, or the hashes must be looked up from a third contract at runtime.

*Problem B: virtual balances are not collateral.*
- `ship` only writes numbers: `aqua:contracts/Aqua.sol:55-72`, with no `balanceOf` or allowance check.
- Docs `/liquidity-layer/virtual-balances`: the registry "does not enforce a hard cap at `ship()`". Over-commitment, the Shared Liquidity Ratio ≥ 1, is by design.
- "Same maker balance" therefore gives no guarantee by itself. Any collateral rule has to read a real `balanceOf`, or vault state, inside the instruction or in a hook.

*One strategy can hold both legs (v1.0.2 only).*
- `aqua:contracts/Aqua.sol:62-63`: `ship` accepts up to 254 tokens.
- `svm102:src/SwapVM.sol:111-117,156-162`: the taker passes `tokenIn` and `tokenOut` explicitly.
- `svm102:src/SwapVM.sol:147-149,193-194`: balances come from `safeBalances(order.maker, address(this), orderHash, tokenIn, tokenOut)`.
- `svm102:src/libs/MakerTraits.sol:159-162`: the only pair check is `tokenIn != tokenOut`.
- So a strategy shipped with `[COLLATERAL, LONG, SHORT]` can serve COLLATERAL↔LONG and COLLATERAL↔SHORT swaps. Its instruction can read the other leg with `AQUA.rawBalances(ctx.query.maker, address(this), ctx.query.orderHash, otherLeg)`. The order hash is known at runtime, so there is no cycle.
- On `main` this does not work: the pair is fixed to `tokenA`/`tokenB` in `order.data` (`svm-main:contracts/libs/MakerTraits.sol:220-225`, `contracts/SwapVM.sol:130-131`).

*Aqua only moves ERC-20s.*
- `aqua:contracts/Aqua.sol:88`: `IERC20(token).safeTransferFrom(maker, to, amount)`.
- If LONG and SHORT are not ERC-20s held by the maker, a swap cannot deliver them through Aqua. **Open question for the spec:** what does the taker receive as `tokenOut`?

*Maker hooks are another enforcement point, but only in `swap`.*
- `svm102:src/SwapVM.sol:217-273`: `preTransferIn`, `postTransferIn`, `preTransferOut` and `postTransferOut` are external calls.
- `svm102:src/libs/MakerTraits.sol:226`: the hook target defaults to the maker.
- `quote()` never calls hooks (`svm102:src/SwapVM.sol:111-154`).

**What the spec should say instead**
- Drop the phrase "two strategies on the same maker balance enforce the cap."
- Choose one of these designs:
  - **(a) Recommended.** One strategy with three tokens on a redeployed v1.0.2-based router. `CappedPayoffCurve` reads both legs' Aqua balances under `ctx.query.orderHash`, plus real collateral through `IERC20.balanceOf(maker)` or a vault view.
  - **(b) No redeploy.** Keep two strategies with an `Extruction` callback (`0x20`) into the market contract, as in v1. The market can read both strategies' `rawBalances` because it can store both hashes after shipping. The trade-off is that the logic sits outside SwapVM, and the prize says SwapVM use is "scored higher".
  - **(c) Hooks.** Two strategies, with a vault maker whose `preTransferOut` hook enforces or mints. The trade-off is quote/swap divergence: quote succeeds, then swap reverts.
- A modelling note, not a source claim: if each S of collateral mints one LONG plus one SHORT as a complete set, then max(long, short)·S follows from inventory alone. That works with any of (a), (b) or (c).

## 2. Custom instructions appended after the official set in a redeployed AquaSwapVMRouter, without moving official indexes

**Verdict: PARTLY.** This is correct for v1.0.2, with the details below. On `main` the mechanism is different and does not use `_instructions()` at all.

**Evidence (v1.0.2)**
- `svm102:src/routers/AquaSwapVMRouter.sol:16-28`: `contract AquaSwapVMRouter is Simulator, SwapVM, AquaOpcodes`. It overrides `_instructions()` to `return _opcodes();`.
- `svm102:src/SwapVM.sol:293`: `function _instructions() internal pure virtual returns (function(Context memory, bytes calldata) internal[] memory)`.
- `svm102:src/opcodes/AquaOpcodes.sol:10`: "New instructions should be added at the end to maintain backward compatibility".
- `svm102:src/opcodes/AquaOpcodes.sol:32`: `_opcodes()` is `internal pure virtual`. It builds a 35-slot array and then drops slot 0 (lines 77-83).
- `svm102:src/libs/VM.sol:124-130`: the opcode byte is a direct array index (`ctx.vm.opcodes[opcode](ctx, args)`), so an index past the end reverts with an out-of-bounds panic.
- `svm102:src/opcodes/AquaOpcodesDebug.sol:15-17` shows the override pattern: `_opcodes()` overridden to post-process `super._opcodes()`.
- `svm102:README.md` ("Building a Custom Router"): "create your own router by inheriting `SwapVM` plus your opcode contract and overriding `_instructions()`".
- Docs `/swapvm/write-your-own-opcode`: indexes 0-9 are reserved for debug, and new instructions are appended. That page mixes in `_runOpcode` and `_dispatch`, which belong to `main`. Follow the source.
- The same docs page warns that an extra instruction may push the router over the 24,576-byte EIP-170 limit. I did not check this.

**Official v1.0.2 AquaOpcodes indexes** (derived from `svm102:src/opcodes/AquaOpcodes.sol:33-75`)

| Index | Instruction |
|---|---|
| 0x00-0x09 | `_notInstruction` (debug reserved) |
| 0x0a | `Controls._jump` |
| 0x0b | `Controls._jumpIfTokenIn` |
| 0x0c | `Controls._jumpIfTokenOut` |
| 0x0d | `Controls._deadline` |
| 0x0e | `Controls._onlyTakerTokenBalanceNonZero` |
| 0x0f | `Controls._onlyTakerTokenBalanceGte` |
| 0x10 | `Controls._onlyTakerTokenSupplyShareGte` |
| 0x11 | `XYCSwap._xycSwapXD` |
| 0x12 | `XYCConcentrate._xycConcentrateGrowLiquidity2D` |
| 0x13 | `Decay._decayXD` |
| 0x14 | `Controls._salt` |
| 0x15 | `Fee._flatFeeAmountInXD` |
| 0x16-0x1a | `_notInstruction` (gap) |
| 0x1b | `Fee._protocolFeeAmountInXD` |
| 0x1c | `Fee._aquaProtocolFeeAmountInXD` |
| 0x1d | `Fee._dynamicProtocolFeeAmountInXD` |
| 0x1e | `Fee._aquaDynamicProtocolFeeAmountInXD` |
| 0x1f | `PeggedSwap._peggedSwapGrowPriceRange2D` |
| 0x20 | `Extruction._extruction` |
| 0x21 | `Controls._onlyTxOriginTokenBalanceNonZero` |

The array length is 34. **The first free index is `0x22` (34).** The docs agree on 0x12, 0x13 and index 32 (Extruction).

**What the spec should say**
- Build `TremorOpcodes is AquaOpcodes, CappedPayoffCurve`.
- Override `_opcodes()`: copy `super._opcodes()` (length 34) into a new array of length 35, and set `[34] = CappedPayoffCurve._cappedPayoffCurve`.
- `TremorAquaSwapVMRouter is Simulator, SwapVM, TremorOpcodes` overrides `_instructions()` to return `_opcodes()`.
- Construct it with the deployed Aqua address.
- Do **not** write `Opcode` enums, `_runOpcode` or `_dispatch` unless you build on `main`. On `main`, opcodes are fixed bytes, the dispatcher is overridden through `_runOpcode`, and a new instruction takes a free slot such as `0x52` or `0xd0`-`0xef` (`svm-main:contracts/libs/OpcodeList.sol:15-18,243-293`).
- Programs are tied to one router: docs say "a strategy's bytecode is not portable across router versions". Shipped strategies name the router as `app`, so strategies for the custom router must be shipped with `app = TremorAquaSwapVMRouter`.

## 3. A contract (vault) can be the maker; how authorization works

**Verdict: VERIFIED.** In Aqua mode there are no signatures. Authorization means three things:
- the maker itself called `ship`;
- the maker approved the **Aqua registry** for each ERC-20;
- the maker has enough real balance when `pull` runs.

**Evidence**
- `aqua:contracts/Aqua.sol:65-69`: balances are written under `_balances[msg.sender][app][strategyHash][token]`, so whoever calls `ship` is the maker.
- `aqua:contracts/Aqua.sol:83-88`: `pull` is keyed by `msg.sender` as the app, then calls `safeTransferFrom(maker, to, amount)`. The maker's allowance must be to Aqua.
- Docs `/getting-started/build-an-aquaapp`: "a contract becomes the maker simply by calling `ship()` itself", and "Approve the registry, never the `app`."
- `svm102:src/SwapVM.sol:193-198`: when Aqua mode is set, the router reads `safeBalances` and skips the signature check entirely.
- `svm102:src/SwapVM.sol:97-100`: in Aqua mode `orderHash = keccak256(abi.encode(order))`. Aqua computes `strategyHash = keccak256(strategy)` (`aqua:contracts/Aqua.sol:61`). So the vault must ship `strategy = abi.encode(order)` with `app = router`.
- `aqua:README.md:111` says `keccak256(abi.encode(strategy))`. That is the same thing when `strategy` is already the encoded bytes.
- Aqua-mode limits:
  - receiver must equal maker and WETH unwrap is disallowed (`svm102:src/SwapVM.sol:231-232`);
  - maker Permit2 is incompatible with Aqua (`svm-main:contracts/libs/MakerTraits.sol:113`).
- EIP-1271 applies only to **signature-mode** orders: `order.maker.recoverOrIsValidSignature(...)` at `svm102:src/SwapVM.sol:197`. The 1inch `solidity-utils` `ECDSA.recoverOrIsValidSignature` falls back to `isValidSignature`. `main` tests a contract maker in `test/solidity/OrderRegistrator.t.sol:60` (`ERC1271MakerMock`).
- `dock(app, strategyHash, tokens)` must list **all** tokens (`aqua:contracts/Aqua.sol:77`) and marks the strategy `0xff`. Shipping the same hash again then reverts with `StrategiesMustBeImmutable` (line 68), so a re-ship needs a different `Salt` (`0x14`).
- Docs `/help/aqua-faq` say smart-contract and MPC wallets can be makers.

**What the spec should say:** the vault calls `IERC20.approve(AQUA, ...)`, then `AQUA.ship(router, abi.encode(order), tokens, amounts)`, and later `AQUA.dock(...)`. Do not mention EIP-1271 for the Aqua path.

## 4. Over-commitment: a pull larger than the real balance or allowance

**Verdict: VERIFIED. The whole swap reverts. There is no partial fill.**

**Evidence**
- If the virtual balance is too small: `aqua:contracts/Aqua.sol:86` computes `prevBalance - amount.toUint248()`, which is checked arithmetic and reverts with Panic 0x11.
- If the real balance or allowance is too small: `aqua:contracts/Aqua.sol:88` calls `safeTransferFrom`, which reverts.
- `svm102:src/SwapVM.sol:266,284-287`: the router calls `AQUA.pull` with no try/catch.
- The only swallowed pull is a protocol fee: `svm102:src/instructions/Fee.sol:270`, where `try _AQUA.pull ... catch` emits `ProtocolFeeSkipped`.
- Docs `/help/aqua-faq`: "if your balance is too low at that moment the swap simply reverts". Docs `/liquidity-layer/virtual-balances`: `pull()` reverts "via `IERC20.transferFrom` failure".
- Partial fill:
  - v1.0.2 `TakerTraits` has no partial-fill flag.
  - `main` has `allowPartialFill` (`svm-main:contracts/libs/TakerTraits.sol:190-229`), but it only relaxes the taker-amount equality check. It never clamps to the maker's real balance.
- `quote()` does not touch real balances, so a quote can succeed and the matching swap revert. The docs say strategies keep quoting while the maker is underfunded.

**What the spec should say:** over-commitment surfaces as a reverted swap. If Tremor wants a clean error, `CappedPayoffCurve` should check real collateral and revert with a named error. That check runs in quote as well.

## 5. A quote function on the same code path as swap

**Verdict: VERIFIED, with listed divergences.**

**Evidence**
- `svm102:src/SwapVM.sol:111-154`: `quote(order, tokenIn, tokenOut, amount, takerTraitsAndData)` builds the same `Context`, reads the same `safeBalances` and calls the same `ctx.runLoop()` with `isStaticContext: true`.
- `quote` is declared non-view but intended for a static call: line 110 says "Method can be executed in a static-call". Call it through `asView()` (line 90).
- `svm-main:README.md:44`: "`quote()` runs the same program in a static context ... so quote and swap agree."

**Divergences from `swap`**
1. No signature check (`swap` checks at line 197).
2. No reentrancy lock.
3. No transfers, and no maker hooks or taker callbacks (lines 217-273 run only in `swap`).
4. Instructions may branch on `ctx.vm.isStaticContext`. For example, Fee skips its pull (`Fee.sol:114,141`), and Extruction calls `IStaticExtruction` (`Extruction.sol:95-113`).

**What the spec should say**
- `CappedPayoffCurve` must be a pure function of the context, its args and view reads, so it behaves identically in both modes.
- Do not put the cap only in a maker hook.
- `AquaSwapVMRouter` also inherits `Simulator` (`simulate`). I did not read that source because the `solidity-utils` mixin was not cloned, so its semantics are NOT FOUND here.

## 6. Exact Aqua core API, virtual-balance keying, and whether `ship` checks real balances

**Verdict: VERIFIED, with one correction: there is no `balances(...)` view.**

**API** (`aqua:contracts/interfaces/IAqua.sol`)

| Function | Lines | What it does |
|---|---|---|
| `rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)` | 78-83 | Raw read, no checks |
| `safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) view returns (uint256, uint256)` | 93-99 | Reverts `SafeBalancesForTokenNotInActiveStrategy` |
| `ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32 strategyHash)` | 107-112 | `msg.sender` is the maker; `strategyHash = keccak256(strategy)` |
| `dock(address app, bytes32 strategyHash, address[] tokens)` | 119 | Must list all tokens; sets amounts to 0 and the strategy to DOCKED (`0xff`) |
| `pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to)` | 128 | `msg.sender` is the app |
| `push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)` | 137 | Anyone may call; the strategy must be active (`Aqua.sol:95-98`); the caller's tokens go to the maker |

Events: `Shipped`, `Docked`, `Pulled`, `Pushed` (lines 45-69).

**Keying**
- `aqua:contracts/Aqua.sol:21-22`: `mapping(maker => app => strategyHash => token => Balance)`.
- `aqua:contracts/libs/Balance.sol:11-14`: each `Balance` is `{uint248 amount; uint8 tokensCount}`, where `tokensCount` is 0 for inactive and `0xff` for docked.

**Real-balance check:** none.
- `ship` (`Aqua.sol:55-72`) only stores amounts and emits events.
- `pull` does not check `tokensCount`, so it does not require an active strategy. A docked balance is 0, so it underflows and reverts anyway.
- The deployed registry is `AquaRouter is Aqua, Simulator, Multicall, Rescuable` (`aqua:contracts/AquaRouter.sol:17`). Docs give its on-chain name as `AquaRouter`.

## 7. Official deployment addresses and chains, and fork testing

**Verdict: PARTLY.**
- Addresses: VERIFIED from docs and repo.
- Fork testing against the deployed contracts: documented for Foundry `--fork-url` on mainnet. Anvil is NOT FOUND in the official docs.
- On-chain verification: not done (no RPC calls).

**Addresses** (docs `/reference/contract-addresses`; `aqua:deployments.md:5-122`)

| Contract | Address |
|---|---|
| Aqua registry (`AquaRouter`) | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` |
| AquaSwapVMRouter v1.0.2 | `0x111111338c5091e8440b67b168bae16a668ac0de` |
| KycNFT | `0x26FFc7D378E8e49Be2c483295A3e3E511F96a468` |

Production chains in the docs (13): Ethereum 1, Optimism 10, BNB 56, Gnosis 100, Unichain 130, Polygon 137, Sonic 146, zkSync 324, Robinhood 4663, Base 8453, Arbitrum 42161, Avalanche 43114, Linea 59144.

Sources disagree on the chain list:
- `aqua:deployments.md` also lists Cronos 25, Monad 143, HyperEVM 999 and Arc 5042.
- `svm-main:README.md:280` lists Cronos, Monad and HyperEVM.
- Ethereum and Base appear in every source.

**Stale addresses, do not use**
- `0x8fdd04dbf6111437b44bbca99c28882434e0958f`: from `svm102:README.md:56`. Docs: "Stale 28-opcode router ... Calls reaching index 32 revert".
- The strategy-template page hardcodes the superseded `0xE8026bF3...` (registry) and `0x016B417B...` (router).
- Docs: "Both public repo READMEs are out of date". SDKs `@1inch/aqua-sdk` 0.3.0 and `@1inch/swap-vm-sdk` 0.4.0 carry the current addresses.
- Sepolia: registry is live, router not deployed as of 2026-07-29 (docs).

**Fork testing**
- Docs `/getting-started/strategy-template`: `forge test --fork-url $RPC_URL --match-contract StrategyTemplateTest -vvv` against Ethereum mainnet.
- It needs an archive-capable RPC, solc 0.8.30, `cancun`, and `viaIR`. The transient-storage lock needs Cancun or later (docs `/swapvm/write-your-own-opcode`).
- The prize allows "local forks are ok".
- Nothing official prevents an anvil fork of Ethereum or Base. **Do this before the demo:** `cast code <addr> --rpc-url <fork>`, and on the router `cast call <router> "AQUA()(address)"`.
- I did not verify that the deployed bytecode matches the `v1.0.2` tag.

**What the spec should say:** fork Ethereum mainnet or Base. Use the deployed Aqua at `0x1111113c…a90a`. Deploy `TremorAquaSwapVMRouter(aqua = 0x1111113c…a90a, weth, owner, name, version)` on the fork, and ship strategies with `app` set to that router. Optionally also run an Extruction-only strategy against the deployed router `0x11111133…c0de`.

## 8. Official hackathon resources, docs portal, example apps

**Verdict: VERIFIED.**

- **Prize page** (`https://ethglobal.com/events/mumbai/prizes/1inch`):
  - "Build an Aqua App", $5,000 total ($2,500 / $1,500 / $1,000).
  - Rules: "Official Aqua/SwapVM contracts must be used"; on-chain token transfers in the demo, with "local forks are ok"; no single-commit final day.
  - Projects using SwapVM are "scored higher".
  - Links: `github.com/1inch/swap-vm/tree/main`, `github.com/1inch/aqua`, `github.com/1inch/sdks/tree/master/typescript/aqua`.
  - Workshop: "Reimagining the AMM with 1inch Aqua", Nov 5, 5:30 PM IST, Workshop Room 2.
- **Docs portal** (`https://business.1inch.com/portal/documentation/aqua/...`). Relevant pages:
  - `getting-started`, `getting-started/build-an-aquaapp`, `getting-started/strategy-template`, `getting-started/worked-examples`
  - `swapvm/write-your-own-opcode`
  - `liquidity-layer/virtual-balances`
  - `reference/contract-addresses`, `reference/verified-contract-addresses`, `reference/sdk-overview`
  - `help/swapvm-faq`, `help/aqua-faq`
- **Examples:**
  - `aqua:examples/apps/XYCSwap.sol` and `examples/apps/interfaces/IXYCSwapCallback.sol`: a standalone AquaApp, Path A, that does not use SwapVM.
  - `aqua:examples/test/XYCSwap.t.sol` and `XYCNestedSwaps.t.sol`.
  - swap-vm tests: `test/solidity/SwapVMAqua.t.sol`, `XYCSwapAqua.t.sol`, `helpers/AquaSwapVMHelper.sol`, `base/AquaStrategyBuilders.sol` (on `main`).
  - The docs strategy template has no repo; per the docs, "this page _is_ the starter".

---

## Recommended design for the shared-collateral rule

1. **Build on the v1.0.2 tag, not `main`.** The deployed router, its ABI and the SDKs are all v1.0.2.
2. **Deploy `TremorAquaSwapVMRouter`** on an Ethereum or Base fork, pointing at the deployed Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`. It inherits `Simulator, SwapVM, TremorOpcodes`. `TremorOpcodes is AquaOpcodes, CappedPayoffCurve` overrides `_opcodes()` to append `CappedPayoffCurve._cappedPayoffCurve` at **index 0x22**. Indexes 0x00-0x21 stay unchanged.
3. **The writer's `TremorVault` is the maker.** It approves Aqua, then ships **one** strategy with tokens `[COLLATERAL, LONG, SHORT]` and `app = TremorAquaSwapVMRouter`. The order is `useAquaInsteadOfSignature = true`. The program is `Salt(0x14)`, then `Deadline(0x0d)`, then `CappedPayoffCurve(0x22)`.
4. **`CappedPayoffCurve` behaves identically in quote and swap:**
   - read `AQUA.rawBalances(ctx.query.maker, address(this), ctx.query.orderHash, LONG)` and the same for `SHORT`;
   - derive the sold amounts as the shipped amounts (in args) minus the current balances, including this trade's `amountOut`;
   - read real collateral with `IERC20(COLLATERAL).balanceOf(maker)` or a view on the vault or market;
   - require collateral ≥ max(soldLong, soldShort)·S;
   - price the trade and set `ctx.swap.amountIn` / `ctx.swap.amountOut`.
5. **Fallback that needs no redeploy:** two strategies plus `Extruction(0x20)` into the market contract, which reads both strategies' `rawBalances` (as in v1). This shows less SwapVM depth.
6. **Avoid relying on maker hooks alone.** They are skipped by `quote()`.

**Open item the spec must settle:** LONG and SHORT must be ERC-20s the vault actually holds, for example complete sets minted from collateral. Aqua `pull` is plain `transferFrom`.

## Exact names for the spec

**Aqua**
- Contracts: `IAqua`, `Aqua`, `AquaRouter` (the deployed registry), `AquaApp`.
- Functions: `ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)`, `dock(address app, bytes32 strategyHash, address[] tokens)`, `pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to)`, `push(address maker, address app, bytes32 strategyHash, address token, uint256 amount)`, `rawBalances(address,address,bytes32,address) returns (uint248,uint8)`, `safeBalances(address,address,bytes32,address,address) returns (uint256,uint256)`.
- Errors: `StrategiesMustBeImmutable`, `DockingShouldCloseAllTokens`, `PushToNonActiveStrategyPrevented`, `SafeBalancesForTokenNotInActiveStrategy`, `MaxNumberOfTokensExceeded`.
- Events: `Shipped`, `Docked`, `Pulled`, `Pushed`.

**SwapVM v1.0.2 router and VM**
- Contracts: `SwapVM`, `AquaSwapVMRouter`, `AquaOpcodes`, `ISwapVM.Order {address maker; MakerTraits traits; bytes data;}`.
- Router functions: `hash(Order)`, `quote(Order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData)`, `swap(...)` with the same arguments, `asView()`, `AQUA()`.
- Internal hooks to override: `_instructions()`, `_opcodes()`.
- VM types: `Context`, `VM`, `SwapQuery {orderHash, maker, taker, tokenIn, tokenOut, isExactIn}`, `SwapRegisters {balanceIn, balanceOut, amountIn, amountOut, amountNetPulled}`, `ctx.runLoop()`, `ctx.tryChopTakerArgs(n)`, `ctx.vm.isStaticContext`.

**Traits, instructions and extension points**
- Builders: `MakerTraitsLib.build(MakerTraitsLib.Args)` with `useAquaInsteadOfSignature`, `TakerTraitsLib`.
- Official instructions used: `Controls._salt` (0x14), `Controls._deadline` (0x0d), `Extruction._extruction` (0x20).
- Extension interfaces: `IExtruction.extruction` / `IStaticExtruction.extruction`, `IMakerHooks.preTransferOut` and related hooks.
- Swap event: `Swapped(orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut)`.

**Tremor-owned (proposed names)**
- `TremorOpcodes`, `CappedPayoffCurve._cappedPayoffCurve` at index `0x22`, `TremorAquaSwapVMRouter`, `TremorVault`.
