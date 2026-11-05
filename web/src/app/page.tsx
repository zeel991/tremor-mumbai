import Link from "next/link";
import { Card, Code } from "@/components/ui";
import { deployment, deploymentStatus } from "@/lib/deployment";
import { summary } from "@/lib/dataset";
import { fmtPct } from "@/lib/format";

const STEPS = [
  { n: "1", t: "Measure", d: "Chainlink CRE values every swap of the pool at exchange prices and reports last window's arbitrage loss on-chain." },
  { n: "2", t: "Charge", d: "A Uniswap v4 hook charges a capped fee sized from that measurement." },
  { n: "3", t: "Cover", d: "The fee buys LONG claims on realized UNI/ETH variance from a 1inch Aqua strategy, settled from Chainlink rounds and donated back to LPs." },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
          In UNI/WETH, arbitrage took {fmtPct(summary.exOutlier.arbShare, 0)} of LP fees over two years. Tremor measures that loss, charges a hook fee for it, and spends the fee on variance cover for LPs.
        </h1>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-lg border border-line bg-surface p-5">
            <div className="text-[12px] font-semibold text-ink-3">{s.n}</div>
            <div className="mt-1 text-[15px] font-semibold">{s.t}</div>
            <p className="mt-1 text-[13.5px] text-ink-2">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Go href="/lp" title="LP view" text="Measured loss per epoch, the premium, cover held, payouts." />
        <Go href="/trade" title="Trade cover" text="Quote and swap LONG or SHORT through the Aqua strategy." />
        <Go href="/data" title="Data" text="The 104-week UNI/WETH measurement and the premium backtest." />
      </div>
      <Card title="Deployment">
        {deployment ? (
          <p className="text-[13.5px] text-ink-2">
            Loaded <Code>{deploymentStatus.path}</Code>: market <Code>{deployment.market}</Code>, fork block {deployment.forkBlock.toString()}.
            {deploymentStatus.problems.length > 0 && <span className="text-loss"> Problems: {deploymentStatus.problems.join("; ")}.</span>}
          </p>
        ) : (
          <p className="text-[13.5px] text-ink-2">
            Contracts not deployed yet: <Code>{deploymentStatus.path}</Code> not found. The LP and Trade views need it; the Data view does not. After deploying, run{" "}
            <Code>npm run sync</Code> in <Code>web/</Code>.
          </p>
        )}
      </Card>
    </div>
  );
}

function Go({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-line bg-surface p-5 hover:border-ink-3">
      <div className="text-[15px] font-semibold">{title} →</div>
      <p className="mt-1 text-[13.5px] text-ink-2">{text}</p>
    </Link>
  );
}
