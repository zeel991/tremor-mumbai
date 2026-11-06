"use client";

import { deployment, WINDOW_KEYS, type Deployment, type WindowKey } from "@/lib/deployment";
import { errMsg, pipsToPct, varianceToVol } from "@/lib/format";
import { epochRows, useProtocolLogs, useProtocolState, WEEK, type ProtocolLogs } from "@/lib/protocol";
import type { WindowView } from "@/lib/chainReads";
import { Chip, CopyButton, Empty, ErrorNote, fmtDayShort, fmtDuration, fmtSpan, fmtToken, fmtUsdCompact, fmtWhen, Kpi, MoreLink, PageHeader, Panel, Skeleton } from "./kit";

export function windowName(key: WindowKey, w?: WindowView): string {
  if (key === "live") return "This week";
  return w ? `Week of ${fmtDayShort(w.t0, true)}` : key;
}

export function OverviewView() {
  const d = deployment as Deployment;
  const state = useProtocolState();
  const logs = useProtocolLogs();
  const s = state.data;
  const L = logs.data;

  if (state.error) {
    return <ErrorNote title="Can't reach the local fork">{errMsg(state.error)}. Start Anvil and redeploy, then reload this page.</ErrorNote>;
  }

  const now = s?.head.timestamp;
  const epoch = now !== undefined && now >= d.epochOrigin ? (now - d.epochOrigin) / WEEK : undefined;
  const pips = s?.pips.ok ? Number(s.pips.value) : undefined;
  const charging = s && s.validUntil.ok && now !== undefined ? now <= s.validUntil.value && (pips ?? 0) > 0 : undefined;

  const held = s?.holdings ?? [];
  const coverValue = held.reduce((a, h) => a + (h.value && h.value.kind !== "none" && !h.window?.finalized ? h.value.weth : 0n), 0n);
  const coverLong = held.reduce((a, h) => a + (h.window && !h.window.finalized ? (h.longHeld ?? 0n) : 0n), 0n);
  const openPositions = held.filter((h) => h.window && !h.window.finalized && (h.longHeld ?? 0n) > 0n).length;

  const claimed = L?.claimed.ok ? L.claimed.value.reduce((a, l) => a + l.args.wethOut, 0n) : undefined;
  const dripped = L?.dripped.ok ? L.dripped.value.reduce((a, l) => a + l.args.amount, 0n) : undefined;
  const pending = claimed !== undefined && dripped !== undefined ? claimed - dripped : undefined;

  const live = held.find((h) => h.key === "live")?.window;
  const liveVol = s?.liveVProj.ok ? varianceToVol(s.liveVProj.value) : undefined;
  const capVol = live ? varianceToVol(live.vCap) : undefined;

  return (
    <>
      <PageHeader
        title="Overview"
        sub="Tremor's UNI/WETH pool: what arbitrage cost, the fee charged for it, the cover it bought and what LPs got back."
        right={epoch !== undefined && <Chip>Week of {fmtDayShort(d.epochOrigin + epoch * WEEK, true)}</Chip>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Hook fee now"
          loading={!s}
          accent={!!charging}
          value={pips !== undefined ? pipsToPct(pips) : "—"}
          sub={charging ? `Charging until ${fmtWhen(s!.validUntil.ok ? s!.validUntil.value : 0n)}` : "Not charging: no fresh measurement"}
          info="Set once a week from last week's measured arbitrage loss divided by volume, halved and capped at 0.30%. Without a fresh report the fee drops to zero."
        />
        <Kpi
          label="Cover held"
          loading={!s}
          value={fmtToken(coverValue, "WETH")}
          sub={openPositions ? `${fmtToken(coverLong)} LONG in ${openPositions} open ${openPositions === 1 ? "week" : "weeks"}` : "No open cover"}
          info="LONG claims the hook bought with its fees, valued at the pricing curve's bid. Settled weeks are counted under Paid to LPs instead."
        />
        <Kpi
          label="Paid to LPs"
          loading={!L}
          value={fmtToken(dripped, "WETH")}
          sub={pending && pending > 0n ? `${fmtToken(pending, "WETH")} still dripping` : claimed ? "All payouts donated" : "No payouts yet"}
          info="WETH from settled cover, donated to the pool's in-range LPs in slices over a few hundred blocks."
        />
        <Kpi
          label="This week settles in"
          loading={!s}
          value={live && now !== undefined ? (now < live.t1 ? fmtDuration(live.t1 - now) : "Ready") : "—"}
          sub={liveVol !== undefined && capVol !== undefined ? `Projected volatility ${Math.round(liveVol * 100)}% · cap ${Math.round(capVol * 100)}%` : undefined}
          info="The live week settles from every Chainlink UNI/ETH update inside it. LONG pays in full if realized volatility reaches the cap."
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Panel title="Arbitrage loss vs fee charged" info="Each closed week: the measured loss as a share of volume, and the fee the hook charged the following week. The fee is half the loss rate, capped at 0.30%.">
          <LossChart logs={L} loading={logs.isLoading} />
        </Panel>

        <Panel title="Cover positions" pad={false} action={<MoreLink href="/app/trade">Trade</MoreLink>}>
          {!s ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {WINDOW_KEYS.map((k) => {
                const h = held.find((x) => x.key === k);
                if (!h?.window) return null;
                const w = h.window;
                return (
                  <li key={k} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[14px] font-medium">
                        {windowName(k, w)}
                        {w.finalized ? <Chip tone="done">Settled</Chip> : k === "live" ? <Chip tone="live">Open</Chip> : <Chip>Replay</Chip>}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-ink-3">{fmtSpan(w.t0, w.t1)}</div>
                    </div>
                    <div className="num text-right">
                      <div className="text-[14px]">{(h.longHeld ?? 0n) > 0n ? fmtToken(h.longHeld, "LONG") : <span className="text-ink-3">None held</span>}</div>
                      <div className="mt-0.5 text-[12.5px] text-ink-3">
                        {h.value?.kind === "settled" ? `Paid ${fmtToken(h.value.weth, "WETH")}` : h.value?.kind === "estimate" ? `≈ ${fmtToken(h.value.weth, "WETH")}` : w.finalized ? `LONG paid ${fmtToken(w.payoutLong, "WETH")} each` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" title="Activity" pad={false} action={<MoreLink href="/app/contracts">All events and contracts</MoreLink>}>
        <Activity d={d} logs={L} loading={logs.isLoading} error={logs.error} />
      </Panel>
    </>
  );
}

/* ---- loss vs fee chart ------------------------------------------------------------------ */

function LossChart({ logs, loading }: { logs?: ProtocolLogs; loading: boolean }) {
  const rows = epochRows(logs).filter((r) => r.volume > 0n);
  if (loading) return <Skeleton className="h-[220px] w-full" />;
  if (rows.length === 0) return <Empty>No weekly measurements yet. They appear once the Chainlink workflow reports.</Empty>;

  const d = deployment as Deployment;
  const data = rows.map((r) => ({
    label: fmtDayShort(d.epochOrigin + r.epoch * WEEK, true),
    loss: (Number(r.lvr) / Number(r.volume)) * 1e4,
    fee: r.closed ? r.closed.pips / 100 : undefined,
    lvr: Number(r.lvr) / 1e18,
  }));
  const max = Math.max(35, ...data.map((x) => x.loss)) * 1.12;
  const H = 210;
  const yOf = (bps: number) => H - (bps / max) * H;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-5 text-[12.5px] text-ink-2">
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-line-2" /> Loss rate (share of volume)</span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-signal" /> Fee set for the next week</span>
        <span className="flex items-center gap-2"><i className="h-px w-4 border-t border-dashed border-ink-3" /> 0.30% cap</span>
      </div>
      <div className="relative" style={{ height: H + 44 }}>
        <div className="absolute inset-x-0 border-t border-dashed border-ink-3/60" style={{ top: yOf(30) }}>
          <span className="absolute -top-2.5 left-0 bg-surface pr-2 font-mono text-[11px] text-ink-3">0.30% cap</span>
        </div>
        <div className="absolute inset-x-0 top-0 flex items-end justify-around gap-6" style={{ height: H }}>
          {data.map((x) => (
            <div key={x.label} className="flex h-full max-w-[140px] flex-1 items-end justify-center gap-2">
              <Bar value={x.loss} max={max} H={H} cls="bg-line-2" text={`${(x.loss / 100).toFixed(2)}%`} />
              {x.fee !== undefined ? <Bar value={x.fee} max={max} H={H} cls="bg-signal" text={`${(x.fee / 100).toFixed(2)}%`} /> : <div className="w-full max-w-[44px] pb-1 text-center text-[11px] text-ink-3">open</div>}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 flex justify-around gap-6 border-t border-line pt-2.5" style={{ top: H }}>
          {data.map((x) => (
            <div key={x.label} className="max-w-[140px] flex-1 text-center">
              <div className="text-[12.5px] text-ink-2">{x.label}</div>
              <div className="num text-[11.5px] text-ink-3">{fmtUsdCompact(x.lvr)} lost</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({ value, max, H, cls, text }: { value: number; max: number; H: number; cls: string; text: string }) {
  const h = Math.max(3, (value / max) * H);
  return (
    <div className="flex w-full max-w-[44px] flex-col items-center justify-end">
      <span className="num mb-1.5 text-[11.5px] text-ink-2">{text}</span>
      <div className={`w-full rounded-t-md ${cls}`} style={{ height: h }} />
    </div>
  );
}

/* ---- activity --------------------------------------------------------------------------- */

type Item = { key: string; block: bigint; idx: number; tx?: string; title: string; sub?: string; tone: "fee" | "cover" | "pay" | "measure" };

function Activity({ d, logs, loading, error }: { d: Deployment; logs?: ProtocolLogs; loading: boolean; error: unknown }) {
  if (error) return <div className="p-5 text-[13.5px] text-loss">Couldn&apos;t read events: {errMsg(error)}</div>;
  if (loading || !logs)
    return (
      <div className="space-y-3 p-5">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );

  const nameOf = (id: bigint) => {
    const k = WINDOW_KEYS.find((x) => d.windows[x] === id);
    return k === "live" ? "this week" : k === "oct2025" ? "the week of 6 Oct 2025" : k === "feb2025" ? "the week of 24 Feb 2025" : `window ${id}`;
  };
  const items: Item[] = [];
  const base = (l: { blockNumber: bigint | null; logIndex: number | null; transactionHash: string | null }) => ({
    block: l.blockNumber ?? 0n,
    idx: l.logIndex ?? 0,
    tx: l.transactionHash ?? undefined,
    key: `${l.transactionHash}-${l.logIndex}`,
  });
  if (logs.premium.ok) for (const l of logs.premium.value) items.push({ ...base(l), tone: "fee", title: `Hook fee set to ${pipsToPct(l.args.pips)}`, sub: `Valid until ${fmtWhen(l.args.validUntil)}` });
  if (logs.closed.ok)
    for (const l of logs.closed.value)
      items.push({
        ...base(l),
        tone: "measure",
        title: `Week of ${fmtDayShort(d.epochOrigin + l.args.epoch * WEEK, true)} measured`,
        sub: `${fmtUsdCompact(Number(l.args.lvrUsdWad) / 1e18)} arbitrage loss on ${fmtUsdCompact(Number(l.args.volumeUsdWad) / 1e18)} volume`,
      });
  if (logs.bought.ok) for (const l of logs.bought.value) items.push({ ...base(l), tone: "cover", title: `Bought ${fmtToken(l.args.longOut, "LONG")} for ${fmtToken(l.args.wethIn, "WETH")}`, sub: `Cover on ${nameOf(l.args.windowId)}` });
  if (logs.claimed.ok) for (const l of logs.claimed.value) items.push({ ...base(l), tone: "pay", title: `Cover paid out ${fmtToken(l.args.wethOut, "WETH")}`, sub: `From ${nameOf(l.args.windowId)}` });
  if (logs.dripped.ok) for (const l of logs.dripped.value) items.push({ ...base(l), tone: "pay", title: `Donated ${fmtToken(l.args.amount, "WETH")} to LPs`, sub: l.args.remaining > 0n ? `${fmtToken(l.args.remaining, "WETH")} left to donate` : "Payout fully donated" });

  items.sort((a, b) => (a.block === b.block ? b.idx - a.idx : a.block < b.block ? 1 : -1));
  if (items.length === 0) return <div className="p-5"><Empty>No activity yet.</Empty></div>;

  const dot = { fee: "bg-signal", cover: "bg-fees", pay: "bg-[#6fd29b]", measure: "bg-ink-3" } as const;
  return (
    <ul className="divide-y divide-line">
      {items.slice(0, 10).map((it) => (
        <li key={it.key} className="flex items-center gap-4 px-5 py-3.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot[it.tone]}`} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px]">{it.title}</div>
            {it.sub && <div className="text-[12.5px] text-ink-3">{it.sub}</div>}
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-[12.5px] text-ink-2">{logs.stamps.get(it.block) ? fmtWhen(logs.stamps.get(it.block)!) : `Block ${it.block}`}</div>
            {it.tx && <CopyButton value={it.tx} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
