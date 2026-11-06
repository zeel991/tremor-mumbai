"use client";

// ThreeUI Community "Energy Orb" (MIT, @designcodeio/threeui), the free variant.
// Its shader rotates hue from a base of 252°, so +116° lands on Tremor's signal red.
import { GlobeCollection } from "@designcodeio/threeui/components/GlobeCollection";
import "@designcodeio/threeui/style.css";

export function HeroOrb({ className = "" }: { className?: string }) {
  return (
    <GlobeCollection
      variant="energy-orb"
      className={className}
      hue={122}
      saturation={1.5}
      glow={1.2}
      speed={0.7}
      smokeSpeed={0.8}
      smokeStrength={1.1}
      scale={1}
      starDensity={0.7}
      starSpeed={0.5}
      brightness={1}
      opacity={1}
    />
  );
}
