"use client";

import { useQuery } from "@tanstack/react-query";
import { abis, erc20Abi, erc6909Abi } from "@/lib/abis";
import { eventLogs, read, settled, Side, type DecodedLog, type WindowView } from "@/lib/chainReads";
import { deployment, WINDOW_KEYS, WINDOW_LABELS, type Deployment, type WindowKey } from "@/lib/deployment";
import { errMsg, fmtDate, fmtDay, fmtUsdWad, fmtWad, pipsToPct } from "@/lib/format";
import { publicClient } from "@/lib/wagmi";
import { Card, Mono, Notice, Stat, Tag } from "./ui";

const WEEK = 604_800n;

type HoldingRow = {
  key: WindowKey;
  id: bigint;
  window?: WindowView;
  longHeld?: bigint;
  value?: { kind: "settled" | "estimate"; weth: bigint } | { kind: "none"; reason: string };
  error?: string;
};

async function loadState(d: Deployment) {
  const head = await publicClient.getBlock();
  const [pips, validUntil, lastBlock, fee0, fee1, wethHeld] = await Promise.allSettled([
    read<number | bigint>(d.hook, abis.hook.abi, "premiumPips"),
    read<bigint>(d.hook, abis.hook.abi, "premiumValidUntil"),
    read<bigint>(d.receiver, abis.receiver.abi, "lastProcessedBlock"),
    read<bigint>(d.poolManager, erc6909Abi, "balanceOf", [d.hook, BigInt(d.poolKey.currency0)]),
    read<bigint>(d.poolManager, erc6909Abi, "balanceOf", [d.hook, BigInt(d.poolKey.currency1)]),
    read<bigint>(d.weth, erc20Abi, "balanceOf", [d.hook]),
  ]);

  const holdings: HoldingRow[] = await Promise.all(
    WINDOW_KEYS.map(async (key): Promise<HoldingRow> => {
      const id = d.windows[key];
      try {
        const w = await read<WindowView>(d.market, abis.market.abi, "window", [id]);
        const longHeld = await read<bigint>(w.long, erc20Abi, "balanceOf", [d.hook]);
        if (longHeld === 0n) return { key, id, window: w, longHeld, value: { kind: "none", reason: "nothing held" } };
        if (w.finalized) {
          // settled payout is exact: payoutLong is WETH wei per whole LONG token (spec §6.2)
          return { key, id, window: w, longHeld, value: { kind: "settled", weth: (longHeld * w.payoutLong) / 10n ** 18n } };
        }
        try {
          // Mark = what the market's pricing would pay for selling this size back, at zero inventory skew.
          // It is NOT an executable price (the live strategy has its own skew and inventory limits).
          const [, out] = await read<[bigint, bigint]>(d.market, abis.market.abi, "quote", [id, Side.LONG, false, true, longHeld, 0n]);
          return { key, id, window: w, longHeld, value: { kind: "estimate", weth: out } };
        } catch (e) {
          return { key, id, window: w, longHeld, value: { kind: "none", reason: errMsg(e) } };
        }
      } catch (e) {
        return { key, id, error: errMsg(e) };
      }
    }),
  );

  return {
    head: { number: head.number, timestamp: head.timestamp },
    pips: settled(pips),
    validUntil: settled(validUntil),
    lastBlock: settled(lastBlock),
    fee0: settled(fee0),
    fee1: settled(fee1),
    wethHeld: settled(wethHeld),
    holdings,
  };
}

type Measured = { fromBlock: bigint; toBlock: bigint; lvrUsdWad: bigint; volumeUsdWad: bigint; nSwaps: number; epoch: bigint };
type EpochClosed = { epoch: bigint; lvrUsdWad: bigint; volumeUsdWad: bigint; pips: number };
type PremiumSet = { pips: number; validUntil: bigint };
type PayoutClaimed = { windowId: bigint; wethOut: bigint };
type Dripped = { amount: bigint; remaining: bigint };

async function loadLogs(d: Deployment) {
  const from = d.forkBlock + 1n;
  const [measured, closed, premium, claimed, dripped] = await Promise.allSettled([
    eventLogs<Measured>(d.receiver, abis.receiver.abi, "Measured", from),
    eventLogs<EpochClosed>(d.receiver, abis.receiver.abi, "EpochClosed", from),
    eventLogs<PremiumSet>(d.hook, abis.hook.abi, "PremiumSet", from),
    eventLogs<PayoutClaimed>(d.hook, abis.hook.abi, "PayoutClaimed", from),
    eventLogs<Dripped>(d.hook, abis.hook.abi, "Dripped", from),
  ]);
  return { measured: settled(measured), closed: settled(closed), premium: settled(premium), claimed: settled(claimed), dripped: settled(dripped) };
}

