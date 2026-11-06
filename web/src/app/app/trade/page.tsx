import { DeploymentGate } from "@/components/DeploymentGate";
import { TradeView } from "@/components/TradeView";

export const metadata = { title: "Trade · Tremor" };

export default function TradePage() {
  return (
    <DeploymentGate>
      <TradeView />
    </DeploymentGate>
  );
}
