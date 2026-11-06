import { DeploymentGate } from "@/components/DeploymentGate";
import { TradeView } from "@/components/TradeView";

export const metadata = { title: "Trade cover · Tremor" };

export default function TradePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Trade variance claims</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          LONG pays more the more UNI/ETH moves during the window; SHORT pays the rest. Prices come from the vault&apos;s strategy on the 1inch Aqua registry.
        </p>
      </div>
      <DeploymentGate>
        <TradeView />
      </DeploymentGate>
    </div>
  );
}
