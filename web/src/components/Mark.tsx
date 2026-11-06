import Link from "next/link";

/**
 * Tremor mark: a stepped "T" built on a 4×4 grid, with its stem block knocked one step
 * sideways, like a seismograph trace jumping.
 */
export function Mark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <g fill="var(--color-signal)">
        <rect x="0" y="0" width="12" height="4" />
        <rect x="12" y="4" width="4" height="4" />
        <rect x="4" y="4" width="4" height="4" />
        <rect x="8" y="8" width="4" height="4" />
        <rect x="4" y="12" width="4" height="4" />
      </g>
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Tremor home">
      <Mark />
      <span className="text-[19px] font-semibold tracking-tight">Tremor</span>
    </Link>
  );
}
