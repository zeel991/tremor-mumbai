"use client";

import { useEffect, useMemo, useState } from "react";
import data from "@/generated/scenarios.json";
import { Kpi, PageHeader, Panel } from "./kit";

type Step = {
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

const SCENARIOS: { key: string; name: string; blurb: string }[] = [
  { key: "crash", name: "Crash, then crash", blurb: "UNI/ETH swings 3 to 14% a day for two weeks." },
  { key: "shock_then_calm", name: "Crash, then calm", blurb: "A crash week sets the fee; the next week is quiet." },
  { key: "calm", name: "Calm", blurb: "Moves under half a percent a day for two weeks." },
];

const all = data as unknown as Record<string, Step[]>;
const E18 = 1e18;
const C = { price: "#f5f5f4", pool: "#6ea8ff", long: "#f2452b", fee: "#8fa9c7", grid: "#26262b", axis: "#74747d", now: "#f2452b" };

export function StressView() {
  const available = SCENARIOS.filter((s) => all[s.key]?.length);
  const [key, setKey] = useState(available[0]?.key ?? "crash");
  const steps = useMemo(() => all[key] ?? [], [key]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  const atEnd = i >= steps.length - 1;
  const running = playing && !atEnd;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 1400);
    return () => clearInterval(t);
  }, [running, steps.length]);

  if (!available.length) {
    return (
      <>
        <PageHeader title="Stress test" />
        <p className="text-[14px] text-ink-2">No scenario data. Run the scenarios on a mainnet fork (contracts/test/scenario/PriceShock.t.sol), then npm run sync.</p>
      </>
    );
  }

  const s = steps[Math.min(i, steps.length - 1)];
  const p0 = steps[0].oracle;
  const longPrice = s.longPerWeth > 0 ? E18 / s.longPerWeth : null;
  const settledW2 = s.step === steps.length - 1;
  const priceChange = (s.oracle / p0 - 1) * 100;
  const lossRate = s.weekVolume > 0 ? (s.weekLvr / s.weekVolume) * 100 : 0;

  const pick = (k: string) => {
    setKey(k);
    setI(0);
    setPlaying(false);
  };

  return (
    <>
      <PageHeader
        title="Stress test"
        sub="Two weeks of price moves on a mainnet fork. See how the hook fee, the cover price on 1inch Aqua and the payout to LPs react."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {available.map((x) => (
          <button
            key={x.key}
            onClick={() => pick(x.key)}
            className={`rounded-lg border px-3 py-2 text-left text-[13px] ${x.key === key ? "border-ink-3 bg-hover" : "border-line hover:bg-hover"}`}
          >
            <div className="font-medium text-ink">{x.name}</div>
            <div className="text-ink-3">{x.blurb}</div>
          </button>
        ))}
      </div>

      <Panel className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              if (atEnd) {
                setI(0);
                setPlaying(true);
              } else setPlaying(!running);
            }}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] hover:bg-hover"
          >
            {running ? "Pause" : atEnd ? "Replay" : "Play"}
          </button>
          <button onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }} className="rounded-md border border-line px-2.5 py-1.5 text-[13px] hover:bg-hover" aria-label="Previous step">
            ←
          </button>
          <button onClick={() => { setPlaying(false); setI((x) => Math.min(steps.length - 1, x + 1)); }} className="rounded-md border border-line px-2.5 py-1.5 text-[13px] hover:bg-hover" aria-label="Next step">
            →
          </button>
          <input
            type="range"
            min={0}
            max={steps.length - 1}
            value={i}
            onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
            className="min-w-[160px] flex-1"
            aria-label="Step"
          />
          <span className="num text-[13px] text-ink-3">Day {s.day} of 14</span>
        </div>
        <div className="mt-3 text-[17px] font-medium tracking-tight">{s.label}</div>
        <div className="mt-1 text-[13px] text-ink-2">{narrate(s, steps)}</div>
      </Panel>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="UNI/ETH (Chainlink-style feed)" value={`${priceChange >= 0 ? "+" : "−"}${Math.abs(priceChange).toFixed(1)}%`} sub="since day 0" />
        <Kpi label="LP loss measured this week" value={`${lossRate.toFixed(2)}%`} sub={`of volume · ${(s.weekLvr / E18).toFixed(3)} WETH`} />
        <Kpi label="Hook fee (Uniswap v4)" value={`${(s.feePips / 1e4).toFixed(s.feePips && s.feePips < 100 ? 4 : 2)}%`} sub={s.week === 1 ? "set when week 1 closes" : "half the loss rate, max 0.30%"} accent={s.feePips > 0} />
        <Kpi
          label="Cover price (1inch Aqua, 0x22)"
          value={longPrice ? `${longPrice.toFixed(3)}` : settledW2 || s.step === 7 ? "—" : "max"}
          sub={longPrice ? `WETH per LONG · week vol ${(s.volBps / 100).toFixed(0)}%` : settledW2 || s.step === 7 ? "window settled" : `near the 1 WETH cap: no sale · week vol ${(s.volBps / 100).toFixed(0)}%`}
        />
        <Kpi label="Paid back to LPs" value={`${(s.donated / E18).toFixed(3)} WETH`} sub={`hook holds ${(s.hookLong / E18).toFixed(3)} LONG · spent ${(s.hookWethSpent / E18).toFixed(3)} WETH`} accent={s.donated > 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Price: oracle vs pool">
          <LineChart
            steps={steps}
            at={i}
            series={[
              { color: C.price, y: (x) => x.oracle / 1e15, label: "Oracle UNI/ETH" },
              { color: C.pool, y: (x) => x.pool / 1e15, label: "Uniswap pool", dashed: true },
            ]}
            fmt={(v) => v.toFixed(2)}
            unit="milli-ETH per UNI"
          />
        </Panel>
        <Panel title="Cover price and hook fee">
          <LineChart
            steps={steps}
            at={i}
            series={[
              { color: C.long, y: (x) => (x.longPerWeth > 0 ? E18 / x.longPerWeth : null), label: "LONG price (WETH)" },
              { color: C.fee, y: (x) => x.feePips / 3000, label: "Hook fee (share of the 0.30% cap)", step: true },
            ]}
            fmt={(v) => v.toFixed(2)}
            unit="0 to 1"
            yMax={1}
          />
        </Panel>
      </div>

      <Panel className="mt-4" title="What each part does here">
        <ul className="grid gap-3 text-[13.5px] leading-relaxed text-ink-2 md:grid-cols-2">
          <li><span className="font-medium text-ink">Price moves.</span> A Chainlink-style feed publishes a new UNI/ETH price each day; an arbitrageur trades the Uniswap pool to it, and LPs lose on that trade.</li>
          <li><span className="font-medium text-ink">Loss measured.</span> Each day&apos;s swaps are valued with the CRE workflow&apos;s formula and delivered to the receiver. When week 1 closes, the receiver sets the hook fee.</li>
          <li><span className="font-medium text-ink">Cover priced and bought.</span> LONG is priced by our SwapVM instruction on 1inch Aqua; its price climbs as volatility arrives. In week 2 the hook spends the fees on LONG.</li>
          <li><span className="font-medium text-ink">Payout.</span> When week 2 ends, the market settles from every feed round in the week; the hook redeems its LONG and donates the WETH to in-range LPs.</li>
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-3">
          Run on a mainnet fork with the deployed Uniswap v4 PoolManager and 1inch Aqua and Tremor&apos;s live-build contracts. The UNI/ETH feed is a controllable test feed so prices can be moved on demand, and the daily measurements are computed with the CRE workflow&apos;s formula and delivered through the receiver; this is not a CRE run.
          Source: contracts/test/scenario/PriceShock.t.sol (forge test --match-path &apos;test/scenario/*&apos; -vv).
        </p>
      </Panel>
    </>
  );
}

function narrate(s: Step, steps: Step[]): string {
  const last = steps.length - 1;
  if (s.step === 0) return "The pool sits at the oracle price. No loss measured, no fee, and LONG is priced on the writer's forecast.";
  if (s.step === last) {
    const paid = s.donated / 1e18;
    const spent = s.hookWethSpent / 1e18;
    return paid > 0
      ? `Week 2 settled: each LONG paid ${(s.w2Payout / 1e18).toFixed(3)} WETH. The hook spent ${spent.toFixed(3)} WETH of fees on cover and donated ${paid.toFixed(3)} WETH to LPs.`
      : "Week 2 settled. The fee stayed near zero, so the hook bought almost no cover and there is little or nothing to pay out.";
  }
  if (s.week === 1 && s.step < 7)
    return `The arbitrageur moved the pool to the new price. Measured LP loss so far: ${((s.weekLvr / Math.max(s.weekVolume, 1)) * 100).toFixed(2)}% of volume. LONG reprices as realized volatility comes in.`;
  if (s.step === 7)
    return s.feePips > 0
      ? `Week 1's loss sets the fee for week 2: ${(s.feePips / 1e4).toFixed(s.feePips < 100 ? 4 : 2)}%. Week 1's LONG settled at ${(s.w1Payout / 1e18).toFixed(3)} WETH.`
      : "Week 1 was quiet, so the fee stays at zero.";
  return s.longPerWeth > 0
    ? "Swappers pay the fee; the hook buys LONG for week 2 on Aqua. LONG gets dearer as the week turns volatile."
    : "Projected volatility is above the cap: LONG is worth its full 1 WETH, so the curve stops selling and the hook keeps its fees.";
}

type Series = { color: string; y: (s: Step) => number | null; label: string; dashed?: boolean; step?: boolean };

function LineChart({ steps, at, series, fmt, unit, yMax }: { steps: Step[]; at: number; series: Series[]; fmt: (v: number) => string; unit: string; yMax?: number }) {
  const W = 520;
  const H = 210;
  const L = 44;
  const R = 10;
  const T = 12;
  const B = 28;
  const days = steps.map((s) => s.day);
  const maxDay = Math.max(...days, 14);
  const vals = series.flatMap((se) => steps.map(se.y).filter((v): v is number => v !== null));
  const lo = yMax !== undefined ? 0 : Math.min(...vals) * 0.97;
  const hi = yMax ?? Math.max(...vals) * 1.03;
  const x = (d: number) => L + (d / maxDay) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(" and ")}>
        <rect x={x(0)} y={T} width={x(7) - x(0)} height={H - T - B} fill="#ffffff" opacity={0.02} />
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.grid} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.axis}>{fmt(t)}</text>
          </g>
        ))}
        {[0, 7, 14].map((d) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={11} fill={C.axis}>{d === 0 ? "day 0" : `day ${d}`}</text>
        ))}
        <text x={x(3.5)} y={T + 12} textAnchor="middle" fontSize={11} fill={C.axis}>week 1</text>
        <text x={x(10.5)} y={T + 12} textAnchor="middle" fontSize={11} fill={C.axis}>week 2</text>
        {series.map((se) => {
          const pts: string[] = [];
          let seg: string[] = [];
          const segs: string[][] = [];
          steps.forEach((s, k) => {
            const v = se.y(s);
            if (v === null) {
              if (seg.length) segs.push(seg);
              seg = [];
              return;
            }
            if (se.step && k > 0) {
              const pv = se.y(steps[k - 1]);
              if (pv !== null) seg.push(`${x(s.day)},${y(pv)}`);
            }
            seg.push(`${x(s.day)},${y(v)}`);
            pts.push(`${x(s.day)},${y(v)}`);
          });
          if (seg.length) segs.push(seg);
          return (
            <g key={se.label}>
              {segs.map((sg, k) => (
                <polyline key={k} points={sg.join(" ")} fill="none" stroke={se.color} strokeWidth={2} strokeDasharray={se.dashed ? "5 4" : undefined} />
              ))}
            </g>
          );
        })}
        <line x1={x(steps[at].day)} x2={x(steps[at].day)} y1={T} y2={H - B} stroke={C.now} strokeWidth={1} opacity={0.7} />
        {series.map((se) => {
          const v = se.y(steps[at]);
          return v === null ? null : <circle key={se.label} cx={x(steps[at].day)} cy={y(v)} r={4} fill={se.color} />;
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
        {series.map((se) => (
          <span key={se.label} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: se.color }} />
            {se.label}
          </span>
        ))}
        <span>· {unit}</span>
      </div>
    </div>
  );
}
