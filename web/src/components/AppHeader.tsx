"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { forkChain, RPC_URL } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { useWalletOnFork } from "@/lib/walletGuard";
import { Wordmark } from "./Mark";

const NAV = [
  { href: "/app/lp", label: "LP" },
  { href: "/app/trade", label: "Trade cover" },
  { href: "/app/data", label: "Data" },
];

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Wordmark />
        <nav className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-1.5 text-[14px] transition-colors ${path === n.href ? "bg-hover font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <Wallet />
        </div>
      </div>
    </header>
  );
}

function Wallet() {
  const { address, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const guard = useWalletOnFork();

  if (status !== "connected" || !address) {
    const injected = connectors[0];
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <span className="hidden text-ink-3 md:inline">read-only via {RPC_URL}</span>
        <button
          className="btn-primary disabled:opacity-50"
          disabled={!injected || connect.isPending}
          onClick={() => injected && connect.mutate({ connector: injected })}
        >
          {connect.isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {connect.error && <span className="text-loss">{connect.error.message.split("\n")[0]}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[13px]">
      {guard.state === "wrong-chain" && (
        <button className="rounded-md border border-warn-line bg-warn-bg px-2 py-1" onClick={() => switchChain.mutate({ chainId: forkChain.id })}>
          Wallet on chain {guard.chainId}: switch to 1
        </button>
      )}
      {guard.state === "not-fork" && (
        <span className="rounded-md border border-warn-line bg-warn-bg px-2 py-1" title={guard.detail}>
          Wallet RPC is not the local fork
        </span>
      )}
      {guard.state === "ok" && <span className="text-ink-3">wallet on local fork</span>}
      <span className="font-mono">{shortAddr(address)}</span>
      <button className="rounded-md border border-line px-2 py-1 hover:bg-hover" onClick={() => disconnect.mutate({})}>
        Disconnect
      </button>
    </div>
  );
}
