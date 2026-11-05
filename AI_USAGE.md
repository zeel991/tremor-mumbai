# AI usage

This is a running log, updated as the build proceeds.

| What | Tool | Human role |
|---|---|---|
| Hackathon and prize research; scraping ETHGlobal and other platforms' public data | Claude (Anthropic), via Claude Code | Direction, review |
| Measurement scripts in `data/` (swap logs, Binance prices, LVR markout, backtest) | Claude Code | Direction, review of method and results |
| Source verification against 1inch, Uniswap, Chainlink and ETHGlobal docs and code (`docs/research/`) | Claude Code | Review |
| 1inch workshop transcript (local whisper.cpp) and notes | whisper.cpp + Claude Code | Review |
| Planning and specification (`docs/tremor_mumbai_plan.md`, `docs/spec.md`) | Claude Code | Decisions, review, edits |

Implementation code will be listed here per component as it is written.
