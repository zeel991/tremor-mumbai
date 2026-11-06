"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import StringTune, { StringMagnetic, StringParallax, StringProgress, StringSplit, StringSpotlight } from "@fiddle-digital/string-tune";

/**
 * One StringTune runtime for the whole site (Fiddle Digital, MIT).
 * Elements opt in with data-string="split|magnetic|spotlight|parallax|progress"; the modules write
 * CSS variables that globals.css turns into motion.
 *
 * Smooth scroll runs on the landing page only. The app pages keep native scrolling so tables,
 * inputs and selects behave normally. Reduced motion turns smooth scroll off everywhere.
 */
let started = false;

export function StringTuneRuntime() {
  const path = usePathname();

  useEffect(() => {
    const st = StringTune.getInstance();
    if (!started) {
      st.use(StringSplit);
      st.use(StringProgress);
      st.use(StringParallax);
      st.use(StringMagnetic);
      st.use(StringSpotlight, { lerp: 0.15 });
      started = true;
      st.scrollMobileMode = "default";
      st.speed = 0.1;
      st.speedAccelerate = 0.45;
      st.start(60);
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    st.scrollDesktopMode = path === "/" && !reduced ? "smooth" : "default";
    // New route, new DOM: rebuild every object's geometry.
    const t = setTimeout(() => st.onResize(true), 60);
    return () => clearTimeout(t);
  }, [path]);

  return null;
}
