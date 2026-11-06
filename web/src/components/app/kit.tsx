"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { formatUnits } from "viem";

/* ---- formatting ------------------------------------------------------------------------- */

/** Human token amount: commas above 1,000, 3 decimals above 1, 4 significant digits below. */
export function fmtToken(v: bigint | undefined, sym?: string): string {
  if (v === undefined) return "—";
  const n = Number(formatUnits(v, 18));
  let s: string;
  if (n === 0) s = "0";
  else if (Math.abs(n) >= 1000) s = n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  else if (Math.abs(n) >= 1) s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  else s = n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return sym ? `${s} ${sym}` : s;
}

export function fmtUsdCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

export function fmtWhen(unix: bigint | number): string {
  return new Date(Number(unix) * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fmtDayShort(unix: bigint | number, withYear = false): string {
  return new Date(Number(unix) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function fmtSpan(t0: bigint, t1: bigint): string {
  const y0 = new Date(Number(t0) * 1000).getUTCFullYear();
  const y1 = new Date(Number(t1) * 1000).getUTCFullYear();
  return `${fmtDayShort(t0, y0 !== y1)} – ${fmtDayShort(t1, true)}`;
}

/** "3d 4h" style duration. */
export function fmtDuration(seconds: bigint | number): string {
  let s = Math.max(0, Number(seconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ---- primitives ------------------------------------------------------------------------- */

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-medium tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-[14.5px] text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ title, info, action, children, className = "", pad = true }: { title?: ReactNode; info?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-1.5 text-[14.5px] font-medium">
            {title}
            {info && <InfoTip>{info}</InfoTip>}
          </h2>
          {action}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, info, loading, accent = false }: { label: string; value: ReactNode; sub?: ReactNode; info?: ReactNode; loading?: boolean; accent?: boolean }) {
  return (
    <div data-string="spotlight" className="st-spotlight rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div className={`num mt-2.5 text-[30px] font-medium leading-none tracking-tight ${accent ? "text-signal" : ""}`}>{loading ? <Skeleton className="h-[30px] w-28" /> : value}</div>
      <div className="mt-2.5 min-h-[18px] text-[12.5px] text-ink-3">{loading ? <Skeleton className="h-3 w-36" /> : sub}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded-md bg-hover align-middle ${className}`} />;
}

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label="More info" className="flex h-4 w-4 items-center justify-center rounded-full border border-line-2 text-[10px] font-semibold text-ink-3 hover:border-ink-3 hover:text-ink-2 focus:outline-none focus-visible:border-signal">
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-lg border border-line-2 bg-surface-2 p-3 text-left text-[12.5px] font-normal leading-relaxed text-ink-2 opacity-0 shadow-2xl shadow-black/50 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "live" | "done" | "warn"; children: ReactNode }) {
  const tones = {
    neutral: "border-line-2 text-ink-2",
    live: "border-signal/40 bg-signal/10 text-signal-2",
    done: "border-line-2 bg-hover text-ink",
    warn: "border-warn-line bg-warn-bg text-[#f0c36d]",
  } as const;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[12px] text-ink-2 hover:bg-hover hover:text-ink"
      title={value}
    >
      {label ?? `${value.slice(0, 6)}…${value.slice(-4)}`}
      <span className="text-[11px] text-ink-3">{done ? "copied" : "copy"}</span>
    </button>
  );
}

export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-2 px-4 py-8 text-center text-[13.5px] text-ink-3">{children}</div>;
}

export function ErrorNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#6b2a24] bg-[#1a0d0b] p-5">
      <div className="text-[14.5px] font-medium">{title}</div>
      {children && <div className="mt-1 text-[13.5px] text-ink-2">{children}</div>}
    </div>
  );
}
