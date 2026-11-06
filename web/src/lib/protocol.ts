"use client";

import { useQuery } from "@tanstack/react-query";
import { abis, erc20Abi, erc6909Abi } from "@/lib/abis";
import { eventLogs, read, settled, Side, type DecodedLog, type WindowView } from "@/lib/chainReads";
import { deployment, WINDOW_KEYS, type Deployment, type WindowKey } from "@/lib/deployment";
import { errMsg } from "@/lib/format";
import { publicClient } from "@/lib/wagmi";

/** Protocol state and event history shared by the Overview and Contracts pages. */

export const WEEK = 604_800n;

export type Holding = {
  key: WindowKey;
  id: bigint;
  window?: WindowView;
  longHeld?: bigint;
  value?: { kind: "settled" | "estimate"; weth: bigint } | { kind: "none"; reason: string };
  error?: string;
};

async function loadState(d: Deployment) {
  const head = await publicClient.getBlock();
  const [pips, validUntil, lastBlock, fee0, fee1, wethHeld, liveVProj] = await Promise.allSettled([
    read<number | bigint>(d.hook, abis.hook.abi, "premiumPips"),
    read<bigint>(d.hook, abis.hook.abi, "premiumValidUntil"),
    read<bigint>(d.receiver, abis.receiver.abi, "lastProcessedBlock"),
    read<bigint>(d.poolManager, erc6909Abi, "balanceOf", [d.hook, BigInt(d.poolKey.currency0)]),
    read<bigint>(d.poolManager, erc6909Abi, "balanceOf", [d.hook, BigInt(d.poolKey.currency1)]),
    read<bigint>(d.weth, erc20Abi, "balanceOf", [d.hook]),
    read<bigint>(d.market, abis.market.abi, "projectedVariance", [d.windows.live]),
  ]);

  const holdings: Holding[] = await Promise.all(
    WINDOW_KEYS.map(async (key): Promise<Holding> => {
      const id = d.windows[key];
      try {
        const w = await read<WindowView>(d.market, abis.market.abi, "window", [id]);
        const longHeld = await read<bigint>(w.long, erc20Abi, "balanceOf", [d.hook]);
        if (longHeld === 0n) return { key, id, window: w, longHeld, value: { kind: "none", reason: "nothing held" } };
        // Settled value is exact: payoutLong is WETH wei per whole LONG token.
        if (w.finalized) return { key, id, window: w, longHeld, value: { kind: "settled", weth: (longHeld * w.payoutLong) / 10n ** 18n } };
        try {
          // Mark: what the pricing curve would pay for this size at zero inventory skew. Not an executable price.
          const [, out] = await read<[bigint, bigint]>(d.market, abis.market.abi, "quote", [id, Side.LONG, false, true, longHeld, 0n]);
          return { key, id, window: w, longHeld, value: { kind: "estimate", weth: out } };
        } catch (e) {
          return { key, id, window: w, longHeld, value: { kind: "none", reason: errMsg(e) } };
        }
      } catch (e) {
        return { key, id, error: errMsg(e) };
      }
    }),
  );

  return {
    head: { number: head.number, timestamp: head.timestamp },
    pips: settled(pips),
    validUntil: settled(validUntil),
    lastBlock: settled(lastBlock),
    fee0: settled(fee0),
    fee1: settled(fee1),
    wethHeld: settled(wethHeld),
    liveVProj: settled(liveVProj),
    holdings,
  };
}

export type Measured = { fromBlock: bigint; toBlock: bigint; lvrUsdWad: bigint; volumeUsdWad: bigint; nSwaps: number; epoch: bigint };
export type EpochClosed = { epoch: bigint; lvrUsdWad: bigint; volumeUsdWad: bigint; pips: number };
export type PremiumSet = { pips: number; validUntil: bigint };
export type CoverBought = { windowId: bigint; wethIn: bigint; longOut: bigint };
export type PayoutClaimed = { windowId: bigint; wethOut: bigint };
export type Dripped = { amount: bigint; remaining: bigint };

