import { getAddress, isAddress, type Address, type Hex } from "viem";
import generated from "@/generated/deployment.json";
import { forkChain } from "./chain";

export type WindowKey = "live" | "oct2025" | "feb2025";
const ALL_WINDOW_KEYS: WindowKey[] = ["live", "oct2025", "feb2025"];
export const WINDOW_LABELS: Record<WindowKey, string> = {
  live: "Live week",
  oct2025: "6 Oct 2025 (demo)",
  feb2025: "24 Feb 2025 (demo)",
};

export type Deployment = {
  chainId: number;
  forkBlock: bigint;
  weth: Address;
  uni: Address;
  aqua: Address;
  poolManager: Address;
  market: Address;
  router: Address;
  vault: Address;
  hook: Address;
  receiver: Address;
  poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
  poolId: Hex;
  windows: Record<WindowKey, bigint>;
  epochOrigin: bigint;
};

type Raw = Record<string, unknown>;
type Generated = { status: "missing" | "invalid" | "incomplete" | "ok"; path: string; problems: string[]; deployment: Raw | null };

const DEFAULT_EPOCH_ORIGIN = 1_730_678_400n; // Mon 2024-11-04 00:00 UTC (spec §6.7)

function addr(v: unknown, key: string, problems: string[]): Address {
  if (typeof v === "string" && isAddress(v, { strict: false })) return getAddress(v);
  problems.push(`"${key}" is not an address`);
  return "0x0000000000000000000000000000000000000000";
}

function big(v: unknown, key: string, problems: string[]): bigint {
  try {
    if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") return BigInt(v);
  } catch {}
  problems.push(`"${key}" is not an integer`);
  return 0n;
}

function parse(raw: Raw): { d: Deployment; problems: string[] } {
  const p: string[] = [];
  const pk = (raw.poolKey ?? {}) as Raw;
  const w = (raw.windows ?? {}) as Raw;
  const d: Deployment = {
    chainId: Number(raw.chainId),
    forkBlock: big(raw.forkBlock, "forkBlock", p),
    weth: addr(raw.weth, "weth", p),
    uni: addr(raw.uni, "uni", p),
    aqua: addr(raw.aqua, "aqua", p),
    poolManager: addr(raw.poolManager, "poolManager", p),
    market: addr(raw.market, "market", p),
    router: addr(raw.router, "router", p),
    vault: addr(raw.vault, "vault", p),
    hook: addr(raw.hook, "hook", p),
    receiver: addr(raw.receiver, "receiver", p),
    poolKey: {
      currency0: addr(pk.currency0, "poolKey.currency0", p),
      currency1: addr(pk.currency1, "poolKey.currency1", p),
      fee: Number(pk.fee),
      tickSpacing: Number(pk.tickSpacing),
      hooks: addr(pk.hooks, "poolKey.hooks", p),
    },
    poolId: (typeof raw.poolId === "string" ? raw.poolId : "0x") as Hex,
    // Only "live" is required: the replay windows exist on the mainnet fork only.
    windows: Object.fromEntries(
      ALL_WINDOW_KEYS.filter((k) => k === "live" || w[k] !== undefined).map((k) => [k, big(w[k], `windows.${k}`, p)]),
    ) as Record<WindowKey, bigint>,
    epochOrigin: raw.epochOrigin === undefined ? DEFAULT_EPOCH_ORIGIN : big(raw.epochOrigin, "epochOrigin", p),
  };
  if (d.chainId !== forkChain.id) p.push(`chainId is ${String(raw.chainId)}, expected ${forkChain.id}`);
  return { d, problems: p };
}

const g = generated as unknown as Generated;
const parsed = g.deployment ? parse(g.deployment) : null;

export const deploymentStatus = {
  status: g.status,
  path: g.path,
  problems: [...g.problems, ...(parsed?.problems ?? [])],
};

/** null when fork.json is missing or unreadable. May be non-null with problems listed above. */
export const deployment: Deployment | null = parsed ? parsed.d : null;

/** Windows present in this deployment, in display order. */
export const WINDOW_KEYS: WindowKey[] = ALL_WINDOW_KEYS.filter((k) => deployment?.windows[k] !== undefined);
