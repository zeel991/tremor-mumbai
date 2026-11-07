"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hash, type Hex } from "viem";
import { useConnect, useConnection, useSwitchChain, useWalletClient } from "wagmi";
import { abis, erc20Abi, hasFunction, routerAbiWithErrors } from "@/lib/abis";
import { forkChain, IS_FORK, RPC_URL, SETTLEMENT_PAIR } from "@/lib/chain";
import { read, settled, type WindowView } from "@/lib/chainReads";
import { deployment, WINDOW_KEYS, type Deployment, type WindowKey } from "@/lib/deployment";
import { errMsg, varianceToVol } from "@/lib/format";
import { decodeOrder, type Order } from "@/lib/order";
import { exactInSwapTraits, minOutWithSlippage, quoteTraits } from "@/lib/takerTraits";
import { getWalletClient } from "wagmi/actions";
import { publicClient, wagmiConfig } from "@/lib/wagmi";
import { useWalletOnFork } from "@/lib/walletGuard";
import { useWalletChoices } from "@/lib/wallets";
import { Chip, TxLink, ErrorNote, fmtDuration, fmtSpan, fmtToken, InfoTip, MoreLink, PageHeader, Panel, Skeleton } from "./app/kit";
import { windowName } from "./app/OverviewView";

type SideName = "LONG" | "SHORT";
type Dir = "buy" | "sell";
const WAD = 10n ** 18n;
const SLIPPAGE_BPS = 100n; // 1%
const GAS_RESERVE = 10n ** 15n; // keep 0.001 ETH for gas when wrapping
const WETH_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;