async function loadLogs(d: Deployment) {
  const from = d.forkBlock + 1n;
  const [measured, closed, premium, bought, claimed, dripped] = await Promise.allSettled([
    eventLogs<Measured>(d.receiver, abis.receiver.abi, "Measured", from),
    eventLogs<EpochClosed>(d.receiver, abis.receiver.abi, "EpochClosed", from),
    eventLogs<PremiumSet>(d.hook, abis.hook.abi, "PremiumSet", from),
    eventLogs<CoverBought>(d.hook, abis.hook.abi, "CoverBought", from),
    eventLogs<PayoutClaimed>(d.hook, abis.hook.abi, "PayoutClaimed", from),
    eventLogs<Dripped>(d.hook, abis.hook.abi, "Dripped", from),
  ]);

  // Block timestamps for the activity feed (few unique blocks on a fork).
  const all = [measured, closed, premium, bought, claimed, dripped].flatMap((r) => (r.status === "fulfilled" ? (r.value as DecodedLog<unknown>[]) : []));
  const blocks = [...new Set(all.map((l) => l.blockNumber).filter((b): b is bigint => b !== null && b !== undefined))];
  const stamps = new Map<bigint, bigint>();
  await Promise.all(
    blocks.map(async (b) => {
      const blk = await publicClient.getBlock({ blockNumber: b }).catch(() => null);
      if (blk) stamps.set(b, blk.timestamp);
    }),
  );

  return {
    measured: settled(measured),
    closed: settled(closed),
    premium: settled(premium),
    bought: settled(bought),
    claimed: settled(claimed),
    dripped: settled(dripped),
    stamps,
  };
}

export type ProtocolState = Awaited<ReturnType<typeof loadState>>;
export type ProtocolLogs = Awaited<ReturnType<typeof loadLogs>>;

export function useProtocolState() {
  const d = deployment as Deployment;
  return useQuery({ queryKey: ["protocol-state", d.hook], queryFn: () => loadState(d), refetchInterval: 8_000 });
}

export function useProtocolLogs() {
  const d = deployment as Deployment;
  return useQuery({ queryKey: ["protocol-logs", d.hook, d.receiver], queryFn: () => loadLogs(d), refetchInterval: 15_000 });
}

export function useHeadBlock() {
  return useQuery({ queryKey: ["head-block"], queryFn: () => publicClient.getBlockNumber(), refetchInterval: 6_000, retry: 0 });
}

/** Epoch rows: Measured reports summed per epoch, with the EpochClosed values when the epoch closed. */
export function epochRows(logs?: ProtocolLogs) {
  type Row = { epoch: bigint; reports: number; swaps: number; lvr: bigint; volume: bigint; closed?: EpochClosed };
  const rows = new Map<bigint, Row>();
  if (logs?.measured.ok) {
    for (const { args: a } of logs.measured.value) {
      const r = rows.get(a.epoch) ?? { epoch: a.epoch, reports: 0, swaps: 0, lvr: 0n, volume: 0n };
      r.reports += 1;
      r.swaps += Number(a.nSwaps);
      r.lvr += a.lvrUsdWad;
      r.volume += a.volumeUsdWad;
      rows.set(a.epoch, r);
    }
  }
  if (logs?.closed.ok) {
    for (const { args: a } of logs.closed.value) {
      const r = rows.get(a.epoch) ?? { epoch: a.epoch, reports: 0, swaps: 0, lvr: 0n, volume: 0n };
      r.closed = a;
      rows.set(a.epoch, r);
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, lvr: r.closed ? r.closed.lvrUsdWad : r.lvr, volume: r.closed ? r.closed.volumeUsdWad : r.volume }))
    .sort((a, b) => (a.epoch < b.epoch ? -1 : 1));
}
