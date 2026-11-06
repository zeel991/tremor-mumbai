import Link from "next/link";
import type { ReactNode } from "react";
import { deployment, deploymentStatus } from "@/lib/deployment";
import { Code, Notice } from "./ui";

/** Renders children only when contracts/deployments/fork.json was synced; otherwise explains why not. */
export function DeploymentGate({ children }: { children: ReactNode }) {
  if (!deployment) {
    return (
      <Notice title="Contracts not deployed yet: no deployment file">
        <p>
          This view reads live contract state, and <Code>{deploymentStatus.path}</Code> was{" "}
          {deploymentStatus.status === "missing" ? "not found" : `unreadable (${deploymentStatus.problems.join("; ")})`} when the app was synced.
        </p>
        <p className="mt-2">
          Once the fork deployment has written it, run <Code>npm run sync</Code> in <Code>web/</Code> (or restart <Code>npm run dev</Code>). The{" "}
          <Link className="underline" href="/app/data">
            Data view
          </Link>{" "}
          works without it.
        </p>
      </Notice>
    );
  }
  return (
    <>
      {deploymentStatus.problems.length > 0 && (
        <div className="mb-4">
          <Notice title={`${deploymentStatus.path} has problems`}>
            <ul className="list-disc pl-5">
              {deploymentStatus.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      {children}
    </>
  );
}