async function loadWindow(d: Deployment, id: bigint) {
  const [w, head] = await Promise.all([read<WindowView>(d.market, abis.market.abi, "window", [id]), publicClient.getBlock()]);
  const lockedP = hasFunction(abis.market.abi, "lockedWeth") ? read<bigint>(d.market, abis.market.abi, "lockedWeth", [id]) : Promise.reject(new Error("market ABI has no lockedWeth"));
  // caughtUp(id) exists on markets with the stale-quote fix; older deployments lack it (treated as caught up)
  const caughtUpP = hasFunction(abis.market.abi, "caughtUp") ? read<boolean>(d.market, abis.market.abi, "caughtUp", [id]) : Promise.resolve(true);
  const [vProj, orderEnc, vaultLong, vaultShort, locked, caught] = await Promise.allSettled([
    read<bigint>(d.market, abis.market.abi, "projectedVariance", [id]),
    read<Hex>(d.vault, abis.vault.abi, "currentOrderEncoded", [id]),
    read<bigint>(w.long, erc20Abi, "balanceOf", [d.vault]),
    read<bigint>(w.short, erc20Abi, "balanceOf", [d.vault]),
    lockedP,
    caughtUpP,
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
  const caughtUp = caught.status === "fulfilled" ? caught.value : true;
  return { w, now: head.timestamp, vProj: settled(vProj), order, vaultLong: settled(vaultLong), vaultShort: settled(vaultShort), locked: settled(locked), caughtUp };
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
  const walletChoices = useWalletChoices();
  const connect = useConnect();
  const switchChain = useSwitchChain();

  const [windowKey, setWindowKey] = useState<WindowKey>("live");
  const [side, setSide] = useState<SideName>("LONG");
  const [dir, setDir] = useState<Dir>("buy");
  // Sepolia pays 0.001 WETH per pair (1,000x smaller than the fork), so start with a size that fills there.
  const [amountStr, setAmountStr] = useState(IS_FORK ? "0.1" : "0.0005");
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
  // Trading ends at t1 (the market's quote reverts TooLate), even before anyone settles the week.
  const closed = !!w?.finalized || (win.data !== undefined && (!win.data.order.ok || (!!w && win.data.now >= w.t1)));

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
      const [weth, long, short, allowance, eth] = await Promise.all([
        read<bigint>(d.weth, erc20Abi, "balanceOf", [address!]),
        read<bigint>(w!.long, erc20Abi, "balanceOf", [address!]),
        read<bigint>(w!.short, erc20Abi, "balanceOf", [address!]),
        read<bigint>(tokenIn!, erc20Abi, "allowance", [address!, d.router]),
        publicClient.getBalance({ address: address! }),
      ]);
      return { weth, long, short, allowance, eth };
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

  // wagmi's cached wallet client can lag behind a wallet that just connected or switched network (seen with
  // Zerion): fetch one on demand instead of silently doing nothing.
  async function signer() {
    return walletClient ?? (await getWalletClient(wagmiConfig, { chainId: forkChain.id }));
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

  // A real wallet holds ETH; the strategy trades WETH. Wrap exactly the shortfall (WETH9.deposit).
  const wrapShortfall = q && user.data && dir === "buy" && insufficient ? q.amountIn - user.data.weth : undefined;
  const canWrap = wrapShortfall !== undefined && !!user.data && user.data.eth > wrapShortfall + GAS_RESERVE;
  function wrap() {
    if (!wrapShortfall || !address) return;
    void send(`Wrap ${fmtToken(wrapShortfall, "ETH")}`, async () =>
      (await signer()).writeContract({ address: d.weth, abi: WETH_DEPOSIT_ABI, functionName: "deposit", value: wrapShortfall, chain: forkChain, account: address }),
    );
  }

  function approve() {
    if (!q || !tokenIn || !address) return;
    // The taker pays the ROUTER: in Aqua mode SwapVM does safeTransferFrom(taker -> router) then AQUA.push.
    void send(`Approve ${fmtToken(q.amountIn, inSym)}`, async () =>
      (await signer()).writeContract({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [d.router, q.amountIn], chain: forkChain, account: address }),
    );
  }

  function swap() {
    if (!q || !order || !tokenIn || !tokenOut || !address || minOut === undefined) return;
    const traits = exactInSwapTraits(address, minOut);
    void send(`${dir === "buy" ? "Buy" : "Sell"} ${fmtToken(dir === "buy" ? q.amountOut : q.amountIn, side)}`, async () => {
      const sim = await publicClient.simulateContract({
        address: d.router,
        abi: routerAbiWithErrors,
        functionName: "swap",
        args: [order.value, tokenIn, tokenOut, q.amount, traits],
        account: address,
      });
      return (await signer()).writeContract({ ...sim.request, chain: forkChain, account: address });
    });
  }

  // The market pauses quotes while a newer Chainlink round is uningested (stale-quote fix): offer the checkpoint.
  const stale = !!win.data && !closed && !win.data.caughtUp;
  function checkpoint() {
    if (!address) return;
    void send("Update prices (Chainlink checkpoint)", async () =>
      (await signer()).writeContract({ address: d.market, abi: abis.market.abi, functionName: "checkpoint", args: [id, 64n], chain: forkChain, account: address }),
    );
  }

  // One button, one state.
  let cta: { label: string; onClick?: () => void; disabled: boolean };
  if (closed) cta = { label: w?.finalized ? "This week has settled" : "Trading closed for this week", disabled: true };
  else if (!address) cta = { label: connect.isPending ? "Connecting…" : "Connect wallet", onClick: () => walletChoices[0] && connect.mutate({ connector: walletChoices[0] }), disabled: !walletChoices[0] || connect.isPending };
  else if (guard.state === "wrong-chain") cta = { label: IS_FORK ? "Switch to the local fork" : "Switch to Sepolia", onClick: () => switchChain.mutate({ chainId: forkChain.id }), disabled: false };
  else if (guard.state === "not-fork") cta = { label: "Wallet isn't on the local fork", disabled: true };
  else if (guard.state === "checking") cta = { label: "Checking network…", disabled: true };
  else if (amount === undefined) cta = { label: "Enter an amount", disabled: true };
  else if (stale) cta = { label: busy ? "Confirm in wallet…" : "Update prices", onClick: checkpoint, disabled: busy };
  else if (!q) cta = { label: quote.error ? "No quote for this size" : "Getting quote…", disabled: true };
  else if (insufficient && canWrap) cta = { label: busy ? "Confirm in wallet…" : `Wrap ${fmtToken(wrapShortfall, "ETH")} to WETH`, onClick: wrap, disabled: busy };
  else if (insufficient) cta = { label: dir === "buy" ? `Not enough WETH (or ETH to wrap, keeping ${fmtToken(GAS_RESERVE, "ETH")} for gas)` : `Not enough ${inSym}`, disabled: true };
  else if (needsApproval) cta = { label: `Approve ${inSym}`, onClick: approve, disabled: busy };
  else cta = { label: busy ? "Confirm in wallet…" : `${dir === "buy" ? "Buy" : "Sell"} ${side}`, onClick: swap, disabled: busy || !user.data };

  const price = q && q.amountOut > 0n && q.amountIn > 0n ? (dir === "buy" ? (q.amountIn * WAD) / q.amountOut : (q.amountOut * WAD) / q.amountIn) : undefined;

  return (
    <>
      <PageHeader title="Trade cover" sub={`Buy LONG if you expect ${SETTLEMENT_PAIR} to swing this week, SHORT if you expect it to stay calm. Every claim is fully backed by WETH.`} />

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
                <div className="mt-0.5 text-[12.5px] text-ink-3">{x === "LONG" ? `Pays more if ${SETTLEMENT_PAIR} swings` : `Pays more if ${SETTLEMENT_PAIR} stays calm`}</div>
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
          {stale && !closed && (
            <p className="px-3 pt-3 text-[13px] text-ink-2">
              Chainlink published a new price since the last update, so quotes are paused until it&apos;s fed in. Anyone can do it: one transaction.
            </p>
          )}
          {quote.error && !closed && !stale && <p className="px-3 pt-3 text-[13px] text-loss">The strategy can&apos;t fill this size. Try a smaller amount.</p>}

          <div className="p-1 pt-4">
            {!address && !closed && walletChoices.length > 1 ? (
              <div className="grid grid-cols-2 gap-2">
                {walletChoices.map((c) => (
                  <button key={c.uid} className="btn-primary py-3.5 text-[15px]" disabled={connect.isPending} onClick={() => connect.mutate({ connector: c })}>
                    {connect.isPending ? "Connecting…" : `Connect ${c.name}`}
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn-primary w-full py-3.5 text-[15.5px]" disabled={cta.disabled} onClick={cta.onClick}>
                {cta.label}
              </button>
            )}
            {!address && !closed && connect.error && (
              <p className="mt-2.5 text-center text-[12.5px] text-loss">
                {(connect.error.name as string) === "ProviderNotFoundError"
                  ? "No wallet found in this browser. Install MetaMask or Rabby, then reload the page."
                  : `Couldn't connect: ${connect.error.message.split("\n")[0]}`}
              </p>
            )}
            {!address && !closed && !connect.error && <p className="mt-2.5 text-center text-[12.5px] text-ink-3">Quotes work without a wallet.</p>}
            {address && guard.state === "wrong-chain" && switchChain.error && (
              <p className="mt-2.5 text-center text-[12.5px] text-loss">
                Your wallet refused to switch: {switchChain.error.message.split("\n")[0].replace(/\.+$/, "")}. Turn on testnets in the wallet, or switch to
                Sepolia there by hand.
              </p>
            )}
            {guard.state === "not-fork" && <p className="mt-2.5 text-center text-[12.5px] text-ink-3">Point your wallet&apos;s chain-1 RPC at {RPC_URL} so nothing reaches real mainnet.</p>}
          </div>

          {txs.length > 0 && (
            <ul className="mx-1 mb-1 mt-3 space-y-1.5 border-t border-line pt-3">
              {txs.map((t) => (
                <li key={t.id} className="rounded-lg px-2 py-1.5 text-[13px]">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${t.status === "success" ? "bg-[#6fd29b]" : t.status === "signing" || t.status === "pending" ? "animate-pulse bg-ink-3" : "bg-loss"}`} />
                    <span className="flex-1 truncate">
                      {t.label}
                      <span className="text-ink-3"> · {t.status === "signing" ? "confirm in wallet" : t.status}</span>
                    </span>
                    {t.hash && <TxLink hash={t.hash} />}
                  </div>
                  {t.status === "error" && t.detail && (
                    <p className="mt-1 pl-[18px] text-[12px] leading-snug text-loss" title={t.detail}>
                      {t.detail.split("\n")[0].slice(0, 220)}
                    </p>
                  )}
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
