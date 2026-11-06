import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { abis } from "@/lib/abis";
import { RPC_URL } from "@/lib/chain";

export default function AppLayout({ children }: { children: ReactNode }) {
  const handWritten = Object.entries(abis).filter(([, v]) => !v.fromArtifact).map(([k]) => k);
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 font-mono text-[11.5px] text-ink-3">
        Local fork of Ethereum mainnet (chain id 1) at {RPC_URL}. ABIs from Foundry artifacts
        {handWritten.length ? `; hand-written fragments for: ${handWritten.join(", ")}` : " for every contract"}.
      </footer>
    </>
  );
}
