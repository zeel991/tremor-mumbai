# AI usage

How AI tools were used to build Tremor, file by file. The team directed the work, made the product and design
decisions, reviewed the results, took feedback from the partner booths, and signed every wallet transaction.

| What | Tool | Human role |
|---|---|---|
| Hackathon and prize research; scraping ETHGlobal and other platforms' public data | Claude (Anthropic), via Claude Code | Direction, review |
| Measurement scripts in `data/` (swap logs, Binance prices, LVR markout, backtest, dynamic-fee benchmark) | Claude Code | Direction, review of method and results |
| Source verification against 1inch, Uniswap, Chainlink and ETHGlobal docs and code (`docs/research/`) | Claude Code | Review |
| 1inch workshop transcript and notes | whisper.cpp (local) + Claude Code | Review |
| Planning and specification (`docs/tremor_mumbai_plan.md`, `docs/spec.md`) | Claude Code | Decisions, review, edits |
| Contracts (`contracts/src/`): VarianceMarket, Pricing, CappedPayoffCurve, router, vault, TremorHook, TremorReceiver | Claude Code (written from `docs/spec.md`) | Spec decisions, review |
| Unit, invariant and vector tests (`contracts/test/unit/`); Python reference model (`reference/`) | Claude Code | Review |
| Mainnet-fork tests (`contracts/test/fork/`), deploy and demo scripts (`contracts/script/`, `demo/`) | Claude Code | Review of results |
| Red-team attack tests and fixes (`contracts/test/redteam/`), price-shock scenarios (`contracts/test/scenario/`) | Claude Code | Chose what to attack and which fixes to ship (from 1inch and Uniswap booth feedback) |
| Independent critique of the project before the second red-team round | OpenAI Codex | Chose which findings to act on |
| CRE workflow (`cre/`) | Claude Code | Review; `cre login` and simulation runs are a human step |
| Frontend (`web/`), including the stress-test simulator (`web/src/lib/sim.ts`) | Claude Code | Design direction, review, wallet testing |
| Sepolia deployment and end-to-end transactions (`demo/deploy-sepolia.sh`, `demo/sepolia-e2e.sh`) | Claude Code, from the team's deployer key | Approved each step; signed user-wallet transactions |
| README, FEEDBACK.md, submission texts | Claude Code, from the build's own findings | Review |

Vendored, not AI-written: Chainlink `ReceiverTemplate`/`IReceiver` (verbatim from the CRE docs) and all `contracts/lib`
dependencies.
