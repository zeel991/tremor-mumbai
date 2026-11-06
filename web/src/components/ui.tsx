import type { ReactNode } from "react";

export function Card({ title, subtitle, children, right }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      {(title || right) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tag }: { label: string; value: ReactNode; note?: ReactNode; tag?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-[12px] text-ink-2">
        <span>{label}</span>
        {tag && <Tag>{tag}</Tag>}
      </div>
      <div className="num mt-1 truncate text-[20px] font-semibold">{value}</div>
      {note && <div className="mt-0.5 text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "measured" | "derived" | "estimate" | "warn" }) {
  const tones = {
    neutral: "border-line text-ink-2",
    measured: "border-[#24426b] bg-[#0f1a2a] text-[#8fbaff]",
    derived: "border-[#4a3166] bg-[#1b1326] text-[#c9a6f0]",
    estimate: "border-warn-line bg-warn-bg text-[#f0c36d]",
    warn: "border-warn-line bg-warn-bg text-[#f0c36d]",
  } as const;
  return <span className={`inline-block rounded border px-1.5 py-px text-[11px] font-medium uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

export function Notice({ title, children, tone = "warn" }: { title: string; children?: ReactNode; tone?: "warn" | "info" | "error" }) {
  const tones = {
    warn: "border-warn-line bg-warn-bg",
    info: "border-line bg-surface",
    error: "border-[#6b2a24] bg-[#22100e]",
  } as const;
  return (
    <div className={`rounded-lg border p-4 text-[14px] ${tones[tone]}`}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 text-ink-2">{children}</div>}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 py-px font-mono text-[12.5px]">{children}</code>;
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="font-mono text-[12.5px]" title={title}>
      {children}
    </span>
  );
}
