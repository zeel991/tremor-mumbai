import { defineChain } from "viem";

/** The only RPC this app talks to: the local anvil fork of Ethereum mainnet. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";

export const forkChain = defineChain({
  id: 1,
  name: "Anvil fork of Ethereum mainnet (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 14353601 },
  },
});
