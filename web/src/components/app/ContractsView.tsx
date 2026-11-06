"use client";

import { abis } from "@/lib/abis";
import { RPC_URL } from "@/lib/chain";
import { deployment, WINDOW_KEYS, type Deployment } from "@/lib/deployment";
import { errMsg, pipsToPct, varianceToVol } from "@/lib/format";
import { epochRows, useProtocolLogs, useProtocolState, WEEK } from "@/lib/protocol";
import { windowName } from "./OverviewView";
import { CopyButton, Empty, ErrorNote, fmtDayShort, fmtSpan, fmtToken, fmtUsdCompact, PageHeader, Panel, Skeleton } from "./kit";

const WAD = 10n ** 18n;

export function ContractsView() {
  const d = deployment as Deployment;
  const state = useProtocolState();
  const logs = useProtocolLogs();
  const s = state.data;
  const rows = epochRows(logs.data).slice().reverse();

  const contracts: { name: string; role: string; addr: string }[] = [
    { name: "TremorHook", role: "Uniswap v4 hook: charges the fee, buys cover, donates payouts", addr: d.hook },
    { name: "TremorReceiver", role: "Takes Chainlink CRE reports and sets the weekly fee", addr: d.receiver },
    { name: "VarianceMarket", role: "Weekly LONG/SHORT claims, settled from Chainlink rounds", addr: d.market },
    { name: "TremorVault", role: "Writes cover and ships it as one 1inch Aqua strategy", addr: d.vault },
    { name: "TremorAquaSwapVMRouter", role: "SwapVM router with the CappedPayoffCurve instruction 0x22", addr: d.router },
    { name: "Aqua", role: "1inch Aqua registry (deployed mainnet contract)", addr: d.aqua },
    { name: "PoolManager", role: "Uniswap v4 PoolManager (deployed mainnet contract)", addr: d.poolManager },
    { name: "WETH", role: "Collateral and payout token", addr: d.weth },
    { name: "UNI", role: "Pool token", addr: d.uni },
  ];
  const handWritten = Object.entries(abis).filter(([, v]) => !v.fromArtifact).map(([k]) => k);

  return (
    <>
      <PageHeader title="Contracts & method" sub="Addresses, raw measurements and the formulas behind every number in the app." />

      {state.error && (
        <div className="mb-4">
          <ErrorNote title="Can't reach the local fork">{errMsg(state.error)}</ErrorNote>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Deployed contracts" pad={false}>
          <ul className="divide-y divide-line">
            {contracts.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium">{c.name}</div>
                  <div className="text-[12.5px] text-ink-3">{c.role}</div>
                </div>
                <CopyButton value={c.addr} />
              </li>
            ))}
            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
              <div>
                <div className="text-[14px] font-medium">Pool ID</div>
                <div className="text-[12.5px] text-ink-3">UNI/WETH, 0.30% LP fee, tick spacing {d.poolKey.tickSpacing}</div>
              </div>
              <CopyButton value={d.poolId} />
            </li>
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel title="Network">
            <dl className="num space-y-2 text-[13.5px]">
              <Row k="Chain" v="Local fork of Ethereum mainnet (id 1)" />
              <Row k="RPC" v={RPC_URL} />
              <Row k="Forked at block" v={d.forkBlock.toLocaleString("en-US")} />
              <Row k="Current block" v={s ? s.head.number.toLocaleString("en-US") : "…"} />
              <Row k="CRE measured up to" v={s?.lastBlock.ok ? `block ${s.lastBlock.value.toLocaleString("en-US")}` : "…"} />
            </dl>
          </Panel>
          <Panel title="Hook balances">
            <dl className="num space-y-2 text-[13.5px]">
              <Row k="Unconverted fees, UNI" v={s?.fee0.ok ? fmtToken(s.fee0.value, "UNI") : "…"} />
              <Row k="Unconverted fees, WETH" v={s?.fee1.ok ? fmtToken(s.fee1.value, "WETH") : "…"} />
              <Row k="WETH held" v={s?.wethHeld.ok ? fmtToken(s.wethHeld.value, "WETH") : "…"} />
            </dl>
            <p className="mt-3 text-[12.5px] text-ink-3">Fees sit in the PoolManager as ERC-6909 claims until handleHookFees converts them to WETH and buys cover.</p>
          </Panel>
        </div>
      </div>

      <Panel className="mt-4" title="Weekly measurements" pad={false}>
        {logs.isLoading ? (
          <div className="p-5"><Skeleton className="h-24 w-full" /></div>
        ) : rows.length === 0 ? (
          <div className="p-5"><Empty>No Chainlink CRE reports yet.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[760px] text-[13.5px]">
              <thead className="text-left text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Week of</th>
                  <th className="px-3 py-2.5 text-right font-medium">Reports</th>
                  <th className="px-3 py-2.5 text-right font-medium">Swaps</th>
                  <th className="px-3 py-2.5 text-right font-medium">Volume</th>
                  <th className="px-3 py-2.5 text-right font-medium">Arbitrage loss</th>
                  <th className="px-3 py-2.5 text-right font-medium">Loss / volume</th>
                  <th className="px-5 py-2.5 text-right font-medium">Fee set at close</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.epoch.toString()} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">{fmtDayShort(d.epochOrigin + r.epoch * WEEK, true)}</td>
                    <td className="px-3 py-2.5 text-right">{r.reports}</td>
                    <td className="px-3 py-2.5 text-right">{r.swaps.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2.5 text-right">{fmtUsdCompact(Number(r.volume) / 1e18)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtUsdCompact(Number(r.lvr) / 1e18)}</td>
                    <td className="px-3 py-2.5 text-right">{r.volume > 0n ? `${((Number(r.lvr) / Number(r.volume)) * 100).toFixed(2)}%` : "—"}</td>
                    <td className="px-5 py-2.5 text-right">{r.closed ? pipsToPct(r.closed.pips) : <span className="text-ink-3">Open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="mt-4" title="Collateral by week" pad={false}>
        {!s ? (
          <div className="p-5"><Skeleton className="h-24 w-full" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[760px] text-[13.5px]">
              <thead className="text-left text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Week</th>
                  <th className="px-3 py-2.5 text-right font-medium">Max payout</th>
                  <th className="px-3 py-2.5 text-right font-medium">Volatility cap</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pairs outstanding</th>
                  <th className="px-3 py-2.5 text-right font-medium">WETH locked</th>
                  <th className="px-5 py-2.5 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {WINDOW_KEYS.map((k) => {
                  const w = s.holdings.find((h) => h.key === k)?.window;
                  if (!w) return null;
                  return (
                    <tr key={k} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5">
                        {windowName(k, w)} <span className="text-ink-3">· {fmtSpan(w.t0, w.t1)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmtToken(w.S, "WETH")}</td>
                      <td className="px-3 py-2.5 text-right">{Math.round(varianceToVol(w.vCap) * 100)}%</td>
                      <td className="px-3 py-2.5 text-right">{fmtToken(w.setsOutstanding)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtToken((w.setsOutstanding * w.S) / WAD, "WETH")}</td>
                      <td className="px-5 py-2.5 text-right">{w.finalized ? `LONG paid ${((Number(w.payoutLong) / Number(w.S)) * 100).toFixed(1)}%` : <span className="text-ink-3">Open</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="mt-4" title="Method">
        <div className="grid gap-6 text-[13.5px] leading-relaxed text-ink-2 md:grid-cols-2">
          <Method title="Arbitrage loss">
            A Chainlink CRE workflow values every swap in the reference UNI/WETH 0.30% pool at Binance one-minute prices. Loss = LP fees minus the LPs&apos; markout, summed per week from Monday {fmtDayShort(d.epochOrigin, true)}.
          </Method>
          <Method title="Hook fee">
            fee = min(0.30%, 0.5 × last week&apos;s loss ÷ volume). It is valid for one week plus a grace period; after that the hook charges nothing.
          </Method>
          <Method title="Payout">
            LONG pays S × min(V, V<sub>cap</sub>) ÷ V<sub>cap</sub> per token and SHORT pays the rest, where V is the annualized realized variance from every Chainlink UNI/ETH update in the week.
          </Method>
          <Method title="Cover value">
            Open positions are marked at the pricing curve&apos;s bid for the whole size at zero inventory skew. It is an estimate, not an executable price. Settled positions use the exact payout.
          </Method>
        </div>
        <p className="mt-5 border-t border-line pt-4 font-mono text-[11.5px] text-ink-3">
          ABIs from Foundry artifacts{handWritten.length ? `; hand-written fragments for ${handWritten.join(", ")}` : " for every contract"}.
        </p>
      </Panel>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-2">{k}</dt>
      <dd className="truncate text-right">{v}</dd>
    </div>
  );
}

function Method({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-medium text-ink">{title}</div>
      <p>{children}</p>
    </div>
  );
}
