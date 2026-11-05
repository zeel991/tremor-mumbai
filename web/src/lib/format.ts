import { formatUnits } from "viem";

const WAD = 10n ** 18n;

/** Format an 18-decimal amount with a fixed number of decimals (truncated, not rounded). */
export function fmtWad(v: bigint, decimals = 4): string {
  const neg = v < 0n;
  const s = formatUnits(neg ? -v : v, 18);
  const [i, f = ""] = s.split(".");
  const int = BigInt(i).toLocaleString("en-US");
  const frac = decimals > 0 ? "." + (f + "0".repeat(decimals)).slice(0, decimals) : "";
  return (neg ? "-" : "") + int + frac;
}

/** Full-precision 18-decimal string (no truncation). */
export const fmtWadExact = (v: bigint) => formatUnits(v, 18);

export function fmtUsdWad(v: bigint): string {
  const n = Number(v) / 1e18;
  return fmtUsd(n);
}

export function fmtUsd(n: number, digits = 0): string {
  const sign = n < 0 ? "−" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(x: number, digits = 1): string {
  return (x * 100).toFixed(digits) + "%";
}

/** Annualized variance (WAD) -> annualized volatility, e.g. 2.25e18 -> 150%. */
export function varianceToVol(vWad: bigint): number {
  return Math.sqrt(Number(vWad) / Number(WAD));
}

export function fmtDate(unixSeconds: bigint | number): string {
  const d = new Date(Number(unixSeconds) * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function fmtDay(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);
}

export function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function pipsToPct(pips: number | bigint): string {
  return (Number(pips) / 1e4).toFixed(2) + "%";
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: string; message?: string };
    return o.shortMessage ?? o.message ?? String(e);
  }
  return String(e);
}
