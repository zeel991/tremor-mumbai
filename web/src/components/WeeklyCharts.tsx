"use client";

import { useState, type MouseEvent } from "react";
import { OUTLIER_WEEK, type Week } from "@/lib/dataset";
import { fmtPct, fmtUsd } from "@/lib/format";

const W = 960;
const PAD_L = 56;
const PAD_R = 12;
const PLOT_W = W - PAD_L - PAD_R;

const C = {
  fees: "#6ea8ff",
  arb: "#f2452b",
  gain: "#8fa9c7",
  loss: "#ff5a4a",
  grid: "#26262b",
  axis: "#74747d",
  band: "#1a1a1e",
};

function compact(n: number) {
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}K` : `${a}`;
  return (n < 0 ? "−" : "") + "$" + s;
}

export function WeeklyCharts({ weeks }: { weeks: Week[] }) {
  const worstIdx = weeks.reduce((bi, w, i) => (w.net < weeks[bi].net ? i : bi), 0);
  const [hover, setHover] = useState<number | null>(null);
  const idx = hover ?? worstIdx;
  const n = weeks.length;
  const band = PLOT_W / n;
  const xc = (i: number) => PAD_L + band * i + band / 2;
  const outlierIdx = weeks.findIndex((w) => w.week === OUTLIER_WEEK);

  function onMove(e: MouseEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * PLOT_W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor(x / band))));
  }

  // quarter ticks on the x axis
  const xTicks = weeks
    .map((w, i) => ({ i, w }))
    .filter(({ w, i }) => {
      const m = w.week.slice(0, 7);
      const prev = i > 0 ? weeks[i - 1].week.slice(0, 7) : "";
      return m !== prev && ["01", "04", "07", "10"].includes(m.slice(5));
    });

  const sel = weeks[idx];

  // ---- chart A: fees vs arbitrage loss per $1M TVL (lines) ----
  const A_H = 230;
  const aTop = 14;
  const aBot = A_H - 26;
  const aMax = 18_000;
  const ya = (v: number) => aBot - (Math.max(0, Math.min(aMax, v)) / aMax) * (aBot - aTop);
  const line = (key: "fees_1m" | "arb_1m") => {
    let d = "";
    let pen = false;
    weeks.forEach((w, i) => {
      if (i === outlierIdx) {
        pen = false; // break the line: the outlier week is off-scale (see note)
        return;
      }
      d += `${pen ? "L" : "M"}${xc(i).toFixed(1)},${ya(w[key]).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  // ---- chart B: LP net per $1M TVL (bars) ----
  const B_H = 230;
  const bTop = 14;
  const bBot = B_H - 26;
  const bMin = -7_000;
  const bMax = 4_000;
  const yb = (v: number) => bTop + ((bMax - Math.max(bMin, Math.min(bMax, v))) / (bMax - bMin)) * (bBot - bTop);
  const barW = Math.max(2, Math.min(24, band - 2));

  const xAxis = (y: number) =>
    xTicks.map(({ i, w }) => (
      <text key={w.week} x={xc(i)} y={y} textAnchor="middle" fontSize="11" fill={C.axis}>
        {w.week.slice(0, 7)}
      </text>
    ));

  const outlierBand = (top: number, bot: number, label: string) =>
    outlierIdx >= 0 && (
      <g>
        <rect x={PAD_L + band * outlierIdx} y={top} width={band} height={bot - top} fill={C.band} />
        <text x={xc(outlierIdx) - 6} y={top + 10} textAnchor="end" fontSize="10.5" fill={C.axis}>
          {label}
        </text>
      </g>
    );

  const crosshair = (top: number, bot: number) => <line x1={xc(idx)} x2={xc(idx)} y1={top} y2={bot} stroke="var(--color-ink)" strokeOpacity={0.35} strokeWidth={1} />;

  return (
    <div>
      {/* selected-week readout (hover a chart to move it) */}
      <div className="num mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-line bg-surface-2 p-3 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-[11.5px] text-ink-3">{hover === null ? "Worst week" : "Week of"}</div>
          <div className="font-semibold">{sel.week}</div>
        </div>
        <Readout label="Fees / $1M" value={fmtUsd(sel.fees_1m)} swatch={C.fees} />
        <Readout label="Arbitrage loss / $1M" value={fmtUsd(sel.arb_1m)} swatch={C.arb} />
        <Readout label="LP net / $1M" value={fmtUsd(sel.net_1m)} swatch={sel.net < 0 ? C.loss : C.gain} />
        <Readout label="LP net, pool" value={fmtUsd(sel.net)} />
        <Readout label="ETH vol · swaps" value={`${fmtPct(sel.eth_vol, 0)} · ${sel.swaps.toLocaleString()}`} />
      </div>

      <figure>
        <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          <span className="font-medium text-ink">Weekly LP fees vs arbitrage loss, per $1M of liquidity</span>
          <Key color={C.fees} kind="line" label="LP fees" />
          <Key color={C.arb} kind="line" label="Arbitrage loss" />
        </figcaption>
        <svg viewBox={`0 0 ${W} ${A_H}`} className="w-full" role="img" aria-label="Weekly fees and arbitrage loss per $1M TVL, UNI/WETH 0.3%">
          {[0, 5000, 10000, 15000].map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={ya(t)} y2={ya(t)} stroke={C.grid} strokeWidth={1} />
              <text x={PAD_L - 8} y={ya(t) + 4} textAnchor="end" fontSize="11" fill={C.axis}>
                {compact(t)}
              </text>
            </g>
          ))}
          {outlierBand(aTop, aBot, "outlier week, off-scale →")}
          <path d={line("fees_1m")} fill="none" stroke={C.fees} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={line("arb_1m")} fill="none" stroke={C.arb} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {crosshair(aTop, aBot)}
          {idx !== outlierIdx && (
            <>
              <circle cx={xc(idx)} cy={ya(sel.fees_1m)} r={4} fill={C.fees} stroke="var(--color-surface)" strokeWidth={2} />
              <circle cx={xc(idx)} cy={ya(sel.arb_1m)} r={4} fill={C.arb} stroke="var(--color-surface)" strokeWidth={2} />
            </>
          )}
          {xAxis(A_H - 8)}
          <rect x={PAD_L} y={0} width={PLOT_W} height={A_H} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      </figure>

      <figure className="mt-5">
        <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          <span className="font-medium text-ink">LP net (fees − arbitrage loss), per $1M of liquidity</span>
          <Key color={C.gain} kind="bar" label="Positive week" />
          <Key color={C.loss} kind="bar" label="Losing week" />
        </figcaption>
        <svg viewBox={`0 0 ${W} ${B_H}`} className="w-full" role="img" aria-label="Weekly LP net per $1M TVL, losing weeks in red">
          {[-6000, -4000, -2000, 0, 2000, 4000].map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yb(t)} y2={yb(t)} stroke={t === 0 ? "var(--color-line-2)" : C.grid} strokeWidth={1} />
              <text x={PAD_L - 8} y={yb(t) + 4} textAnchor="end" fontSize="11" fill={C.axis}>
                {compact(t)}
              </text>
            </g>
          ))}
          {outlierBand(bTop, bBot, `+${fmtUsd(weeks[outlierIdx]?.net_1m ?? 0)} off-scale →`)}
          {weeks.map((w, i) => {
            if (i === outlierIdx) return null;
            const y0 = yb(0);
            const y1 = yb(w.net_1m);
            const top = Math.min(y0, y1);
            const h = Math.max(1, Math.abs(y1 - y0));
            return <rect key={w.week} x={xc(i) - barW / 2} y={top} width={barW} height={h} rx={Math.min(2, barW / 2)} fill={w.net < 0 ? C.loss : C.gain} opacity={hover === null || hover === i ? 1 : 0.55} />;
          })}
          {crosshair(bTop, bBot)}
          {xAxis(B_H - 8)}
          <rect x={PAD_L} y={0} width={PLOT_W} height={B_H} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      </figure>
    </div>
  );
}

function Readout({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
        {swatch && <span className="inline-block h-2 w-2 rounded-full" style={{ background: swatch }} />}
        {label}
      </div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Key({ color, kind, label }: { color: string; kind: "line" | "bar"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "line" ? <span className="inline-block h-[2px] w-4 rounded" style={{ background: color }} /> : <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}
      {label}
    </span>
  );
}