export function LpView() {
  const d = deployment as Deployment; // rendered only inside <DeploymentGate>
  const state = useQuery({ queryKey: ["lp-state", d.hook], queryFn: () => loadState(d), refetchInterval: 8_000 });
  const logs = useQuery({ queryKey: ["lp-logs", d.hook, d.receiver], queryFn: () => loadLogs(d), refetchInterval: 15_000 });

  if (state.error) {
    return <Notice title="Cannot read the local fork" tone="error">{errMsg(state.error)}</Notice>;
  }

  const s = state.data;
  const nowTs = s?.head.timestamp;
  const epochNow = nowTs !== undefined && nowTs >= d.epochOrigin ? (nowTs - d.epochOrigin) / WEEK : undefined;
  const premiumActive = s && s.pips.ok && s.validUntil.ok && nowTs !== undefined ? nowTs <= s.validUntil.value : undefined;

  return (
    <div className="space-y-5">
      <Card
        title="Hook fee this epoch"
        subtitle="Set by TremorReceiver from last epoch's measured arbitrage loss (premium = K · LVR / volume, capped). The hook charges 0 once the premium is stale."
      >
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat
            label="Premium"
            value={s ? (s.pips.ok ? pipsToPct(s.pips.value) : "—") : "…"}
            note={s?.pips.ok ? `${Number(s.pips.value).toLocaleString()} pips` : s && !s.pips.ok ? s.pips.error : undefined}
          />
          <Stat
            label="Charging now"
            value={premiumActive === undefined ? "…" : premiumActive ? "Yes" : "No (stale → 0)"}
            note={s?.validUntil.ok ? `valid until ${fmtDate(s.validUntil.value)}` : undefined}
          />
          <Stat label="Epoch (chain time)" value={epochNow !== undefined ? `#${epochNow}` : "…"} note={nowTs !== undefined ? `block time ${fmtDate(nowTs)}` : undefined} />
          <Stat
            label="CRE measured up to block"
            value={s ? (s.lastBlock.ok ? s.lastBlock.value.toLocaleString() : "—") : "…"}
            note={s?.lastBlock.ok ? "TremorReceiver.lastProcessedBlock (reference v3 pool)" : s && !s.lastBlock.ok ? s.lastBlock.error : undefined}
          />
        </div>
      </Card>

      <EpochTable d={d} logs={logs.data} loading={logs.isLoading} error={logs.error} />

      <Card
        title="Cover held by the hook"
        subtitle="LONG variance claims bought with hook fees (WETH → LONG through the Aqua strategy). Finalized windows show the exact settled value; open windows show a mark from market.quote."
      >
        <div className="grid grid-cols-2 gap-5 border-b border-line pb-4 md:grid-cols-3">
          <Stat
            label="Unconverted hook fees, UNI"
            value={s ? (s.fee0.ok ? fmtWad(s.fee0.value, 4) : "—") : "…"}
            note="ERC-6909 claims in the PoolManager"
          />
          <Stat
            label="Unconverted hook fees, WETH"
            value={s ? (s.fee1.ok ? fmtWad(s.fee1.value, 6) : "—") : "…"}
            note="ERC-6909 claims in the PoolManager"
          />
          <Stat label="WETH held by the hook" value={s ? (s.wethHeld.ok ? fmtWad(s.wethHeld.value, 6) : "—") : "…"} note="payouts not yet dripped, plus unspent fees" />
        </div>
        <table className="num mt-3 w-full text-[13.5px]">
          <thead className="text-left text-[12px] text-ink-2">
            <tr>
              <th className="py-2 font-medium">Window</th>
              <th className="py-2 font-medium">Period</th>
              <th className="py-2 text-right font-medium">LONG held</th>
              <th className="py-2 text-right font-medium">Value (WETH)</th>
            </tr>
          </thead>
          <tbody>
            {(s?.holdings ?? []).map((h) => (
              <tr key={h.key} className="border-t border-line">
                <td className="py-2">
                  {WINDOW_LABELS[h.key]} <span className="text-ink-3">#{h.id.toString()}</span>
                </td>
                <td className="py-2 text-ink-2">{h.window ? `${fmtDay(h.window.t0)} → ${fmtDay(h.window.t1)}` : h.error}</td>
                <td className="py-2 text-right">{h.longHeld !== undefined ? fmtWad(h.longHeld, 4) : "—"}</td>
                <td className="py-2 text-right">
                  {h.value === undefined ? (
                    "—"
                  ) : h.value.kind === "none" ? (
                    <span className="text-ink-3" title={h.value.reason}>
                      {h.longHeld === 0n ? "—" : "no bid"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {fmtWad(h.value.weth, 6)}
                      <Tag tone={h.value.kind === "estimate" ? "estimate" : "measured"}>{h.value.kind === "estimate" ? "estimate" : "settled"}</Tag>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[12px] text-ink-3">
          Estimate = <Mono>market.quote(id, LONG, takerBuys=false, exactIn=true, held, skew=0)</Mono>: the bid the pricing curve gives for the whole position at zero
          inventory skew. It is not an executable price.
        </p>
      </Card>

      <Payouts logs={logs.data} />
    </div>
  );
}

type Logs = Awaited<ReturnType<typeof loadLogs>>;

function EpochTable({ d, logs, loading, error }: { d: Deployment; logs?: Logs; loading: boolean; error: unknown }) {
  if (error) return <Notice title="Could not read events" tone="error">{errMsg(error)}</Notice>;

  type Row = { epoch: bigint; reports: number; swaps: number; lvr: bigint; volume: bigint; firstBlock: bigint; lastBlock: bigint; closed?: EpochClosed };
  const rows = new Map<bigint, Row>();
  if (logs?.measured.ok) {
    for (const l of logs.measured.value as DecodedLog<Measured>[]) {
      const a = l.args;
      const r = rows.get(a.epoch) ?? { epoch: a.epoch, reports: 0, swaps: 0, lvr: 0n, volume: 0n, firstBlock: a.fromBlock, lastBlock: a.toBlock };
      r.reports += 1;
      r.swaps += Number(a.nSwaps);
      r.lvr += a.lvrUsdWad;
      r.volume += a.volumeUsdWad;
      if (a.fromBlock < r.firstBlock) r.firstBlock = a.fromBlock;
      if (a.toBlock > r.lastBlock) r.lastBlock = a.toBlock;
      rows.set(a.epoch, r);
    }
  }
  if (logs?.closed.ok) {
    for (const l of logs.closed.value as DecodedLog<EpochClosed>[]) {
      const a = l.args;
      const r = rows.get(a.epoch) ?? { epoch: a.epoch, reports: 0, swaps: 0, lvr: 0n, volume: 0n, firstBlock: 0n, lastBlock: 0n };
      r.closed = a;
      rows.set(a.epoch, r);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => (a.epoch < b.epoch ? 1 : -1));

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Measured arbitrage loss per epoch <Tag tone="measured">measured</Tag>
        </span>
      }
      subtitle="From TremorReceiver events. Chainlink CRE values every swap of the reference UNI/WETH pool at Binance 1-minute prices; LVR = LP fees − LP markout, in USD. An epoch is one week from Mon 2024-11-04 00:00 UTC."
    >
      {loading && <p className="text-[13px] text-ink-3">Loading events…</p>}
      {logs && !logs.measured.ok && <p className="text-[13px] text-loss">Measured: {logs.measured.error}</p>}
      {logs && !logs.closed.ok && <p className="text-[13px] text-loss">EpochClosed: {logs.closed.error}</p>}
      {logs && sorted.length === 0 && logs.measured.ok && <p className="text-[13px] text-ink-3">No CRE reports yet.</p>}
      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[720px] text-[13.5px]">
            <thead className="text-left text-[12px] text-ink-2">
              <tr>
                <th className="py-2 font-medium">Epoch</th>
                <th className="py-2 font-medium">Week of (UTC)</th>
                <th className="py-2 text-right font-medium">Reports</th>
                <th className="py-2 text-right font-medium">Swaps</th>
                <th className="py-2 text-right font-medium">Volume</th>
                <th className="py-2 text-right font-medium">Arbitrage loss (LVR)</th>
                <th className="py-2 text-right font-medium">LVR / volume</th>
                <th className="py-2 text-right font-medium">Premium set at close</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const lvr = r.closed ? r.closed.lvrUsdWad : r.lvr;
                const vol = r.closed ? r.closed.volumeUsdWad : r.volume;
                const ratioBps = vol > 0n ? (Number(lvr) / Number(vol)) * 1e4 : undefined;
                return (
                  <tr key={r.epoch.toString()} className="border-t border-line">
                    <td className="py-2">#{r.epoch.toString()}</td>
                    <td className="py-2">{fmtDay(d.epochOrigin + r.epoch * WEEK)}</td>
                    <td className="py-2 text-right">{r.reports}</td>
                    <td className="py-2 text-right">{r.swaps.toLocaleString()}</td>
                    <td className="py-2 text-right">{fmtUsdWad(vol)}</td>
                    <td className={`py-2 text-right ${lvr < 0n ? "text-ink-3" : ""}`}>{fmtUsdWad(lvr)}</td>
                    <td className="py-2 text-right">{ratioBps === undefined ? "—" : `${ratioBps.toFixed(1)} bps`}</td>
                    <td className="py-2 text-right">{r.closed ? `${pipsToPct(r.closed.pips)} (${r.closed.pips} pips)` : <span className="text-ink-3">open</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {logs?.premium.ok && logs.premium.value.length > 0 && (
        <div className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-2">
          <div className="mb-1 font-medium text-ink">Hook PremiumSet events</div>
          <ul className="num space-y-0.5">
            {(logs.premium.value as DecodedLog<PremiumSet>[])
              .slice(-6)
              .reverse()
              .map((l) => (
                <li key={`${l.transactionHash}-${l.logIndex}`}>
                  block {l.blockNumber?.toString()}: {pipsToPct(l.args.pips)} ({l.args.pips} pips), valid until {fmtDate(l.args.validUntil)}
                </li>
              ))}
          </ul>
        </div>
      )}
      {logs && !logs.premium.ok && <p className="mt-2 text-[13px] text-loss">PremiumSet: {logs.premium.error}</p>}
    </Card>
  );
}

function Payouts({ logs }: { logs?: Logs }) {
  const claimed = logs?.claimed.ok ? (logs.claimed.value as DecodedLog<PayoutClaimed>[]) : [];
  const dripped = logs?.dripped.ok ? (logs.dripped.value as DecodedLog<Dripped>[]) : [];
  const totalClaimed = claimed.reduce((a, l) => a + l.args.wethOut, 0n);
  const totalDripped = dripped.reduce((a, l) => a + l.args.amount, 0n);
  const lastRemaining = dripped.length ? dripped[dripped.length - 1].args.remaining : undefined;

  return (
    <Card
      title="Payouts to LPs"
      subtitle="After a window finalizes, the hook redeems its LONG for WETH (PayoutClaimed) and donates it to in-range LPs in slices (Dripped)."
    >
      {logs && !logs.claimed.ok && <p className="text-[13px] text-loss">PayoutClaimed: {logs.claimed.error}</p>}
      {logs && !logs.dripped.ok && <p className="text-[13px] text-loss">Dripped: {logs.dripped.error}</p>}
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="Claimed from settlement" value={logs ? `${fmtWad(totalClaimed, 6)} WETH` : "…"} note={`${claimed.length} PayoutClaimed`} />
        <Stat label="Dripped to LPs" value={logs ? `${fmtWad(totalDripped, 6)} WETH` : "…"} note={`${dripped.length} Dripped (donate)`} />
        <Stat label="Pending" value={logs ? `${fmtWad(totalClaimed - totalDripped, 6)} WETH` : "…"} note="claimed − dripped" tag="derived" />
        <Stat label="Remaining (last Dripped event)" value={lastRemaining !== undefined ? `${fmtWad(lastRemaining, 6)} WETH` : "—"} />
      </div>
      {(claimed.length > 0 || dripped.length > 0) && (
        <ul className="num mt-4 space-y-0.5 border-t border-line pt-3 text-[12.5px] text-ink-2">
          {[
            ...claimed.map((l) => ({ l, text: `PayoutClaimed window #${l.args.windowId}: ${fmtWad(l.args.wethOut, 6)} WETH` })),
            ...dripped.map((l) => ({ l, text: `Dripped ${fmtWad(l.args.amount, 6)} WETH, ${fmtWad(l.args.remaining, 6)} remaining` })),
          ]
            .sort((a, b) => Number((b.l.blockNumber ?? 0n) - (a.l.blockNumber ?? 0n)) || (b.l.logIndex ?? 0) - (a.l.logIndex ?? 0))
            .slice(0, 12)
            .map(({ l, text }) => (
              <li key={`${l.transactionHash}-${l.logIndex}`}>
                block {l.blockNumber?.toString()}: {text}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
