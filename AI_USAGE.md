# AI usage

This is a running log, updated as the build proceeds.

| What | Tool | Human role |
|---|---|---|
| Hackathon and prize research; scraping ETHGlobal and other platforms' public data | Claude (Anthropic), via Claude Code | Direction, review |
| Measurement scripts in `data/` (swap logs, Binance prices, LVR markout, backtest) | Claude Code | Direction, review of method and results |
| Source verification against 1inch, Uniswap, Chainlink and ETHGlobal docs and code (`docs/research/`) | Claude Code | Review |
| 1inch workshop transcript (local whisper.cpp) and notes | whisper.cpp + Claude Code | Review |
| Planning and specification (`docs/tremor_mumbai_plan.md`, `docs/spec.md`) | Claude Code | Decisions, review, edits |

| Contracts (`contracts/src/`): VarianceMarket, Pricing, CappedPayoffCurve, router, vault, TremorHook, TremorReceiver | Claude Code (written from docs/spec.md) | Spec decisions, review |
| Fork tests (`contracts/test/fork/`), deploy and demo scripts (`contracts/script/`, `demo/`) | Claude Code | Review of results |
| Python reference model and unit/vector tests (`reference/`, `contracts/test/unit/`) | Claude Code subagent | Review |
| CRE workflow (`cre/`) | Claude Code subagent | Review; `cre login` and simulation are a human step |
| Frontend (`web/`) | Claude Code subagent (new design) | Review |
| README, FEEDBACK.md | Claude Code, from the build's own findings | Review |

Vendored, not AI-written: Chainlink `ReceiverTemplate`/`IReceiver` (verbatim from the CRE docs) and all `contracts/lib` dependencies.
