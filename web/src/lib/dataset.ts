import raw from "@/generated/full_104w.json";

export type Week = {
  week: string;
  eth_vol: number;
  pair_vol: number;
  swaps: number;
  tvl: number;
  fees: number;
  arb: number;
  net: number;
  fees_1m: number;
  arb_1m: number;
  net_1m: number;
};

export const POOL = "UNI/WETH 0.3%";
/** data/README.md: ~1M UNI dumped 20–28% below market on 29 Oct 2026; not arbitrage. */
export const OUTLIER_WEEK = "2026-10-26";

export const weeks: Week[] = (raw as unknown as Record<string, Week[]>)[POOL];

function totals(ws: Week[]) {
  const fees = ws.reduce((a, w) => a + w.fees, 0);
  const arb = ws.reduce((a, w) => a + w.arb, 0);
  const net = ws.reduce((a, w) => a + w.net, 0);
  const losing = ws.filter((w) => w.net < 0);
  return { n: ws.length, fees, arb, net, arbShare: arb / fees, losing: losing.length, losingTotal: losing.reduce((a, w) => a + w.net, 0) };
}

export const summary = {
  all: totals(weeks),
  exOutlier: totals(weeks.filter((w) => w.week !== OUTLIER_WEEK)),
  worst: [...weeks].sort((a, b) => a.net - b.net)[0],
  first: weeks[0]?.week,
  last: weeks[weeks.length - 1]?.week,
};
