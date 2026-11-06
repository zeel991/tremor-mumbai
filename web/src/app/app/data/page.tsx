import { Card } from "@/components/ui";
import { Kpi, PageHeader } from "@/components/app/kit";
import { WeeklyCharts } from "@/components/WeeklyCharts";
import { OUTLIER_WEEK, POOL, summary, weeks } from "@/lib/dataset";
import { fmtPct, fmtUsd } from "@/lib/format";

export const metadata = { title: "Data · Tremor" };

export default function DataPage() {
  const { all, exOutlier, worst } = summary;
  return (
    <div className="space-y-4">
      <PageHeader title="Data" sub={`Every swap in the ${POOL} pool on Ethereum, ${summary.first} to ${summary.last}, valued at Binance one-minute prices.`} />

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi
          label="Fees taken by arbitrage"
          value={fmtPct(exOutlier.arbShare, 0)}
          sub={`${fmtUsd(exOutlier.arb / 1e6, 2)}M of ${fmtUsd(exOutlier.fees / 1e6, 2)}M in LP fees`}
          info={`Excludes the week of ${OUTLIER_WEEK}, an outlier (${fmtPct(all.arbShare, 0)} with it).`}
        />
        <Kpi label="Weeks LPs lost money" value={`${all.losing} of ${all.n}`} sub={`Worst: week of ${worst.week}, ${fmtUsd(worst.net)}`} info={`${fmtUsd(all.losingTotal)} lost across those weeks.`} />
        <Kpi
          label="Recoverable by the fee rule"
          value="Up to 49%"
          sub="Backtest over 102 week pairs"
          info="Next week's fee = 0.5 × last week's loss ÷ volume, capped at 0.30%. An upper bound: it assumes the fee costs the pool no volume. Source: data/backtest_premium.py."
        />
      </div>

      <Card
        title="Weekly fees, arbitrage loss and LP net"
        subtitle="Arbitrage loss = fees minus LP net. Hover the chart to read a week."
      >
        <WeeklyCharts weeks={weeks} />
        <div className="mt-4 rounded-md border border-warn-line bg-warn-bg p-3 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Outlier: week of {OUTLIER_WEEK} (shaded, off-scale).</span> On 29 Oct 2026, 22:34–22:42 UTC, about 1M UNI was
          sold into the pool at 20–28% below the Binance price. LPs bought cheaply and gained about $787k that week, which the method books as negative arbitrage
          loss. It is not arbitrage, so headline totals are shown without it. It does not change the losing-week count. The week&apos;s fee total is also about 3×
          DefiLlama&apos;s estimate (other checked weeks match within about 1–12%). Source: data/README.md.
        </div>
      </Card>

      <details className="rounded-2xl border border-line bg-surface p-5 text-[13px]">
        <summary className="cursor-pointer font-medium">All {weeks.length} weeks as a table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="num w-full min-w-[720px]">
            <thead className="text-left text-[12px] text-ink-2">
              <tr>
                <th className="py-1.5 font-medium">Week</th>
                <th className="py-1.5 text-right font-medium">ETH vol</th>
                <th className="py-1.5 text-right font-medium">Swaps</th>
                <th className="py-1.5 text-right font-medium">TVL</th>
                <th className="py-1.5 text-right font-medium">Fees</th>
                <th className="py-1.5 text-right font-medium">Arb loss</th>
                <th className="py-1.5 text-right font-medium">LP net</th>
                <th className="py-1.5 text-right font-medium">Net / $1M</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} className={`border-t border-line ${w.week === OUTLIER_WEEK ? "bg-warn-bg" : ""}`}>
                  <td className="py-1">
                    {w.week}
                    {w.week === OUTLIER_WEEK ? " (outlier)" : ""}
                  </td>
                  <td className="py-1 text-right">{fmtPct(w.eth_vol, 0)}</td>
                  <td className="py-1 text-right">{w.swaps.toLocaleString()}</td>
                  <td className="py-1 text-right">{fmtUsd(w.tvl)}</td>
                  <td className="py-1 text-right">{fmtUsd(w.fees)}</td>
                  <td className="py-1 text-right">{fmtUsd(w.arb)}</td>
                  <td className={`py-1 text-right ${w.net < 0 ? "font-semibold text-loss" : ""}`}>{fmtUsd(w.net)}</td>
                  <td className="py-1 text-right">{fmtUsd(w.net_1m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
