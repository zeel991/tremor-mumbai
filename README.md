# Tremor: hook-funded variance cover for Uniswap LPs

ETHGlobal Mumbai 2026 build. **Work in progress.** This repository was created during the hackathon. The first commit contains only the specification and planning documents, as ETHGlobal's spec-driven development rule requires.

**What it does.** In mid-cap Uniswap pools, arbitrage takes most LP fees. We measured that arbitrage took 93% of LP fees in UNI/WETH 0.3% over 104 weeks, and LPs lost money in 14 of those weeks (method in [`data/`](data/README.md)). Tremor:
1. measures last window's arbitrage loss with a Chainlink CRE workflow;
2. charges a capped Uniswap v4 hook fee sized from it;
3. spends that fee on variance cover sold from a 1inch Aqua strategy through a custom SwapVM instruction;
4. settles the cover from Chainlink UNI/ETH rounds and donates the payout back to the pool's LPs.

- Specification: [`docs/spec.md`](docs/spec.md)
- Plan: [`docs/tremor_mumbai_plan.md`](docs/tremor_mumbai_plan.md)
- Source checks per sponsor: [`docs/research/`](docs/research)
- Prior work disclosure: [`PRIOR_WORK.md`](PRIOR_WORK.md)
- AI usage: [`AI_USAGE.md`](AI_USAGE.md)

**Licences.** Tremor's own code is MIT. Dependencies keep their own licences: 1inch swap-vm is `LicenseRef-Degensoft-SwapVM-1.1` and Aqua is `Aqua-Source-1.1`.
