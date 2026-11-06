import { DeploymentGate } from "@/components/DeploymentGate";
import { OverviewView } from "@/components/app/OverviewView";

export const metadata = { title: "Overview · Tremor" };

export default function OverviewPage() {
  return (
    <DeploymentGate>
      <OverviewView />
    </DeploymentGate>
  );
}
