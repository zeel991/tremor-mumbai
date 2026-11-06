"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

/** Adds data-shown="true" once the element scrolls into view (CSS in globals.css does the rest). */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className = "",
  bare = false,
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
  /** set data-shown only, without the default fade/blur (for children with their own transitions) */
  bare?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} data-shown={shown} className={`${bare ? "" : "reveal"} ${className}`} style={{ "--delay": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

/** Counts up to `to` once visible. Renders the final value without JS and under reduced motion. */
type CountFormat = "pct" | "int" | "usd" | "usdM";
const FORMATS: Record<CountFormat, (n: number) => string> = {
  pct: (n) => `${Math.round(n)}%`,
  int: (n) => `${Math.round(n)}`,
  usd: (n) => `$${Math.round(n).toLocaleString("en-US")}`,
  usdM: (n) => `$${n.toFixed(2)}M`,
};

export function CountUp({ to, format, suffix = "", duration = 1400 }: { to: number; format: CountFormat; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        setValue(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      setValue(0);
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);
  return (
    <span ref={ref} className="num">
      {FORMATS[format](value)}
      {suffix}
    </span>
  );
}
