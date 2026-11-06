import { defineChain } from "viem";

/**
 * Which deployment the app talks to. Set at build time:
 *   fork    (default) local Anvil fork of Ethereum mainnet at http://127.0.0.1:8545
 *   sepolia Sepolia testnet (contracts/deployments/sepolia.json)
 */
export type Network = "fork" | "sepolia";
export const NETWORK: Network = process.env.NEXT_PUBLIC_TREMOR_NETWORK === "sepolia" ? "sepolia" : "fork";
export const IS_FORK = NETWORK === "fork";

const DEFAULT_RPC = IS_FORK ? "http://127.0.0.1:8545" : "https://ethereum-sepolia-rpc.publicnode.com";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT_RPC;

/** Block explorer for transaction links (none for the local fork). */
export const EXPLORER: string | null = IS_FORK ? null : "https://sepolia.etherscan.io";

export const NETWORK_LABEL = IS_FORK ? "Mainnet fork" : "Sepolia";
/** The pair whose realized volatility the live window settles on. */
export const SETTLEMENT_PAIR = IS_FORK ? "UNI/ETH" : "ETH/USD";

export const NETWORK_LONG = IS_FORK ? "a local fork of Ethereum mainnet" : "the Sepolia testnet";

/** The one chain the app uses (named forkChain for history; it is Sepolia when NETWORK is sepolia). */
export const forkChain = IS_FORK
  ? defineChain({
      id: 1,
      name: "Anvil fork of Ethereum mainnet (local)",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
      contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 14353601 } },
    })
  : defineChain({
      id: 11_155_111,
      name: "Sepolia",
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
      blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
      contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 751532 } },
      testnet: true,
    });

export const txUrl = (hash: string) => (EXPLORER ? `${EXPLORER}/tx/${hash}` : null);
export const addrUrl = (a: string) => (EXPLORER ? `${EXPLORER}/address/${a}` : null);
