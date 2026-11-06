"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A ribbon that runs the full length of the landing page and draws itself as you scroll.
 *
 * The path is built from the live layout: it enters the hero from the left, loops around the
 * orb, runs down the side margins, crosses between sections with a loop in the gap, and ends
 * wrapped around the closing mark. Its tip follows a line 75% down the viewport, so scrolling
 * back up retracts it.
 *
 * Anchors (set in page.tsx): data-band-root, data-band-orb, data-band-cta, data-band-strip,
 * data-band-mark, and the root's direct <section> children.
 * Under prefers-reduced-motion the ribbon is drawn in full and stays still.
 */

type Pt = [number, number];
type Occluder = { cx: number; cy: number; R: number; tilt: number; ly: number };
type Geo = { d: string; w: number; h: number; bw: number; orb?: Occluder };

const CONTENT = 1152; // max-w-6xl

function smooth(pts: Pt[]): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/**
 * Points around a tilted ellipse, from angle `from` through `sweep` radians. `grow` widens the
 * ellipse along the way (a spiral), so a second pass sits beside the first instead of on it.
 */
function loop(cx: number, cy: number, rx: number, ry: number, tilt: number, from: number, sweep: number, steps: number, grow = 0): Pt[] {
  const out: Pt[] = [];
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  for (let i = 0; i <= steps; i++) {
    const a = from + (sweep * i) / steps;
    const g = 1 + (grow * i) / steps;
    const x = rx * g * Math.cos(a);
    const y = ry * g * Math.sin(a);
    out.push([cx + x * ct - y * st, cy + x * st + y * ct]);
  }
  return out;
}

function build(root: HTMLElement): Geo | null {
  const rb = root.getBoundingClientRect();
  const W = root.clientWidth;
  const H = root.scrollHeight;
  const box = (el: Element | null) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left - rb.left, y: b.top - rb.top, w: b.width, h: b.height };
  };

  const sections = [...root.querySelectorAll(":scope > section")];
  const hero = box(sections[0] ?? null);
  if (!hero || sections.length < 2) return null;

  const gutter = Math.max(0, (W - CONTENT) / 2);
  const wide = gutter > 70;
  const mobile = W < 768;
  const bw = wide ? 26 : mobile ? 12 : 16;
  const edgeL = wide ? gutter / 2 : bw * 0.4;
  const edgeR = W - edgeL;
  const pts: Pt[] = [];
  let occ: Occluder | undefined;

  // ---- hero: enter left, loop around the orb, leave down the right margin ----------------
  const cta = box(root.querySelector("[data-band-cta]"));
  const strip = box(root.querySelector("[data-band-strip]"));
  const gapY = cta && strip ? (cta.y + cta.h + strip.y) / 2 : hero.y + hero.h * 0.72;
  pts.push([-bw * 4, gapY + 30]);

  const orb = box(root.querySelector("[data-band-orb]"));
  if (orb && !mobile) {
    const cx = orb.x + orb.w / 2;
    const cy = orb.y + orb.h / 2;
    const R = Math.min(orb.w, orb.h) * 0.36;
    const rx = R * 1.3;
    const ry = R * 0.36;
    const tilt = -0.18;
    occ = { cx, cy, R: R * 0.98, tilt, ly: cy + R * 0.12 };
    const ly = cy + R * 0.12;
    // Counter-clockwise on screen: in along the front, up the right, behind across the top,
    // down the left, round the front again a little lower, then out to the right.
    const from = Math.PI * 0.64;
    const sweep = -Math.PI * 2.3;
    const ring = loop(cx, ly, rx, ry, tilt, from, sweep, 18, 0.2);
    pts.push([ring[0][0] - rx * 0.9, ring[0][1] + 8]);
    pts.push(...ring);
    pts.push([Math.min(edgeR - 40, cx + rx * 1.45), ly + R * 0.55]);
  } else {
    pts.push([W * 0.45, gapY - 6], [edgeR - 4, gapY + 70]);
  }
  pts.push([edgeR, hero.y + hero.h - 24]);

  // ---- body sections: run down a margin, cross to the other side in the gap between sections.
  // Sections have 96–128px of padding top and bottom, so each crossing stays within ±90px of the
  // boundary and never touches content. The last gap holds the finale: a loop around the mark.
  let side: "L" | "R" = "R";
  const body = sections.slice(1).map((sec) => box(sec)!);
  const mark = box(root.querySelector("[data-band-mark]"));
  const r = mobile ? 30 : 50;
  for (let i = 0; i < body.length - 1; i++) {
    const s = body[i];
    const x = side === "R" ? edgeR : edgeL;
    const wig = (side === "R" ? -1 : 1) * Math.min(28, gutter * 0.25);
    const by = s.y + s.h;
    const dir = side === "R" ? -1 : 1; // direction of travel when crossing
    if (i === 0) pts.push([x, s.y + Math.min(140, s.h * 0.2)]);
    pts.push([x + wig, s.y + s.h * 0.5]);
    pts.push([x, by - 105]);

    if (i === body.length - 2 && mark) {
      // Finale: from this margin into a loop around the closing mark, then off the far edge
      // above the closing heading.
      const cx = mark.x + mark.w / 2;
      const cy = mark.y + mark.h / 2;
      pts.push([cx - dir * 210, cy - 84]);
      pts.push(...loop(cx, cy - 9, 96, 41, -0.04, dir > 0 ? Math.PI : 0, -dir * Math.PI * 1.4, 14, 0.1));
      pts.push([cx + dir * 260, cy - 66]);
      pts.push([dir > 0 ? W + bw * 4 : -bw * 4, cy - 70]);
      break;
    }

    const cx = W * (side === "R" ? 0.62 : 0.38);
    pts.push([cx - dir * r * 3.4, by - r * 1.15]);
    pts.push(...loop(cx, by, r * 1.05, r * 0.62, 0.1, -Math.PI / 2 - dir * 0.4, dir * Math.PI * 2.1, 14, 0.22));
    side = side === "R" ? "L" : "R";
    pts.push([side === "R" ? edgeR : edgeL, by + 78]);
  }

  return { d: smooth(pts), w: W, h: H, bw, orb: occ };
}

