"use client";

import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { abis, routerAbiWithErrors } from "@/lib/abis";
import { eventLogs, read } from "@/lib/chainReads";
import { deployment, type Deployment } from "@/lib/deployment";
import { fmtWad, pipsToPct } from "@/lib/format";
import { IS_FORK, NETWORK_LONG } from "@/lib/chain";
import { decodeOrder } from "@/lib/order";
import { quoteTraits } from "@/lib/takerTraits";
import { publicClient } from "@/lib/wagmi";

const ONE = 10n ** 18n;

async function load(d: Deployment) {
  const block = await publicClient.getBlockNumber();
  const [pips, dripped, quote] = await Promise.allSettled([
    read<number | bigint>(d.hook, abis.hook.abi, "premiumPips"),
    eventLogs<{ amount: bigint }>(d.hook, abis.hook.abi, "Dripped", BigInt(d.forkBlock)).then((ls) => ls.reduce((a, l) => a + l.args.amount, 0n)),
    (async () => {
      const id = d.windows.live;
      const enc = await read<Hex>(d.vault, abis.vault.abi, "currentOrderEncoded", [id]);
      const w = await read<{ long: `0x${string}` }>(d.market, abis.market.abi, "window", [id]);
      const res = (await publicClient.readContract({
        address: d.router,
        abi: routerAbiWithErrors,
        functionName: "quote",
        args: [decodeOrder(enc), d.weth, w.long, ONE, quoteTraits()],
      })) as readonly [bigint, bigint, Hex];
      return res[1];
    })(),
  ]);
  return {
    block,
    pips: pips.status === "fulfilled" ? Number(pips.value) : undefined,
    dripped: dripped.status === "fulfilled" ? dripped.value : undefined,
    longPerWeth: quote.status === "fulfilled" ? quote.value : undefined,
  };
}

/** Three numbers read from the local mainnet fork, so the hero shows the product working. */
export function LiveStrip() {
  const d = deployment;
  const q = useQuery({ queryKey: ["landing-live", d?.hook], enabled: !!d, queryFn: () => load(d!), refetchInterval: 10_000, retry: 0 });

  if (!d || q.isError) {
    return (
      <p className="text-[13px] text-ink-3">
        Live numbers appear here when {IS_FORK ? "the local mainnet fork is running" : "Sepolia is reachable"}. <span className="text-ink-2">The app shows how to start it.</span>
      </p>
    );
  }

  const v = q.data;
  const items = [
    { label: "Hook fee this week", value: v?.pips !== undefined ? pipsToPct(v.pips) : undefined },
    { label: "Paid back to LPs", value: v?.dripped !== undefined ? `${fmtWad(v.dripped, 3)} WETH` : undefined },
    { label: "Cover price, 1 WETH buys", value: v?.longPerWeth !== undefined ? `${fmtWad(v.longPerWeth, 2)} LONG` : undefined },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="bg-page/85 px-5 py-4 backdrop-blur-md">
            <div className="text-[12px] text-ink-3">{it.label}</div>
            <div className="num mt-1 text-[22px] font-medium tracking-tight">{it.value ?? <span className="text-ink-3">…</span>}</div>
          </div>
        ))}
      </div>
      <p className="mt-2.5 font-mono text-[11.5px] text-ink-3">
        Read from {NETWORK_LONG}{v ? ` at block ${v.block.toLocaleString("en-US")}` : ""}, against the deployed Uniswap v4, 1inch Aqua and Chainlink contracts.
      </p>
    </div>
  );
}
