"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { forkChain, IS_FORK, NETWORK_LABEL, RPC_URL } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { useHeadBlock } from "@/lib/protocol";
import { useWalletOnFork } from "@/lib/walletGuard";
import { Wordmark } from "./Mark";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/trade", label: "Trade" },
  { href: "/app/stress", label: "Stress test" },
  { href: "/app/data", label: "Data" },
  { href: "/app/contracts", label: "Contracts" },
];

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Wordmark />
        <nav className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
          {NAV.map((n) => {
            const active = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-md px-3 py-1.5 text-[14px] transition-colors ${active ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
              >
                {n.label}
                {active && <span className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-signal max-md:hidden" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Network />
          <Wallet />
        </div>
      </div>
    </header>
  );
}

/** One quiet indicator instead of developer footers: are we reading the fork, and at what block. */
function Network() {
  const head = useHeadBlock();
  const ok = head.data !== undefined && !head.error;
  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 sm:inline-flex"
      title={ok ? `Reading ${IS_FORK ? "a local fork of Ethereum mainnet" : "Sepolia"} at ${RPC_URL}` : `${RPC_URL} is not responding`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-[#6fd29b]" : "bg-loss"}`} />
      {ok ? (
        <>
          {NETWORK_LABEL} <span className="num text-ink-3">#{head.data!.toLocaleString("en-US")}</span>
        </>
      ) : head.isLoading ? (
        "Connecting…"
      ) : (
        IS_FORK ? "Fork offline" : "RPC offline"
      )}
    </span>
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
      <button className="btn-primary" disabled={!injected || connect.isPending} onClick={() => injected && connect.mutate({ connector: injected })} title={connect.error?.message.split("\n")[0]}>
        {connect.isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[13px]">
      {guard.state === "wrong-chain" && (
        <button className="rounded-lg border border-warn-line bg-warn-bg px-3 py-1.5 text-[#f0c36d]" onClick={() => switchChain.mutate({ chainId: forkChain.id })}>
          Switch network
        </button>
      )}
      {guard.state === "not-fork" && (
        <span className="rounded-lg border border-warn-line bg-warn-bg px-3 py-1.5 text-[#f0c36d]" title={guard.detail}>
          Wrong RPC
        </span>
      )}
      <button
        className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 font-mono hover:bg-hover"
        onClick={() => disconnect.mutate({})}
        title="Disconnect"
      >
        <span className="h-4 w-4 rounded-full bg-gradient-to-br from-signal to-[#6ea8ff]" />
        {shortAddr(address)}
      </button>
    </div>
  );
}
