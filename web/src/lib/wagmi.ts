import { createConfig, http, injected } from "wagmi";
import { createPublicClient, http as viemHttp } from "viem";
import { forkChain, RPC_URL } from "./chain";

// wagmi only knows chain 1 with the local RPC as its transport: reads never leave 127.0.0.1.
export const wagmiConfig = createConfig({
  chains: [forkChain],
  connectors: [injected()],
  // forkChain is one chain per build (fork or Sepolia); its type is the union of both ids.
  transports: { [forkChain.id]: http(RPC_URL) } as unknown as Record<1 | 11_155_111, ReturnType<typeof http>>,
  ssr: true,
});

/** Read-only client, works with no wallet at all. */
export const publicClient = createPublicClient({ chain: forkChain, transport: viemHttp(RPC_URL) });
