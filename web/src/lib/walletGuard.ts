"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection, useWalletClient } from "wagmi";
import type { EIP1193RequestFn, Hex } from "viem";
import { publicClient } from "./wagmi";
import { forkChain, IS_FORK } from "./chain";

export type WalletFork = { state: "none" } | { state: "checking" } | { state: "ok" } | { state: "wrong-chain"; chainId: number } | { state: "not-fork"; detail: string };

/**
 * Chain id 1 is also real mainnet. Before letting the wallet sign, check that the wallet's RPC
 * sees the same chain as the local fork: its latest block must exist locally with the same hash.
 * Otherwise a "swap" could be broadcast to real Ethereum.
 */
export function useWalletOnFork(): WalletFork {
  const { address, chainId, status } = useConnection();
  const { data: walletClient } = useWalletClient();
  const q = useQuery({
    queryKey: ["wallet-fork", address, chainId, !!walletClient],
    // On a public chain the chain id is enough; the block-hash check only guards the local fork.
    enabled: IS_FORK && status === "connected" && !!walletClient && chainId === forkChain.id,
    refetchInterval: 15_000,
    queryFn: async (): Promise<WalletFork> => {
      const request = walletClient!.request as unknown as EIP1193RequestFn;
      const blk = (await request({ method: "eth_getBlockByNumber", params: ["latest", false] } as never)) as { number: Hex; hash: Hex } | null;
      if (!blk) return { state: "not-fork", detail: "wallet returned no latest block" };
      const n = BigInt(blk.number);
      const local = await publicClient.getBlock({ blockNumber: n }).catch(() => null);
      if (!local) return { state: "not-fork", detail: `wallet is at block ${n}, which the local fork does not have` };
      if (local.hash !== blk.hash) return { state: "not-fork", detail: `block ${n} hash differs between wallet and local fork` };
      return { state: "ok" };
    },
  });
  if (status !== "connected") return { state: "none" };
  if (chainId !== forkChain.id) return { state: "wrong-chain", chainId: chainId ?? 0 };
  if (!IS_FORK) return { state: "ok" };
  if (q.data) return q.data;
  if (q.error) return { state: "not-fork", detail: String((q.error as Error).message ?? q.error) };
  return { state: "checking" };
}
