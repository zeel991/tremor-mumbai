/**
 * In-browser simulator of Tremor's two-week loop, a port of contracts/test/scenario/PriceShock.t.sol and the contract
 * maths it runs against: a full-range Uniswap v4 pool (0.30% LP fee, liquidity 1e21), an arbitrageur trading the pool
 * to each new oracle price, four 1 WETH round trips a day, the CRE loss formula, the receiver's fee rule
 * (half the loss rate, capped at 0.30%), the hook fee on swap output, the hook buying LONG through the 0x22 curve
 * (VarianceMarket.quote: projected variance, decaying spread, impact LAMBDA, inventory skew KAPPA, the 20-LONG cap
 * per call), and settlement from every daily round. Floating point, not the contracts: presets are checked against the
 * recorded fork runs (see compareToRecorded).
 *
 * Output has the same shape as the recorded runs (amounts as 1e18-scaled numbers), so the page can play either.
 */

export type SimStep = {
  scenario: string;
  step: number;
  label: string;
  day: number;
  oracle: number;
  pool: number;
  feePips: number;
  volBps: number;
  longPerWeth: number;
  week: number;
  weekLvr: number;
  weekVolume: number;
  weekLpFees: number;
  hookLong: number;
  hookWethSpent: number;
  w1Payout: number;
  w2Payout: number;
  donated: number;
};

// contract parameters (PriceShock.t.sol, fork build)
const S = 1; // WETH per LONG+SHORT pair
const V_CAP = 2.25;
const V_FWD = 0.33;
const H0 = 0.05;
const H_MIN = 0.01;
const LAMBDA = 0.002; // 2e15 wei per whole token per whole token
const KAPPA = 0.001; // 1e15
const SETS = 50;
const K_MAX = (2 * H_MIN * S) / KAPPA; // hook's per-call cap: 20 LONG
const LP_FEE = 0.003;
const K = 0.5; // receiver: fee = K * loss / volume
const MAX_PIPS = 3000;
const LIQ = 1000; // 1e21 liquidity in token units
const YEAR_DAYS = 365;
const T_DAYS = 7;
const HOUR = 1 / 24;
const E18 = 1e18;

type Pool = { s: number }; // sqrt(price), price = WETH per UNI

/** VarianceMarket.quote, taker buys LONG with exact WETH in: LONG out, or 0 if the curve won't sell */
function longForWeth(q: number, elapsedDays: number, skew: number, wethIn: number, inventory: number): number {
  const vProj = (q * YEAR_DAYS + V_FWD * (T_DAYS - Math.min(elapsedDays, T_DAYS))) / T_DAYS;
  const mid = (S * Math.min(vProj, V_CAP)) / V_CAP;
  const m = Math.min(S, Math.max(0, mid + KAPPA * skew));
  const h = (S * (H_MIN * T_DAYS + (H0 - H_MIN) * Math.max(0, T_DAYS - elapsedDays))) / T_DAYS;
  const a0 = m + h;
  if (a0 >= S) return 0;
  const n = (-a0 + Math.sqrt(a0 * a0 + 2 * LAMBDA * wethIn)) / LAMBDA;
  if (n > (S - a0) / LAMBDA || n > inventory) return 0;
  return n;
}

/** Pricing.buyCost: WETH to buy n LONG */
function wethForLong(q: number, elapsedDays: number, skew: number, n: number): number {
  const vProj = (q * YEAR_DAYS + V_FWD * (T_DAYS - Math.min(elapsedDays, T_DAYS))) / T_DAYS;
  const mid = (S * Math.min(vProj, V_CAP)) / V_CAP;
  const m = Math.min(S, Math.max(0, mid + KAPPA * skew));
  const h = (S * (H_MIN * T_DAYS + (H0 - H_MIN) * Math.max(0, T_DAYS - elapsedDays))) / T_DAYS;
  const a0 = m + h;
  return a0 * n + (LAMBDA * n * n) / 2;
}

function projVol(q: number, elapsedDays: number): number {
  const v = (q * YEAR_DAYS + V_FWD * (T_DAYS - Math.min(elapsedDays, T_DAYS))) / T_DAYS;
  return Math.sqrt(Math.max(v, 0));
}

const payout = (q: number) => (S * Math.min((q * YEAR_DAYS) / T_DAYS, V_CAP)) / V_CAP;

