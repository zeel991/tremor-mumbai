# Message to ETHGlobal staff: eligibility of the Tremor rebuild

Send this to ETHGlobal Mumbai support (the event Discord's help/support channel or the hacker support contact on the
event page) **before submitting**. Paste their written reply into `PRIOR_WORK.md` under "Status of eligibility".

---

Hi ETHGlobal team,

We're hacking at ETHGlobal Mumbai and want to check eligibility before we submit, because our project shares a name and
an idea with something our team built at ETHOnline 2026.

**Earlier project:** Tremor at ETHOnline 2026 (https://ethglobal.com/showcase/tremor-q9ye1,
https://github.com/zeel991/tremor). It was a realized-variance market on Base Sepolia with a self-deployed Aqua registry,
stock SwapVM instructions and a mock USDC. It won no prizes.

**This build:** https://github.com/zeel991/tremor-mumbai, created after Mumbai kickoff (Thu 5 Nov, 21:00 IST), with its
full history public. It contains no code, designs, assets or test vectors from the earlier repo; the maths is re-derived.
Carried over as **ideas only**: capped claims on realized variance, and LONG + SHORT paying a fixed amount.

New in this build: a custom SwapVM instruction on the deployed 1inch Aqua registry, a Uniswap v4 hook-fee insurance loop,
Chainlink CRE measurement of LP arbitrage loss, settlement on Chainlink rounds, a 104-week measured dataset, and a
Sepolia deployment. Everything is disclosed in `PRIOR_WORK.md` in the repo.

Our questions:
1. Is this build eligible for partner prizes (1inch, Uniswap, Chainlink)?
2. Is it eligible for Finalist judging?
3. Is there anything else you'd like us to disclose or change in the submission?

Thanks,
<team name and members>

---

## After the reply
- Paste the reply (with date and the staff member's name or handle) into `PRIOR_WORK.md`.
- If they rule it ineligible for Finalists but eligible for partner prizes, say so plainly in the submission description.
