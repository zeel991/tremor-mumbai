import { Card, Tag } from "@/components/ui";
import { WeeklyCharts } from "@/components/WeeklyCharts";
import { OUTLIER_WEEK, POOL, summary, weeks } from "@/lib/dataset";
import { fmtPct, fmtUsd } from "@/lib/format";

export const metadata = { title: "Data · Tremor" };

export default function DataPage() {
  const { all, exOutlier, worst } = summary;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Two years of {POOL} on Ethereum mainnet</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {all.n} weeks, {summary.first} to {summary.last}. Per week: LP fees, the loss LPs took to arbitrageurs, and what was left.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Headline
          tag={<Tag tone="measured">measured</Tag>}
          value={fmtPct(exOutlier.arbShare, 0)}
          label="of LP fees went to arbitrage"
          note={`${fmtUsd(exOutlier.arb / 1e6, 2)}M of ${fmtUsd(exOutlier.fees / 1e6, 2)}M, excluding the ${OUTLIER_WEEK} outlier week (${fmtPct(all.arbShare, 0)} with it).`}
        />
        <Headline
          tag={<Tag tone="measured">measured</Tag>}
          value={`${all.losing} of ${all.n}`}
          label="weeks LPs lost money"
          note={`${fmtUsd(all.losingTotal)} in total. Worst: week of ${worst.week}, ${fmtUsd(worst.net)}.`}
        />
        <Headline
          tag={<Tag tone="derived">derived · upper bound</Tag>}
          value="up to 49%"
          label="Premium rule backtest: recovers up to 49% of arbitrage loss (upper bound: assumes no volume lost)"
          note="Rule: next week's hook fee = 0.5 × last week's loss ÷ volume, capped at 0.30%. 102 consecutive week pairs (data/backtest_premium.py)."
        />
      </div>

      <Card
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Weekly fees, arbitrage loss and LP net <Tag tone="measured">Measured: every swap, valued at Binance prices</Tag>
          </span>
        }
        subtitle="Every swap in the pool, valued at the Binance 1-minute price at its second. Arbitrage loss = fees − LP net. Hover a chart to read a week."
      >
        <WeeklyCharts weeks={weeks} />
        <div className="mt-4 rounded-md border border-warn-line bg-warn-bg p-3 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">Outlier: week of {OUTLIER_WEEK} (shaded, off-scale).</span> On 29 Oct 2026, 22:34–22:42 UTC, about 1M UNI was
          sold into the pool at 20–28% below the Binance price. LPs bought cheaply and gained about $787k that week, which the method books as negative arbitrage
          loss. It is not arbitrage, so headline totals are shown without it. It does not change the losing-week count. The week&apos;s fee total is also about 3×
          DefiLlama&apos;s estimate (other checked weeks match within about 1–12%). Source: data/README.md.
        </div>
      </Card>

      <details className="rounded-lg border border-line bg-surface p-5 text-[13px]">
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

function Headline({ value, label, note, tag }: { value: string; label: string; note: string; tag: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-2">{tag}</div>
      <div className="num text-[30px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-2 text-[14px] font-medium">{label}</div>
      <div className="mt-1 text-[12.5px] text-ink-2">{note}</div>
    </div>
  );
}
