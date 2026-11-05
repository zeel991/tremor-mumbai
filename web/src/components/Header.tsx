"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { forkChain, RPC_URL } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { useWalletOnFork } from "@/lib/walletGuard";

const NAV = [
  { href: "/lp", label: "LP" },
  { href: "/trade", label: "Trade cover" },
  { href: "/data", label: "Data" },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-[17px] font-bold tracking-tight">Tremor</span>
          <span className="hidden text-[12px] text-ink-3 sm:inline">hook-funded variance cover for Uniswap LPs</span>
        </Link>
        <nav className="flex gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-1.5 text-[14px] ${path === n.href ? "bg-[#ecece8] font-semibold" : "text-ink-2 hover:bg-[#f2f2ee]"}`}
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
          className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-[#f2f2ee] disabled:opacity-50"
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
      <button className="rounded-md border border-line px-2 py-1 hover:bg-[#f2f2ee]" onClick={() => disconnect.mutate({})}>
        Disconnect
      </button>
    </div>
  );
}
