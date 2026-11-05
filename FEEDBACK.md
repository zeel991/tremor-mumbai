# Uniswap developer feedback (Tremor, ETHGlobal Mumbai 2026)

What we built on Uniswap v4: a hook-fee hook (OpenZeppelin `BaseHookFee`, flags `afterSwap | afterSwapReturnDelta`) on a UNI/WETH pool. It redeems its ERC-6909 fee claims, self-swaps UNI to WETH in the same pool, and drip-`donate`s insurance payouts back to in-range LPs. Everything was tested on an Ethereum mainnet fork against the deployed PoolManager.

## What worked well
- **OpenZeppelin `BaseHookFee`.** Taking the fee in `afterSwap` on the unspecified currency, as ERC-6909 claims, was the right default. Only `_getHookFee` and `handleHookFees` had to be written.
- **ERC-6909 claims plus `unlock`.** Redeeming the claims (burn, then take) and converting fees in one unlock was clean. Hook self-calls skipping the hook's own callbacks (`Hooks.sol` noSelfCall) meant the conversion swap didn't charge itself.
- **The deployments page.** It gave correct PoolManager addresses. We confirmed the mainnet one has code.

## Friction
1. **The docs' import paths don't exist any more.**
   - The hook guides import `v4-periphery/src/utils/BaseHook.sol` and `v4-periphery/src/utils/HookMiner.sol`.
   - Both were moved out of `src/`: v4-periphery `5da22e60` ("remove hooks and move to hook repo") and "move hook miner (#446)".
   - HookMiner now lives in `test/shared/`.
   - We used OpenZeppelin's `BaseHook` and wrote CREATE2 mining ourselves. Updating the guides, or adding a callout, would save every new team about 30 minutes.
2. **The `Swap` event's NatSpec contradicts the code.**
   - `IPoolManager` says `amount0`/`amount1` are "the delta of the currency0 balance of the pool".
   - `PoolManager._swap` emits the delta from `Pool.swap`, which is from the **swapper's** perspective: negative means the swapper paid (`Pool.sol:453-460`).
   - Anyone computing LP P&L from events gets the sign wrong. We had to read the code to be sure.
3. **`donate()` has no official answer to JIT front-running.**
   - `IPoolManager.sol:150` warns that donations "can be frontrun adding just-in-time liquidity", but there's no recommended pattern.
   - We drip donations over blocks, which only limits the value per call, and point to OpenZeppelin's `LiquidityPenaltyHook`.
   - A short "how to donate safely" section would help every hook that pays LPs.
4. **The docs host moved.** `docs.uniswap.org/contracts/v4/*` now 301-redirects to `developers.uniswap.org/docs/protocols/v4/*`. Some deep links in community guides no longer resolve to the same anchors.
5. **Hook fees vs dynamic LP fees.** The concepts page explains dynamic LP fees well. That a *dynamic hook fee* is just a variable `_getHookFee` is only clear from OpenZeppelin's code, so one sentence in the fees docs would help.

## One improvement with the most impact
Keep the hook guides' import paths and HookMiner location in sync with v4-periphery `main`, or pin the guides to a tag. It was the first and largest time sink.