/**
 * @param movesBps daily oracle moves in basis points, 6 for week 1 then 6 for week 2 (as in the fork harness)
 * @param p0 starting UNI/ETH price (WETH per UNI)
 */
export function simulate(scenario: string, movesBps: number[], p0 = 0.003): SimStep[] {
  const pool: Pool = { s: Math.sqrt(p0) };
  let price = p0;
  let week = 1;
  let weekLvr = 0;
  let weekVolume = 0;
  let weekLpFees = 0;
  let pips = 0; // active hook fee
  let q1 = 0;
  let q2 = 0;
  let hookWeth = 0; // WETH waiting to buy cover
  let hookUni = 0; // UNI fee claims
  let hookLong = 0;
  let spent = 0;
  let w1Payout = 0;
  let w2Payout = 0;
  let donated = 0;
  const steps: SimStep[] = [];

  /** swap; returns the swapper's output after the hook fee, records the pool side with the CRE formula */
  function swap(zeroForOne: boolean, opts: { amountIn?: number; targetS?: number; hookOwn?: boolean }): number {
    const s = pool.s;
    let a0: number; // pool side, UNI
    let a1: number; // pool side, WETH
    let grossOut: number;
    if (zeroForOne) {
      // UNI in, WETH out, price falls
      const s1 = opts.targetS ?? 1 / (1 / s + (opts.amountIn! * (1 - LP_FEE)) / LIQ);
      const netIn = LIQ * (1 / s1 - 1 / s);
      a0 = netIn / (1 - LP_FEE);
      grossOut = LIQ * (s - s1);
      a1 = -grossOut;
      pool.s = s1;
    } else {
      // WETH in, UNI out, price rises
      const s1 = opts.targetS ?? s + (opts.amountIn! * (1 - LP_FEE)) / LIQ;
      const netIn = LIQ * (s1 - s);
      a1 = netIn / (1 - LP_FEE);
      grossOut = LIQ * (1 / s - 1 / s1);
      a0 = -grossOut;
      pool.s = s1;
    }
    if (opts.hookOwn) return grossOut; // the hook's own conversion: no hook fee, not part of the measurement
    const v0 = a0 * price;
    const v1 = a1;
    const fee = (a0 > 0 ? v0 : v1) * LP_FEE;
    weekLvr += fee - (v0 + v1);
    weekVolume += Math.abs(v0);
    weekLpFees += fee;
    const hookFee = (grossOut * pips) / 1e6;
    if (zeroForOne) hookWeth += hookFee;
    else hookUni += hookFee;
    return grossOut - hookFee;
  }

  function day(moveBps: number) {
    const prev = price;
    price = (price * (10_000 + moveBps)) / 10_000;
    const r = Math.log(price / prev) ** 2;
    if (week === 1) q1 += r;
    else q2 += r;
    const target = Math.sqrt(price);
    if (target !== pool.s) swap(target < pool.s, { targetS: target });
    for (let i = 0; i < 4; i++) {
      const uniOut = swap(false, { amountIn: 1 });
      swap(true, { amountIn: uniOut });
    }
    if (target !== pool.s) swap(target < pool.s, { targetS: target });
  }

  function snap(label: string, d: number, elapsed: number) {
    const q = week === 1 ? q1 : q2;
    const finalized = steps.length === 14;
    // at the week-1 close the week-2 window has not ingested the closing round yet: no quote (Stale)
    const quotable = !finalized && steps.length !== 7;
    const skew = week === 2 ? hookLong : 0;
    steps.push({
      scenario,
      step: steps.length,
      label,
      day: d,
      oracle: price * E18,
      pool: pool.s * pool.s * E18,
      feePips: pips,
      volBps: finalized ? 0 : Math.floor(projVol(q, elapsed) * 1e4),
      longPerWeth: quotable ? longForWeth(q, elapsed, skew, 1, SETS - skew) * E18 : 0,
      week,
      weekLvr: weekLvr * E18,
      weekVolume: weekVolume * E18,
      weekLpFees: weekLpFees * E18,
      hookLong: hookLong * E18,
      hookWethSpent: spent * E18,
      w1Payout: w1Payout * E18,
      w2Payout: w2Payout * E18,
      donated: donated * E18,
    });
  }

  const pct = (b: number) => `${b >= 0 ? "+" : "−"}${(Math.abs(b) / 100).toFixed(2)}%`;
  snap("Week 1 opens: price steady, no fee yet", 0, 0);
  for (let d = 0; d < 6; d++) {
    day(movesBps[d] ?? 0);
    snap(`Week 1 day ${d + 1}: price moves ${pct(movesBps[d] ?? 0)}`, d + 1, d + 1);
  }

  // week 1 closes: its loss sets the week-2 fee; week 1's LONG settles
  w1Payout = payout(q1);
  pips = weekLvr > 0 && weekVolume > 0 ? Math.min(MAX_PIPS, Math.floor(((K * weekLvr) / weekVolume) * 1e6)) : 0;
  week = 2;
  weekLvr = 0;
  weekVolume = 0;
  weekLpFees = 0;
  snap("Week 1 closes: the measured loss sets the week-2 fee", 7, 10 / 60 / 24);

  for (let d = 0; d < 6; d++) {
    day(movesBps[6 + d] ?? 0);
    // handleHookFees: convert UNI fee claims to WETH in the pool, then buy LONG, at most K_MAX per call
    if (hookUni > 0) {
      hookWeth += swap(true, { amountIn: hookUni, hookOwn: true });
      hookUni = 0;
    }
    const elapsed = d + 1 + HOUR;
    if (hookWeth > 0) {
      const capIn = wethForLong(q2, elapsed, hookLong, K_MAX);
      let spend = Math.min(hookWeth, capIn);
      let n = longForWeth(q2, elapsed, hookLong, spend, SETS - hookLong);
      // largest fill: shrink until the curve sells (inventory, or price near the cap)
      for (let k = 0; k < 16 && n === 0 && spend > 1e-12; k++) {
        spend /= 2;
        n = longForWeth(q2, elapsed, hookLong, spend, SETS - hookLong);
      }
      if (n > 0) {
        hookLong += n;
        hookWeth -= spend;
        spent += spend;
      }
    }
    snap(`Week 2 day ${d + 1}: price moves ${pct(movesBps[6 + d] ?? 0)}`, 8 + d, elapsed);
  }

  w2Payout = payout(q2);
  donated = hookLong * w2Payout;
  hookLong = 0; // redeemed by claimPayout
  snap("Week 2 settles: cover pays out and is donated to LPs", 14, T_DAYS);
  return steps;
}

