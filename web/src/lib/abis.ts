import type { Abi } from "viem";
import generated from "@/generated/abis.json";
import * as fb from "./fallbackAbis";

type Entry = { source: string; abi: Abi } | null;
const gen = generated as unknown as Record<string, Entry>;

export type AbiInfo = { abi: Abi; source: string; fromArtifact: boolean };

function pick(name: string, fallback: Abi): AbiInfo {
  const g = gen[name];
  return g ? { abi: g.abi, source: g.source, fromArtifact: true } : { abi: fallback, source: "hand-written fragment (src/lib/fallbackAbis.ts)", fromArtifact: false };
}

export const abis = {
  market: pick("VarianceMarket", fb.marketAbi),
  vault: pick("TremorVault", fb.vaultAbi),
  hook: pick("TremorHook", fb.hookAbi),
  receiver: pick("TremorReceiver", fb.receiverAbi),
  router: pick("TremorAquaSwapVMRouter", fb.routerAbi),
  claimToken: pick("ClaimToken", fb.erc20Abi),
} as const;

const errorsOf = (abi: Abi) => abi.filter((x) => x.type === "error");

/** Router ABI plus every error we know about, so reverts bubbled up from the market decode by name. */
export const routerAbiWithErrors: Abi = [
  ...abis.router.abi,
  ...errorsOf(abis.market.abi),
  ...errorsOf(fb.routerAbi),
];

export const erc20Abi = fb.erc20Abi;
export const erc6909Abi = fb.erc6909Abi;

export function hasFunction(abi: Abi, name: string): boolean {
  return abi.some((x) => x.type === "function" && x.name === name);
}
