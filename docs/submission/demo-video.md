# Demo video: script and shot list (target 3:00, limit 2–4 min)

Record in one take per section; cut together. Every number below is from the repo (README "Verified results",
`data/`, the Sepolia section). Speak the voiceover roughly as written; it's about 430 words, a calm 3 minutes.

## Before recording (15 minutes)

1. **Fresh mainnet fork right before recording, then record within the hour.** A publicnode fork stops working after
   about an hour (it keeps little history); rpc.mevblocker.io keeps full history but rate-limits fork traffic and can
   ban the IP for a while. If you have your own archive RPC key (Alchemy, Infura, QuickNode), use that instead.
   `anvil --fork-url https://ethereum-rpc.publicnode.com --chain-id 1 --compute-units-per-second 150 --retries 12`
2. Deploy and replay the demo: `./demo/setup-fork.sh && ./demo/run-demo.sh` (keep this terminal output for shot 4).
3. Web app on the fork: `cd web && npm run dev` → http://localhost:3000.
4. Second tab: Sepolia Etherscan, hook `0x3FF7250cB8BBC51DefC8eB4fEB3cFa9A05ae8044`.
5. Browser at 1440×900, dark, notifications off, bookmarks bar hidden.

## Shots

| # | Time | Screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:20 | Landing hero: the ribbon draws in and loops the orb; live strip shows the fee, paid to LPs and the cover price. | "Uniswap LPs lose money to arbitrage every time the market moves. We valued every swap in the UNI/WETH pool on Ethereum at exchange prices for two years: measured arbitrage loss came to 93 percent of LP fees. Tremor is a v4 hook that measures that loss with Chainlink, buys capped volatility cover on 1inch Aqua, and pays it back into the pool when markets swing." |
| 2 | 0:20–0:45 | Scroll to "The problem": the 104-week chart, then the three stats. | "LPs lost money in 14 of 104 weeks. The worst, the week of 6 October 2025, cost them 137,516 dollars. The losses arrive exactly when the market swings, which is what cover is for." |
| 3 | 0:45–1:15 | Scroll to "How it works", then open the app Overview. Point at the fee tile (0.30%) and the loss-vs-fee chart. | "Three steps. A Chainlink CRE workflow measures last week's arbitrage loss on-chain. A Uniswap v4 hook charges swappers a fee sized from it, half the loss rate, capped at 0.30 percent. Here the week of 6 October sets the cap." |
| 4 | 1:15–1:45 | Terminal: `run-demo.sh` output, F3 and F4 lines (hook fee claims, handleHookFees buying LONG through 0x22). Then the app Activity feed. | "The hook collects that fee and spends it on cover: LONG claims on realized volatility, bought from one 1inch Aqua strategy through our own SwapVM instruction, 0x22. Every claim is fully backed by WETH." |
| 5 | 1:45–2:15 | App Trade page: type 0.1, show "You receive", connect, buy. Side panel: settles in, projected volatility, LONG would pay. | "Anyone can trade the other side. The quote you see is exactly what the swap returns: same pricing on-chain, through Aqua. LONG pays more the more UNI/ETH moves; SHORT pays the rest." |
| 6 | 2:15–2:40 | Landing "The payout" cards (Oct 2025: 305%, 100%; Feb 2025: 59.8%, 15.9%), then the Overview "Donated 1.235 WETH to LPs" activity row. | "This is a historical replay on a mainnet fork, using real Chainlink history. In the October crash week, oracle-sampled volatility was 305 percent and LONG paid in full; the hook dripped that WETH to the liquidity in range. In a calm week, LONG paid 16 percent." |
| 7 | 2:40–3:00 | Sepolia Etherscan: the hook, the router trade, the CRE report transaction. End on the landing closing section. | "Is this better than just raising the LP fee? On average, no: we ran both, and a direct fee earns about 8 percent more. Tremor cuts the worst week from minus 124 thousand to minus 71 thousand. It's for cutting the tail. It also runs on Sepolia, against the real v4 PoolManager and Aqua." |

## Provenance labels (keep one on screen at all times)
`MAINNET FORK — HISTORICAL REPLAY` (shots 3, 4, 6), `STATIC 104-WEEK DATA` (shots 1–2), `SEPOLIA — PUBLIC TX` (shot 7, only with
Etherscan visible), `REAL CRE SIMULATION` (only for footage of `cre workflow simulate` itself). The fast fork demo delivers
precomputed CRE reports through an impersonated forwarder: say so if you show it.

## Claims to keep accurate on camera
- Speak it yourself: ETHGlobal requires a human voice, not an AI voice-over. At least 720p.
- Say "measured" for the 93% / 14-of-104 / $137,516 numbers: it's our method (every swap at Binance one-minute prices), not a third-party figure.
- Don't say "recovers half of LP losses": the 49% backtest is an upper bound that assumes no lost volume.
- Shot 6's settlement is a **replay on a mainnet fork** of a real historical week; say "settled from real Chainlink history".
- Sepolia settles on ETH/USD with a test UNI token. If you show it, don't call it UNI/ETH.

## Upload
- Export 1080p, under 4:00. Upload to YouTube (unlisted is fine) or the ETHGlobal uploader, and paste the link in the submission.