/** Polygon covering the half of the orb above the loop's tilted axis (the back of the loop). */
function backHalf(o: Occluder): string {
  const ux = Math.cos(o.tilt);
  const uy = Math.sin(o.tilt);
  const nx = Math.sin(o.tilt); // normal pointing up the screen
  const ny = -Math.cos(o.tilt);
  const k = o.R * 2.2;
  const ax = o.cx - ux * k;
  const ay = o.ly - uy * k;
  const bx = o.cx + ux * k;
  const by = o.ly + uy * k;
  return [
    [ax, ay],
    [bx, by],
    [bx + nx * k, by + ny * k],
    [ax + nx * k, ay + ny * k],
  ]
    .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
    .join(" ");
}

export function ScrollBand() {
  const svgRef = useRef<SVGSVGElement>(null);
  const maskRef = useRef<SVGPathElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const meas = useRef<{ L: number; cum: Float32Array; N: number; reduced: boolean } | null>(null);
  // Drawn share of the ribbon, kept across rebuilds so a layout change never restarts the draw.
  const drawn = useRef(0);

  // Build the path from the layout, and rebuild when the layout changes.
  useEffect(() => {
    const root = svgRef.current?.closest("[data-band-root]") as HTMLElement | null;
    if (!root) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const g = build(root);
        // Skip rebuilds that change nothing (the layout shifts by a pixel when live numbers update).
        setGeo((prev) => (prev && g && prev.d === g.d && prev.w === g.w && prev.h === g.h ? prev : g));
      }, 120);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(root);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  // Sample the path: cum[i] = the lowest y reached by the first i/N of its length.
  useLayoutEffect(() => {
    const p = maskRef.current;
    if (!geo || !p) return;
    const L = p.getTotalLength();
    const N = 700;
    const cum = new Float32Array(N + 1);
    let m = -Infinity;
    for (let i = 0; i <= N; i++) {
      m = Math.max(m, p.getPointAtLength((L * i) / N).y);
      cum[i] = m;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    meas.current = { L, cum, N, reduced };
    p.style.strokeDasharray = `${L} ${L}`;
    p.style.strokeDashoffset = reduced ? "0" : `${L * (1 - drawn.current)}`;
  }, [geo]);

  // Follow the scroll. One loop for the component's lifetime; it reads the latest measurement.
  useEffect(() => {
    let raf = 0;
    let lastSet = -1;
    let frames = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const m = meas.current;
      const p = maskRef.current;
      const svg = svgRef.current;
      if (!m || !p || !svg || m.reduced || document.hidden) return;
      const targetY = -svg.getBoundingClientRect().top + window.innerHeight * 0.75;
      // largest i with cum[i] <= targetY
      let lo = 0;
      let hi = m.N;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (m.cum[mid] <= targetY) lo = mid;
        else hi = mid - 1;
      }
      const target = lo / m.N;
      frames++;
      const k = frames < 90 ? 0.035 : 0.1; // slower on first load, so the hero loop draws in
      drawn.current += (target - drawn.current) * k;
      const off = m.L * (1 - drawn.current);
      if (Math.abs(off - lastSet) > 0.5) {
        lastSet = off;
        p.style.strokeDashoffset = `${off}`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 z-[45] opacity-60 md:opacity-100"
      width={geo?.w ?? 0}
      height={geo?.h ?? 0}
      viewBox={geo ? `0 0 ${geo.w} ${geo.h}` : undefined}
      fill="none"
    >
      {geo && (
        <>
          <defs>
            <mask id="band-drawn" maskUnits="userSpaceOnUse" x="0" y="0" width={geo.w} height={geo.h}>
              <path ref={maskRef} d={geo.d} stroke="#fff" strokeWidth={geo.bw + 14} strokeLinecap="round" strokeLinejoin="round" />
              {/* The back half of the hero loop passes behind the orb. */}
              {geo.orb && <circle cx={geo.orb.cx} cy={geo.orb.cy} r={geo.orb.R} fill="#000" clipPath="url(#band-orb-back)" />}
            </mask>
            {geo.orb && (
              <clipPath id="band-orb-back">
                <polygon points={backHalf(geo.orb)} />
              </clipPath>
            )}
            <linearGradient id="band-sheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fbf7f1" />
              <stop offset="0.55" stopColor="#efe7dc" />
              <stop offset="1" stopColor="#e2d6c7" />
            </linearGradient>
          </defs>
          <g mask="url(#band-drawn)">
            {/* shadow, cream ribbon, a red centre stripe and a flowing highlight on it */}
            <path d={geo.d} transform="translate(0 9)" stroke="rgb(0 0 0 / 0.45)" strokeWidth={geo.bw} strokeLinecap="round" strokeLinejoin="round" />
            <path d={geo.d} stroke="url(#band-sheen)" strokeWidth={geo.bw} strokeLinecap="round" strokeLinejoin="round" />
            <path d={geo.d} stroke="#f2452b" strokeWidth={geo.bw * 0.3} strokeLinecap="round" strokeLinejoin="round" />
            <path className="band-flow" d={geo.d} stroke="#ffd2c4" strokeWidth={Math.max(1.5, geo.bw * 0.1)} strokeLinecap="round" strokeDasharray="36 140" />
          </g>
        </>
      )}
    </svg>
  );
}
