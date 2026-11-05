# 1inch workshop, ETHGlobal Mumbai 2026: "Reimagining the AMM with 1inch Aqua"

**Talk:** Vadim Fadeev, blockchain technical lead at 1inch, 22:45 long.
**Source:** https://www.youtube.com/watch?v=2IJFsPLH9Zg
**Transcript:** `transcript.txt` and `transcript.srt`, made locally with whisper.cpp `base.en`.

Expect transcription errors. The speaker's name came out as "Magim", and the 1st-place prize as "two thousand fifty" (the track text says $2,500). The `[mm:ss]` marks below are timestamps in the talk.

## What 1inch says the problem is

- **The LP's problem is fragmentation, not just the trader's** [3:22–6:11]. 1inch's aggregator unified liquidity for traders, but LPs now face many DEXs: "choosing where to deposit sucks".
  - LP capital sits in one pool with "high opportunity cost".
  - LPs keep moving funds between venues.
  - Deposited tokens lose their governance votes.
- **Uniswap hooks are "a nightmare"** [7:29–7:41]. The speaker contrasts Aqua with writing custom Uniswap hooks.

## How Aqua works, in their words

- **Aqua router** [8:24–9:29], an ~80-line contract with 3 jobs:
  1. LP registration: you "ship" a strategy and set an allowance from your wallet.
  2. Balance tracking.
  3. Swap settlement, where only an allowed program can execute.
- **Aqua applications** [9:31–10:14, 11:29–11:55]. SwapVM is one application, but "it could be any application, for example flash loan application… lending application".
- **Strategies** [10:25–10:53, 12:05–13:08] are signed calldata. Shipping one emits an event, 1inch's backend indexes it, and traders get quotes through the 1inch UI and call `swap`.
- **Capital efficiency is the headline metric** [14:50–15:38]: "Bob has actual liquidity for thousands and effective liquidity six thousands, because money stays at his wallet."
- **Over-commitment** [15:53–16:55]: if several takers hit one maker at once, the biggest trade by volume executes. In practice two-way flow nets out; it's "only an issue with small liquidity balances".
- **SwapVM** [17:41–21:00] works like a virtual machine with two registers (taker→maker and maker→taker). It offers:
  - custom price curves
  - taker restrictions (whitelists)
  - fees as chained instructions, with many recipients
  - deadlines
  - instructions that "can call other contracts like Oracle data"
- **What they say you can build:** "prediction markets, privacy pools, flash loans, like anything."
- **In production today:** constant product, concentrated liquidity, and stable swap (their own "PeggySwap"). Flash swaps and flash loans are coming.

## What they asked for in the bounty [21:35–22:14]

- "Build something on top of Aqua… **You could extend SwapVM or you could construct your own virtual machine.**"
- From-scratch track: $5,000 total (track text: $2,500 / $1,500 / $1,000). Continuity track: $2,000 ($1,500 / $500).
- The written rules still apply:
  - Official Aqua/SwapVM contracts; a redeployed, modified SwapVM is allowed.
  - On-chain transfers shown in the demo.
  - No single-commit final day.
