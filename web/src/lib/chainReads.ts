import type { Abi, AbiEvent, Address, Log } from "viem";
import { publicClient } from "./wagmi";

export type WindowView = {
  t0: bigint;
  t1: bigint;
  S: bigint;
  vCap: bigint;
  vFwd: bigint;
  phaseId: number;
  lastRound: bigint;
  lastAnswer: bigint;
  lastUpdatedAt: bigint;
  q: bigint;
  setsOutstanding: bigint;
  finalized: boolean;
  payoutLong: bigint;
  long: Address;
  short: Address;
};

export const Side = { LONG: 0, SHORT: 1 } as const;

export function read<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
  return publicClient.readContract({ address, abi, functionName, args, blockNumber }) as Promise<T>;
}

export function findEvent(abi: Abi, name: string): AbiEvent | undefined {
  return abi.find((x): x is AbiEvent => x.type === "event" && x.name === name);
}

export type DecodedLog<A> = Log & { args: A };

/** Logs of one named event from fromBlock to latest. Throws if the ABI has no such event. */
export async function eventLogs<A>(address: Address, abi: Abi, name: string, fromBlock: bigint): Promise<DecodedLog<A>[]> {
  const event = findEvent(abi, name);
  if (!event) throw new Error(`event ${name} not in ABI`);
  const logs = await publicClient.getLogs({ address, event, fromBlock, toBlock: "latest" });
  return logs as unknown as DecodedLog<A>[];
}

export function settled<T>(r: PromiseSettledResult<T>): { ok: true; value: T } | { ok: false; error: string } {
  if (r.status === "fulfilled") return { ok: true, value: r.value };
  const e = r.reason as { shortMessage?: string; message?: string };
  return { ok: false, error: e?.shortMessage ?? e?.message ?? String(r.reason) };
}
