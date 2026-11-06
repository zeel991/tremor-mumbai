import { OUTLIER_WEEK, weeks } from "@/lib/dataset";
import { fmtUsd } from "@/lib/format";

/**
 * LP net per week (fees minus arbitrage loss) for all measured weeks. Losing weeks in signal red.
 * The outlier week is clipped to the top of the scale and marked.
 */
export function WeeklyBars() {
  const W = 1040;
  const H = 260;
  const top = 18;
  const bottom = 30;
  const rest = weeks.filter((w) => w.week !== OUTLIER_WEEK);
  const maxPos = Math.max(...rest.map((w) => w.net), 1);
  const maxNeg = Math.max(...rest.map((w) => -w.net), 1);
  const k = (H - top - bottom) / (maxPos + maxNeg);
  const zeroY = top + maxPos * k;
  const step = W / weeks.length;
  const bw = Math.max(2, step - 2.5);
  const worst = weeks.reduce((a, w) => (w.net < a.net ? w : a), weeks[0]);
  const worstI = weeks.indexOf(worst);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`LP net per week across ${weeks.length} weeks; worst week ${worst.week} at ${fmtUsd(worst.net)}`}>
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--color-line-2)" />
      {weeks.map((w, i) => {
        const clipped = w.week === OUTLIER_WEEK;
        const v = clipped ? maxPos : w.net;
        const h = Math.abs(v) * k;
        const y = v >= 0 ? zeroY - h : zeroY;
        const fill = w.net < 0 ? "var(--color-signal)" : clipped ? "var(--color-ink-3)" : "var(--color-line-2)";
        return (
          <rect
            key={w.week}
            className="bar"
            style={{ ["--i" as string]: i, transformOrigin: `0 ${zeroY}px`, transformBox: "view-box" }}
            x={i * step + 1}
            y={y}
            width={bw}
            height={Math.max(1, h)}
            rx={1}
            fill={fill}
          >
            <title>{`${w.week}: LP net ${fmtUsd(w.net)}${clipped ? " (outlier, off scale)" : ""}`}</title>
          </rect>
        );
      })}
      <g fontFamily="var(--font-mono)" fontSize={12} fill="var(--color-ink-2)">
        <text x={worstI * step + bw / 2} y={H - 8} textAnchor="middle" fill="var(--color-signal)">
          {`${worst.week} · ${fmtUsd(worst.net)}`}
        </text>
        <text x={0} y={H - 8}>{weeks[0].week}</text>
        <text x={W} y={H - 8} textAnchor="end">
          {weeks[weeks.length - 1].week}
        </text>
      </g>
    </svg>
  );
}
