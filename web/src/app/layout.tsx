import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { abis } from "@/lib/abis";
import { RPC_URL } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Tremor",
  description: "Measured arbitrage loss, a capped Uniswap v4 hook fee, and variance cover sold through 1inch Aqua.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const handWritten = Object.entries(abis).filter(([, v]) => !v.fromArtifact).map(([k]) => k);
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-[12px] text-ink-3">
            Local anvil fork of Ethereum mainnet (chain id 1) at {RPC_URL}. ABIs from Foundry artifacts
            {handWritten.length ? `; hand-written fragments for: ${handWritten.join(", ")}` : " for every contract"}.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
