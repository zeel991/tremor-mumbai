import { DeploymentGate } from "@/components/DeploymentGate";
import { ContractsView } from "@/components/app/ContractsView";

export const metadata = { title: "Contracts · Tremor" };

export default function ContractsPage() {
  return (
    <DeploymentGate>
      <ContractsView />
    </DeploymentGate>
  );
}
