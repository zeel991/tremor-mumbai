"use client";

import { useConnectors } from "wagmi";

/**
 * Wallets to offer. Browsers with several wallet extensions announce each one (EIP-6963), and wagmi turns
 * them into their own connectors; the generic "injected" connector only reaches whichever wallet owns
 * window.ethereum. Offer the announced wallets when there are any, else the generic one.
 */
export function useWalletChoices() {
  const connectors = useConnectors();
  const announced = connectors.filter((c) => c.id !== "injected");
  return announced.length > 0 ? announced : connectors.slice(0, 1);
}
