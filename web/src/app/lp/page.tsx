import { DeploymentGate } from "@/components/DeploymentGate";
import { LpView } from "@/components/LpView";

export const metadata = { title: "LP · Tremor" };

export default function LpPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">For LPs in the Tremor UNI/WETH pool</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          What arbitrage cost last epoch, the hook fee charged for it, the variance cover that fee bought, and what has been paid back to LPs.
        </p>
      </div>
      <DeploymentGate>
        <LpView />
      </DeploymentGate>
    </div>
  );
}