/** The fork harness's preset moves (contracts/test/scenario/PriceShock.t.sol), in basis points */
export const PRESETS: { key: string; name: string; blurb: string; moves: number[] }[] = [
  { key: "crash", name: "Crash, then crash", blurb: "Swings of 3 to 14% a day for two weeks.", moves: [-600, 400, -1200, 500, -800, 300, -1000, 700, -1400, 600, -900, 500] },
  { key: "shock_then_calm", name: "Crash, then calm", blurb: "A crash week sets the fee; the next week is quiet.", moves: [-600, 400, -1200, 500, -800, 300, -30, 20, -20, 40, -30, 10] },
  { key: "calm_then_crash", name: "Calm, then crash", blurb: "The weak case: a sudden first shock after a quiet week.", moves: [40, -30, 20, -40, 30, -20, -1000, 700, -1400, 600, -900, 500] },
  { key: "spike", name: "One-day spike", blurb: "One 15% day in each otherwise quiet week.", moves: [20, -30, -1500, 40, -20, 30, -20, 30, 40, -1500, 20, -30] },
  { key: "calm", name: "Calm", blurb: "Moves under half a percent a day.", moves: [40, -30, 20, -40, 30, -20, -30, 20, -20, 40, -30, 10] },
];

/** Headline numbers of a run (last step), for comparisons */
export function summary(steps: SimStep[]) {
  const last = steps[steps.length - 1];
  const beforeSettle = steps[steps.length - 2];
  const w1 = steps[6];
  return {
    feePips: steps[7]?.feePips ?? 0,
    hookLong: beforeSettle.hookLong / E18,
    spent: last.hookWethSpent / E18,
    w2PayoutShare: last.w2Payout / E18 / S,
    donated: last.donated / E18,
    lpWeek1: (w1.weekLpFees - w1.weekLvr) / E18,
    lpWeek2: (last.weekLpFees - last.weekLvr) / E18,
  };
}
