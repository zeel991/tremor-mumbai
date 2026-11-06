# Demo video: script and shot list (target 3:00, limit 2–4 min)

Record in one take per section; cut together. Every number below is from the repo (README "Verified results",
`data/`, the Sepolia section). Speak the voiceover roughly as written; it's about 430 words, a calm 3 minutes.

## Before recording (15 minutes)

1. **Fresh mainnet fork from an archive RPC** (a publicnode fork expires after about an hour):
   `anvil --fork-url https://rpc.mevblocker.io --chain-id 1 --compute-units-per-second 40 --retries 20`
2. Deploy and replay the demo: `./demo/setup-fork.sh && ./demo/run-demo.sh` (keep this terminal output for shot 4).
3. Web app on the fork: `cd web && npm run dev` → http://localhost:3000.
4. Second tab: Sepolia Etherscan, hook `0x547C1194070EFdEDAfa5939D291aEDB444088044`.
5. Browser at 1440×900, dark, notifications off, bookmarks bar hidden.

## Shots

| # | Time | Screen | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:20 | Landing hero: the ribbon draws in and loops the orb; live strip shows the fee, paid to LPs and the cover price. | "Uniswap LPs lose money to arbitrage every time the market moves. In the UNI/WETH pool on Ethereum, we measured every swap for two years: arbitrage took 93 percent of LP fees. Tremor gives LPs volatility cover, paid for by the swappers." |
| 2 | 0:20–0:45 | Scroll to "The problem": the 104-week chart, then the three stats. | "LPs lost money in 14 of 104 weeks. The worst, the week of 6 October 2025, cost them 137,516 dollars. The losses arrive exactly when the market swings, which is what cover is for." |
| 3 | 0:45–1:15 | Scroll to "How it works", then open the app Overview. Point at the fee tile (0.30%) and the loss-vs-fee chart. | "Three steps. A Chainlink CRE workflow measures last week's arbitrage loss on-chain. A Uniswap v4 hook charges swappers a fee sized from it, half the loss rate, capped at 0.30 percent. Here the week of 6 October sets the cap." |
| 4 | 1:15–1:45 | Terminal: `run-demo.sh` output, F3 and F4 lines (hook fee claims, handleHookFees buying LONG through 0x22). Then the app Activity feed. | "The hook collects that fee and spends it on cover: LONG claims on realized volatility, bought from one 1inch Aqua strategy through our own SwapVM instruction, 0x22. Every claim is fully backed by WETH." |
| 5 | 1:45–2:15 | App Trade page: type 0.1, show "You receive", connect, buy. Side panel: settles in, projected volatility, LONG would pay. | "Anyone can trade the other side. The quote you see is exactly what the swap returns: same pricing on-chain, through Aqua. LONG pays more the more UNI/ETH moves; SHORT pays the rest." |
| 6 | 2:15–2:40 | Landing "The payout" cards (Oct 2025: 305%, 100%; Feb 2025: 59.8%, 15.9%), then the Overview "Donated 1.235 WETH to LPs" activity row. | "Settlement reads every Chainlink price update in the week. In the October crash, volatility hit 305 percent and LONG paid in full; the hook donated that WETH straight to in-range LPs. In a calm week, LONG paid 16 percent." |
| 7 | 2:40–3:00 | Sepolia Etherscan: the hook, the router trade, the CRE report transaction. End on the landing closing section. | "It also runs on Sepolia, against the real v4 PoolManager and Aqua, with a live CRE report. Tremor: measure the loss, charge for it, and pay LPs back when it hurts." |

## Claims to keep accurate on camera
- Say "measured" for the 93% / 14-of-104 / $137,516 numbers: it's our method (every swap at Binance one-minute prices), not a third-party figure.
- Don't say "recovers half of LP losses": the 49% backtest is an upper bound that assumes no lost volume.
- Shot 6's settlement is a **replay on a mainnet fork** of a real historical week; say "settled from real Chainlink history".
- Sepolia settles on ETH/USD with a test UNI token. If you show it, don't call it UNI/ETH.

## Upload
- Export 1080p, under 4:00. Upload to YouTube (unlisted is fine) or the ETHGlobal uploader, and paste the link in the submission.
