# Prior work disclosure

The same team built **Tremor** at ETHGlobal ETHOnline 2026:
- Showcase: https://ethglobal.com/showcase/tremor-q9ye1
- Code: https://github.com/zeel991/tremor

It was a realized-variance market on Base Sepolia. It used a self-deployed Aqua registry and router, stock SwapVM instructions with an `Extruction` callback, a fixed sampling grid, and a mock USDC. It won no prizes.

**This repository was created after ETHGlobal Mumbai kickoff (Thu 5 Nov 2026, 21:00 IST).** It contains no code, UI designs, assets or test vectors from that project. The maths in `docs/spec.md` §7 is re-derived.

**Carried over as ideas only:**
- capped claims on realized variance;
- LONG/SHORT complementarity (LONG + SHORT = S).

**New in this build** (see `docs/spec.md` §15):
- a custom SwapVM instruction on the deployed Aqua registry;
- one three-token strategy with complete-set collateral;
- tick-level settlement on the Chainlink UNI/ETH feed;
- a Uniswap v4 hook-fee insurance loop;
- CRE measurement of arbitrage loss;
- a 104-week measured LVR dataset.

**Status of eligibility:** we are asking ETHGlobal staff in writing whether this rebuild may enter from-scratch partner prizes and Finalist judging. Their answer will be recorded here.
