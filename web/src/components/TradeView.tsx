"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hash, type Hex } from "viem";
import { useConnect, useConnection, useConnectors, useSwitchChain, useWalletClient } from "wagmi";
import { abis, erc20Abi, hasFunction, routerAbiWithErrors } from "@/lib/abis";
import { forkChain } from "@/lib/chain";
import { read, settled, type WindowView } from "@/lib/chainReads";
import { deployment, WINDOW_KEYS, type Deployment, type WindowKey } from "@/lib/deployment";
import { errMsg, varianceToVol } from "@/lib/format";
import { decodeOrder, type Order } from "@/lib/order";
import { exactInSwapTraits, minOutWithSlippage, quoteTraits } from "@/lib/takerTraits";
import { publicClient } from "@/lib/wagmi";
import { useWalletOnFork } from "@/lib/walletGuard";
import { Chip, CopyButton, ErrorNote, fmtDuration, fmtSpan, fmtToken, InfoTip, MoreLink, PageHeader, Panel, Skeleton } from "./app/kit";
import { windowName } from "./app/OverviewView";

type SideName = "LONG" | "SHORT";
type Dir = "buy" | "sell";
const WAD = 10n ** 18n;
const SLIPPAGE_BPS = 100n; // 1%

async function loadWindow(d: Deployment, id: bigint) {
  const [w, head] = await Promise.all([read<WindowView>(d.market, abis.market.abi, "window", [id]), publicClient.getBlock()]);
  const lockedP = hasFunction(abis.market.abi, "lockedWeth") ? read<bigint>(d.market, abis.market.abi, "lockedWeth", [id]) : Promise.reject(new Error("market ABI has no lockedWeth"));
  const [vProj, orderEnc, vaultLong, vaultShort, locked] = await Promise.allSettled([
    read<bigint>(d.market, abis.market.abi, "projectedVariance", [id]),
    read<Hex>(d.vault, abis.vault.abi, "currentOrderEncoded", [id]),
    read<bigint>(w.long, erc20Abi, "balanceOf", [d.vault]),
    read<bigint>(w.short, erc20Abi, "balanceOf", [d.vault]),
    lockedP,
  ]);
  let order: { ok: true; value: Order; encoded: Hex } | { ok: false; error: string };
  const enc = settled(orderEnc);
  if (!enc.ok) order = enc;
  else {
    try {
      order = { ok: true, value: decodeOrder(enc.value), encoded: enc.value };
    } catch (e) {
      order = { ok: false, error: `could not decode the strategy order: ${errMsg(e)}` };
    }
  }
  return { w, now: head.timestamp, vProj: settled(vProj), order, vaultLong: settled(vaultLong), vaultShort: settled(vaultShort), locked: settled(locked) };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function parseAmount(s: string): bigint | undefined {
  if (!s.trim()) return undefined;
  try {
    const v = parseUnits(s.trim(), 18);
    return v > 0n ? v : undefined;
  } catch {
    return undefined;
  }
}

type TxEntry = { id: number; label: string; hash?: Hash; status: "signing" | "pending" | "success" | "reverted" | "error"; detail?: string };

export function TradeView() {
  const d = deployment as Deployment; // rendered only inside <DeploymentGate>
  const qc = useQueryClient();
  const { address } = useConnection();
  const { data: walletClient } = useWalletClient();
  const guard = useWalletOnFork();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();

  const [windowKey, setWindowKey] = useState<WindowKey>("live");
  const [side, setSide] = useState<SideName>("LONG");
  const [dir, setDir] = useState<Dir>("buy");
  const [amountStr, setAmountStr] = useState("0.1");
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const txSeq = useRef(0);

  const id = d.windows[windowKey];
  const win = useQuery({ queryKey: ["trade-window", id.toString()], queryFn: () => loadWindow(d, id), refetchInterval: 8_000 });
  const w = win.data?.w;
  const claim: Address | undefined = w ? (side === "LONG" ? w.long : w.short) : undefined;
  const tokenIn = dir === "buy" ? d.weth : claim;
  const tokenOut = dir === "buy" ? claim : d.weth;
  const inSym = dir === "buy" ? "WETH" : side;
  const outSym = dir === "buy" ? side : "WETH";

  const amount = useDebounced(parseAmount(amountStr), 300);
  const order = win.data?.order.ok ? win.data.order : undefined;
  const closed = !!w?.finalized || (win.data !== undefined && !win.data.order.ok);

  const quote = useQuery({
    queryKey: ["trade-quote", id.toString(), tokenIn, tokenOut, amount?.toString(), order?.encoded, address],
    enabled: !!order && !closed && !!tokenIn && !!tokenOut && amount !== undefined,
    refetchInterval: 6_000,
    retry: 0,
    queryFn: async () => {
      const blockNumber = await publicClient.getBlockNumber();
      const res = (await publicClient.readContract({
        address: d.router,
        abi: routerAbiWithErrors,
        functionName: "quote",
        args: [order!.value, tokenIn!, tokenOut!, amount!, quoteTraits(address)],
        account: address,
        blockNumber,
      })) as readonly [bigint, bigint, Hex];
      return { amountIn: res[0], amountOut: res[1], blockNumber, amount: amount! };
    },
  });

  const user = useQuery({
    queryKey: ["trade-user", address, id.toString(), tokenIn],
    enabled: !!address && !!w && !!tokenIn,
    refetchInterval: 8_000,
    queryFn: async () => {
      const [weth, long, short, allowance] = await Promise.all([
        read<bigint>(d.weth, erc20Abi, "balanceOf", [address!]),
        read<bigint>(w!.long, erc20Abi, "balanceOf", [address!]),
        read<bigint>(w!.short, erc20Abi, "balanceOf", [address!]),
        read<bigint>(tokenIn!, erc20Abi, "allowance", [address!, d.router]),
      ]);
      return { weth, long, short, allowance };
    },
  });

  const q = quote.data && amount !== undefined && quote.data.amount === amount ? quote.data : undefined;
  const minOut = q ? minOutWithSlippage(q.amountOut, SLIPPAGE_BPS) : undefined;
  const needsApproval = !!(q && user.data && user.data.allowance < q.amountIn);
  const balanceIn = user.data ? (dir === "buy" ? user.data.weth : side === "LONG" ? user.data.long : user.data.short) : undefined;
  const insufficient = q && balanceIn !== undefined ? balanceIn < q.amountIn : false;

  // Payout per whole token if the week settled at the projected volatility (derived, for orientation).
  const projShare = w ? (w.finalized ? Number(w.payoutLong) / Number(w.S) : win.data?.vProj.ok ? Math.min(1, Number(win.data.vProj.value) / Number(w.vCap)) : undefined) : undefined;
  const sideShare = projShare === undefined ? undefined : side === "LONG" ? projShare : 1 - projShare;

  function pushTx(e: Omit<TxEntry, "id">) {
    const idn = ++txSeq.current;
    setTxs((t) => [{ ...e, id: idn }, ...t].slice(0, 4));
    return idn;
  }
  function patchTx(idn: number, patch: Partial<TxEntry>) {
    setTxs((t) => t.map((x) => (x.id === idn ? { ...x, ...patch } : x)));
  }

  async function send(label: string, run: () => Promise<Hash>) {
    setBusy(true);
    const idn = pushTx({ label, status: "signing" });
    try {
      const hash = await run();
      patchTx(idn, { hash, status: "pending" });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      patchTx(idn, { status: r.status === "success" ? "success" : "reverted" });
    } catch (e) {
      patchTx(idn, { status: "error", detail: errMsg(e) });
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["trade-user"] });
      qc.invalidateQueries({ queryKey: ["trade-window"] });
      qc.invalidateQueries({ queryKey: ["trade-quote"] });
    }
  }

  function approve() {
    if (!q || !tokenIn || !walletClient || !address) return;
    // The taker pays the ROUTER: in Aqua mode SwapVM does safeTransferFrom(taker -> router) then AQUA.push.
    void send(`Approve ${fmtToken(q.amountIn, inSym)}`, () =>
      walletClient.writeContract({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [d.router, q.amountIn], chain: forkChain, account: address }),
    );
  }

  function swap() {
    if (!q || !order || !tokenIn || !tokenOut || !walletClient || !address || minOut === undefined) return;
    const traits = exactInSwapTraits(address, minOut);
    void send(`${dir === "buy" ? "Buy" : "Sell"} ${fmtToken(dir === "buy" ? q.amountOut : q.amountIn, side)}`, async () => {
      const sim = await publicClient.simulateContract({
        address: d.router,
        abi: routerAbiWithErrors,
        functionName: "swap",
        args: [order.value, tokenIn, tokenOut, q.amount, traits],
        account: address,
      });
      return walletClient.writeContract({ ...sim.request, chain: forkChain, account: address });
    });
  }

  // One button, one state.
  let cta: { label: string; onClick?: () => void; disabled: boolean };
  if (closed) cta = { label: w?.finalized ? "This week has settled" : "Trading closed for this week", disabled: true };
  else if (!address) cta = { label: connect.isPending ? "Connecting…" : "Connect wallet", onClick: () => connectors[0] && connect.mutate({ connector: connectors[0] }), disabled: !connectors[0] || connect.isPending };
  else if (guard.state === "wrong-chain") cta = { label: "Switch to the local fork", onClick: () => switchChain.mutate({ chainId: forkChain.id }), disabled: false };
  else if (guard.state === "not-fork") cta = { label: "Wallet isn't on the local fork", disabled: true };
  else if (guard.state === "checking") cta = { label: "Checking network…", disabled: true };
  else if (amount === undefined) cta = { label: "Enter an amount", disabled: true };
  else if (!q) cta = { label: quote.error ? "No quote for this size" : "Getting quote…", disabled: true };
  else if (insufficient) cta = { label: `Not enough ${inSym}`, disabled: true };
  else if (needsApproval) cta = { label: `Approve ${inSym}`, onClick: approve, disabled: busy };
  else cta = { label: busy ? "Confirm in wallet…" : `${dir === "buy" ? "Buy" : "Sell"} ${side}`, onClick: swap, disabled: busy || !user.data };

  const price = q && q.amountOut > 0n && q.amountIn > 0n ? (dir === "buy" ? (q.amountIn * WAD) / q.amountOut : (q.amountOut * WAD) / q.amountIn) : undefined;

  return (
    <>
      <PageHeader title="Trade cover" sub="Buy LONG if you expect UNI/ETH to swing this week, SHORT if you expect it to stay calm. Every claim is fully backed by WETH." />

      {win.error && (
        <div className="mb-4">
          <ErrorNote title="Can't read this week from the fork">{errMsg(win.error)}</ErrorNote>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,480px)_1fr] lg:justify-center xl:grid-cols-[480px_400px]">
        {/* ---- swap card ---- */}
        <section className="rounded-2xl border border-line bg-surface p-2">
          <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-2">
            <div className="flex gap-1 rounded-lg bg-page p-1">
              {(["buy", "sell"] as Dir[]).map((x) => (
                <button key={x} onClick={() => setDir(x)} className={`rounded-md px-4 py-1.5 text-[14px] font-medium transition-colors ${dir === x ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                  {x === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
            <select
              aria-label="Week"
              value={windowKey}
              onChange={(e) => setWindowKey(e.target.value as WindowKey)}
              className="rounded-lg border border-line bg-page px-3 py-1.5 text-[13.5px] text-ink outline-none focus:border-signal"
            >
              {WINDOW_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k === "live" ? "This week" : k === "oct2025" ? "Week of 6 Oct 2025" : "Week of 24 Feb 2025"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 px-1">
            {(["LONG", "SHORT"] as SideName[]).map((x) => (
              <button
                key={x}
                onClick={() => setSide(x)}
                className={`rounded-xl border p-3.5 text-left transition-colors ${side === x ? "border-signal/60 bg-signal/[0.07]" : "border-line hover:border-line-2"}`}
              >
                <div className="text-[14.5px] font-medium">{x}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">{x === "LONG" ? "Pays more if UNI/ETH swings" : "Pays more if UNI/ETH stays calm"}</div>
              </button>
            ))}
          </div>

          <div className="mt-2 rounded-xl bg-page p-4">
            <div className="flex items-center justify-between text-[13px] text-ink-3">
              <label htmlFor="amt">You pay</label>
              {balanceIn !== undefined && (
                <button className="hover:text-ink-2" onClick={() => setAmountStr(formatUnits(balanceIn, 18))}>
                  Balance {fmtToken(balanceIn)} <span className="text-signal-2">Max</span>
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="amt"
                inputMode="decimal"
                autoComplete="off"
                className="num w-full min-w-0 bg-transparent text-[32px] font-medium tracking-tight outline-none placeholder:text-ink-3"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
              />
              <Token sym={inSym} />
            </div>
          </div>

          <div className="relative z-10 -my-3 flex justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border-4 border-surface bg-hover text-ink-2" aria-hidden="true">
              ↓
            </span>
          </div>

          <div className="rounded-xl bg-page p-4">
            <div className="text-[13px] text-ink-3">You receive</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="num min-w-0 flex-1 truncate text-[32px] font-medium tracking-tight">
                {closed ? <span className="text-ink-3">—</span> : q ? fmtToken(q.amountOut) : quote.isFetching ? <Skeleton className="h-8 w-40" /> : <span className="text-ink-3">0</span>}
              </div>
              <Token sym={outSym} />
            </div>
          </div>

          {q && !closed && (
            <dl className="num space-y-2 px-3 pb-1 pt-4 text-[13.5px]">
              <Row k={`Price per ${side}`} v={price !== undefined ? fmtToken(price, "WETH") : "—"} />
              <Row k="Minimum received" v={minOut !== undefined ? fmtToken(minOut, outSym) : "—"} info="The swap reverts if it would return less than this: the quote minus 1% slippage." />
              {dir === "buy" && sideShare !== undefined && w && (
                <Row
                  k="Payout at projected volatility"
                  v={fmtToken((q.amountOut * BigInt(Math.round(sideShare * 1e6)) * w.S) / 10n ** 6n / WAD, "WETH")}
                  info={`What these ${side} tokens would pay if the week settled at today's projected volatility. An estimate, not a promise: the real payout depends on every Chainlink update until the week ends.`}
                />
              )}
            </dl>
          )}
          {quote.error && !closed && <p className="px-3 pt-3 text-[13px] text-loss">The strategy can&apos;t fill this size. Try a smaller amount.</p>}

          <div className="p-1 pt-4">
            <button className="btn-primary w-full py-3.5 text-[15.5px]" disabled={cta.disabled} onClick={cta.onClick}>
              {cta.label}
            </button>
            {!address && !closed && <p className="mt-2.5 text-center text-[12.5px] text-ink-3">Quotes work without a wallet.</p>}
            {guard.state === "not-fork" && <p className="mt-2.5 text-center text-[12.5px] text-ink-3">Point your wallet&apos;s chain-1 RPC at http://127.0.0.1:8545 so nothing reaches real mainnet.</p>}
          </div>

          {txs.length > 0 && (
            <ul className="mx-1 mb-1 mt-3 space-y-1.5 border-t border-line pt-3">
              {txs.map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${t.status === "success" ? "bg-[#6fd29b]" : t.status === "signing" || t.status === "pending" ? "animate-pulse bg-ink-3" : "bg-loss"}`} />
                  <span className="flex-1 truncate">
                    {t.label}
                    <span className="text-ink-3"> · {t.status === "signing" ? "confirm in wallet" : t.status}</span>
                  </span>
                  {t.hash && <CopyButton value={t.hash} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- week details ---- */}
        <aside className="space-y-4">
          <Panel
            title={w ? windowName(windowKey, w) : "Week"}
            action={w ? w.finalized ? <Chip tone="done">Settled</Chip> : windowKey === "live" ? <Chip tone="live">Open</Chip> : <Chip>Replay</Chip> : undefined}
          >
            {!w || !win.data ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              <WeekDetails w={w} data={win.data} />
            )}
          </Panel>
          <div className="px-1">
            <MoreLink href="/app/contracts">Contracts, collateral and pricing method</MoreLink>
          </div>
        </aside>
      </div>
    </>
  );
}

type WinData = Awaited<ReturnType<typeof loadWindow>>;

function WeekDetails({ w, data }: { w: WindowView; data: WinData }) {
  const capVol = varianceToVol(w.vCap);
  const vol = w.finalized ? undefined : data.vProj.ok ? varianceToVol(data.vProj.value) : undefined;
  const longShare = w.finalized ? Number(w.payoutLong) / Number(w.S) : data.vProj.ok ? Math.min(1, Number(data.vProj.value) / Number(w.vCap)) : undefined;
  const locked = data.locked.ok ? data.locked.value : (w.setsOutstanding * w.S) / WAD;

  return (
    <div className="space-y-5 text-[13.5px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink-2">{fmtSpan(w.t0, w.t1)}</span>
        <span className="text-ink-3">{w.finalized ? "Settled" : data.now < w.t1 ? `Settles in ${fmtDuration(w.t1 - data.now)}` : "Ready to settle"}</span>
      </div>

      {vol !== undefined && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-ink-2">
              Projected volatility
              <InfoTip>Realized volatility from the Chainlink updates so far this week, blended with the writer&apos;s forecast for the rest. Used for pricing.</InfoTip>
            </span>
            <span className="num">
              {Math.round(vol * 100)}% <span className="text-ink-3">/ {Math.round(capVol * 100)}% cap</span>
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-signal" style={{ width: `${Math.min(100, (vol / capVol) * 100)}%` }} />
          </div>
        </div>
      )}

      {longShare !== undefined && (
        <div className="grid grid-cols-2 gap-3">
          <Split label={w.finalized ? "LONG paid" : "LONG would pay"} share={longShare} S={w.S} hot />
          <Split label={w.finalized ? "SHORT paid" : "SHORT would pay"} share={1 - longShare} S={w.S} />
        </div>
      )}

      <dl className="num space-y-2 border-t border-line pt-4">
        <Row k="Max payout per token" v={fmtToken(w.S, "WETH")} info="LONG pays this in full if realized volatility reaches the cap. LONG and SHORT together always pay exactly this." />
        <Row k="LONG available" v={data.vaultLong.ok ? fmtToken(data.vaultLong.value) : "—"} />
        <Row k="SHORT available" v={data.vaultShort.ok ? fmtToken(data.vaultShort.value) : "—"} />
        <Row k="WETH backing" v={fmtToken(locked, "WETH")} info="Each LONG and SHORT pair is backed by exactly the max payout in WETH, locked in the market contract, so every claim can always be paid." />
      </dl>
    </div>
  );
}

function Split({ label, share, S, hot = false }: { label: string; share: number; S: bigint; hot?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-page p-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={`num mt-1 text-[20px] font-medium ${hot ? "text-signal" : ""}`}>{Math.round(share * 1000) / 10}%</div>
      <div className="num text-[12px] text-ink-3">{fmtToken((S * BigInt(Math.round(share * 1e6))) / 10n ** 6n, "WETH")} each</div>
    </div>
  );
}

function Row({ k, v, info }: { k: string; v: string; info?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-ink-2">
        {k}
        {info && <InfoTip>{info}</InfoTip>}
      </dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

function Token({ sym }: { sym: string }) {
  const color = sym === "WETH" ? "bg-[#6ea8ff]" : sym === "LONG" ? "bg-signal" : "bg-ink-3";
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-line-2 bg-surface py-1.5 pl-1.5 pr-3 text-[14px] font-medium">
      <span className={`h-5 w-5 rounded-full ${color}`} />
      {sym}
    </span>
  );
}
