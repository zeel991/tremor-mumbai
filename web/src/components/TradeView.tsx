"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { parseUnits, type Address, type Hash, type Hex } from "viem";
import { useConnection, useWalletClient } from "wagmi";
import { abis, erc20Abi, hasFunction, routerAbiWithErrors } from "@/lib/abis";
import { forkChain } from "@/lib/chain";
import { read, settled, type WindowView } from "@/lib/chainReads";
import { deployment, WINDOW_KEYS, WINDOW_LABELS, type Deployment, type WindowKey } from "@/lib/deployment";
import { errMsg, fmtDate, fmtWad, fmtWadExact, shortAddr, varianceToVol, fmtPct } from "@/lib/format";
import { decodeOrder, type Order } from "@/lib/order";
import { exactInSwapTraits, minOutWithSlippage, quoteTraits } from "@/lib/takerTraits";
import { publicClient } from "@/lib/wagmi";
import { useWalletOnFork } from "@/lib/walletGuard";
import { Card, Mono, Notice, Stat, Tag } from "./ui";

type SideName = "LONG" | "SHORT";
type Dir = "buy" | "sell";
const WAD = 10n ** 18n;
const SLIPPAGE_BPS = 100n; // 1%

async function loadWindow(d: Deployment, id: bigint) {
  const w = await read<WindowView>(d.market, abis.market.abi, "window", [id]);
  const lockedP = hasFunction(abis.market.abi, "lockedWeth") ? read<bigint>(d.market, abis.market.abi, "lockedWeth", [id]) : Promise.reject(new Error("market ABI has no lockedWeth"));
  const [vProj, orderEnc, vaultLong, vaultShort, vaultWeth, supplyLong, supplyShort, locked] = await Promise.allSettled([
    read<bigint>(d.market, abis.market.abi, "projectedVariance", [id]),
    read<Hex>(d.vault, abis.vault.abi, "currentOrderEncoded", [id]),
    read<bigint>(w.long, erc20Abi, "balanceOf", [d.vault]),
    read<bigint>(w.short, erc20Abi, "balanceOf", [d.vault]),
    read<bigint>(d.weth, erc20Abi, "balanceOf", [d.vault]),
    read<bigint>(w.long, erc20Abi, "totalSupply"),
    read<bigint>(w.short, erc20Abi, "totalSupply"),
    lockedP,
  ]);
  let order: { ok: true; value: Order; encoded: Hex } | { ok: false; error: string };
  const enc = settled(orderEnc);
  if (!enc.ok) order = enc;
  else {
    try {
      order = { ok: true, value: decodeOrder(enc.value), encoded: enc.value };
    } catch (e) {
      order = { ok: false, error: `could not decode currentOrderEncoded: ${errMsg(e)}` };
    }
  }
  return {
    w,
    vProj: settled(vProj),
    order,
    vaultLong: settled(vaultLong),
    vaultShort: settled(vaultShort),
    vaultWeth: settled(vaultWeth),
    supplyLong: settled(supplyLong),
    supplyShort: settled(supplyShort),
    locked: settled(locked),
  };
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

type TxEntry = { label: string; hash?: Hash; status: "signing" | "pending" | "success" | "reverted" | "error"; detail?: string };

export function TradeView() {
  const d = deployment as Deployment; // rendered only inside <DeploymentGate>
  const qc = useQueryClient();
  const { address } = useConnection();
  const { data: walletClient } = useWalletClient();
  const guard = useWalletOnFork();

  const [windowKey, setWindowKey] = useState<WindowKey>("live");
  const [side, setSide] = useState<SideName>("LONG");
  const [dir, setDir] = useState<Dir>("buy");
  const [amountStr, setAmountStr] = useState("0.1");
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const [busy, setBusy] = useState(false);

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

  const quote = useQuery({
    queryKey: ["trade-quote", id.toString(), tokenIn, tokenOut, amount?.toString(), order?.encoded, address],
    enabled: !!order && !!tokenIn && !!tokenOut && amount !== undefined,
    refetchInterval: 6_000,
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
      return { amountIn: res[0], amountOut: res[1], orderHash: res[2], blockNumber, amount: amount! };
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
  const canWrite = guard.state === "ok" && !!walletClient && !!address && !busy;

  function pushTx(e: TxEntry) {
    setTxs((t) => [e, ...t].slice(0, 6));
  }
  function patchTx(label: string, patch: Partial<TxEntry>) {
    setTxs((t) => t.map((x) => (x.label === label && (x.status === "signing" || x.status === "pending") ? { ...x, ...patch } : x)));
  }

  async function send(label: string, run: () => Promise<Hash>) {
    setBusy(true);
    pushTx({ label, status: "signing" });
    try {
      const hash = await run();
      patchTx(label, { hash, status: "pending" });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      patchTx(label, { status: r.status === "success" ? "success" : "reverted" });
    } catch (e) {
      patchTx(label, { status: "error", detail: errMsg(e) });
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
    void send(`Approve ${fmtWad(q.amountIn, 6)} ${inSym} for router`, () =>
      walletClient.writeContract({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [d.router, q.amountIn], chain: forkChain, account: address }),
    );
  }

  function swap() {
    if (!q || !order || !tokenIn || !tokenOut || !walletClient || !address || minOut === undefined) return;
    const traits = exactInSwapTraits(address, minOut);
    void send(`Swap ${fmtWad(q.amountIn, 6)} ${inSym} → ≥ ${fmtWad(minOut, 6)} ${outSym}`, async () => {
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {WINDOW_KEYS.map((k) => (
          <Pill key={k} active={k === windowKey} onClick={() => setWindowKey(k)}>
            {WINDOW_LABELS[k]} <span className="text-ink-3">#{d.windows[k].toString()}</span>
          </Pill>
        ))}
      </div>

      {win.error && <Notice title="Cannot read this window" tone="error">{errMsg(win.error)}</Notice>}

      {w && win.data && <WindowCard w={w} vProj={win.data.vProj} />}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card title="Trade" subtitle="Exact-in swap against the vault's Aqua strategy through TremorAquaSwapVMRouter (instruction 0x22).">
          <div className="flex flex-wrap gap-4">
            <Segmented value={side} options={["LONG", "SHORT"]} onChange={(v) => setSide(v as SideName)} />
            <Segmented value={dir} options={["buy", "sell"]} labels={{ buy: "Buy", sell: "Sell" }} onChange={(v) => setDir(v as Dir)} />
          </div>
          <label className="mt-4 block text-[12px] text-ink-2" htmlFor="amt">
            You pay ({inSym}, exact)
          </label>
          <div className="mt-1 flex items-center rounded-md border border-line bg-surface-2 focus-within:border-accent">
            <input
              id="amt"
              inputMode="decimal"
              className="num w-full bg-transparent px-3 py-2 text-[18px] outline-none"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.0"
            />
            <span className="px-3 text-[13px] text-ink-2">{inSym}</span>
          </div>
          {balanceIn !== undefined && (
            <div className="mt-1 text-[12px] text-ink-3">
              Balance: <span className="num">{fmtWad(balanceIn, 6)}</span> {inSym}
            </div>
          )}

          <div className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-[13.5px]">
            {!order && win.data && !win.data.order.ok && <p className="text-loss">No strategy order: {win.data.order.error}</p>}
            {amount === undefined && <p className="text-ink-3">Enter an amount.</p>}
            {quote.isFetching && !q && <p className="text-ink-3">Quoting…</p>}
            {quote.error && <p className="text-loss">Quote reverted: {errMsg(quote.error)}</p>}
            {q && (
              <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-ink-2">You pay</dt>
                <dd className="text-right font-semibold">
                  {fmtWadExact(q.amountIn)} {inSym}
                </dd>
                <dt className="text-ink-2">You receive</dt>
                <dd className="text-right font-semibold">
                  {fmtWadExact(q.amountOut)} {outSym}
                </dd>
                <dt className="text-ink-2">Average price</dt>
                <dd className="text-right">
                  {q.amountOut > 0n && q.amountIn > 0n
                    ? dir === "buy"
                      ? `${fmtWad((q.amountIn * WAD) / q.amountOut, 6)} WETH per ${side}`
                      : `${fmtWad((q.amountOut * WAD) / q.amountIn, 6)} WETH per ${side}`
                    : "—"}
                </dd>
                <dt className="text-ink-2">Minimum received (1% slippage)</dt>
                <dd className="text-right">
                  {fmtWadExact(minOut!)} {outSym}
                </dd>
                <dt className="text-ink-2">Quoted at block</dt>
                <dd className="text-right">{q.blockNumber.toString()}</dd>
              </dl>
            )}
            {q && (
              <p className="mt-2 text-[12px] text-ink-3">
                Amounts are the exact return of <Mono>router.quote</Mono> for this size; quote and swap run the same pricing. The average price is those two numbers divided.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {needsApproval ? (
              <button className="btn-primary" disabled={!canWrite || !q} onClick={approve}>
                Approve {inSym} for router
              </button>
            ) : (
              <button className="btn-primary" disabled={!canWrite || !q || insufficient || !user.data} onClick={swap}>
                {dir === "buy" ? `Buy ${side}` : `Sell ${side}`}
              </button>
            )}
            <WriteHint guard={guard.state} connected={!!address} insufficient={insufficient} inSym={inSym} />
          </div>

          {txs.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-line pt-3 text-[12.5px]">
              {txs.map((t, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <Tag tone={t.status === "success" ? "measured" : t.status === "pending" || t.status === "signing" ? "neutral" : "warn"}>{t.status}</Tag>
                  <span>{t.label}</span>
                  {t.hash && <Mono title={t.hash}>{shortAddr(t.hash)}</Mono>}
                  {t.detail && <span className="text-loss">{t.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {w && win.data && <CollateralCard w={w} data={win.data} />}
      </div>
    </div>
  );
}

function WriteHint({ guard, connected, insufficient, inSym }: { guard: string; connected: boolean; insufficient: boolean; inSym: string }) {
  let msg: string | null = null;
  if (!connected) msg = "Connect a wallet to trade. Quotes work without one.";
  else if (guard === "wrong-chain") msg = "Switch the wallet to chain id 1 (the local fork).";
  else if (guard === "not-fork") msg = "Your wallet's chain-1 RPC is not http://127.0.0.1:8545. Point it at the local fork; trading is disabled so nothing reaches real mainnet.";
  else if (guard === "checking") msg = "Checking that the wallet is on the local fork…";
  else if (insufficient) msg = `Not enough ${inSym}.`;
  return msg ? <span className="text-[12.5px] text-ink-2">{msg}</span> : null;
}

function WindowCard({ w, vProj }: { w: WindowView; vProj: { ok: true; value: bigint } | { ok: false; error: string } }) {
  const payoutShort = w.S - w.payoutLong;
  return (
    <Card
      title={`Window ${fmtDate(w.t0)} → ${fmtDate(w.t1)}`}
      subtitle="LONG pays S · min(V, V_cap) / V_cap per token at settlement and SHORT pays the rest, where V is realized UNI/ETH variance from Chainlink rounds."
      right={w.finalized ? <Tag tone="measured">finalized</Tag> : <Tag>open</Tag>}
    >
      <div className="grid grid-cols-2 gap-5 md:grid-cols-5">
        <Stat label="S (LONG + SHORT pays)" value={`${fmtWad(w.S, 4)} WETH`} />
        <Stat label="Variance cap" value={fmtPct(varianceToVol(w.vCap), 0) + " vol"} note={`V_cap = ${fmtWad(w.vCap, 4)}`} />
        {w.finalized ? (
          <>
            <Stat label="LONG paid" value={`${fmtWad(w.payoutLong, 6)} WETH`} note="per whole token" />
            <Stat label="SHORT paid" value={`${fmtWad(payoutShort, 6)} WETH`} note="per whole token" />
          </>
        ) : (
          <>
            <Stat
              label="Projected variance"
              value={vProj.ok ? fmtPct(varianceToVol(vProj.value), 1) + " vol" : "—"}
              note={vProj.ok ? "realized so far + writer's forward, for pricing" : vProj.error}
            />
            <Stat label="Last Chainlink round used" value={w.lastUpdatedAt > 0n ? fmtDate(w.lastUpdatedAt) : "—"} />
          </>
        )}
        <Stat label="Tokens" value={<Mono>{shortAddr(w.long)}</Mono>} note={<>SHORT <Mono>{shortAddr(w.short)}</Mono></>} />
      </div>
    </Card>
  );
}

type WinData = Awaited<ReturnType<typeof loadWindow>>;

function CollateralCard({ w, data }: { w: WindowView; data: WinData }) {
  const sets = w.setsOutstanding;
  const computedLocked = (sets * w.S) / WAD;
  const locked = data.locked.ok ? data.locked.value : computedLocked;
  const claims = data.supplyLong.ok && data.supplyShort.ok ? data.supplyLong.value + data.supplyShort.value : undefined;
  // claims (whole tokens) per whole WETH of actual collateral
  const ratio = claims !== undefined && locked > 0n ? Number((claims * 10_000n) / locked) / 10_000 : undefined;
  const soldLong = data.vaultLong.ok ? sets - data.vaultLong.value : undefined;
  const soldShort = data.vaultShort.ok ? sets - data.vaultShort.value : undefined;

  return (
    <Card
      title="Effective vs actual collateral"
      subtitle="Each set of 1 LONG + 1 SHORT is backed by exactly S WETH locked in VarianceMarket, so sets × S WETH backs 2 × sets claims. Read live from the market and the claim tokens."
    >
      <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[13.5px]">
        <dt className="text-ink-2">Sets outstanding</dt>
        <dd className="text-right">{fmtWad(sets, 4)}</dd>
        <dt className="text-ink-2">Actual collateral (WETH locked)</dt>
        <dd className="text-right">
          {fmtWad(locked, 4)} <span className="text-ink-3 text-[12px]">{data.locked.ok ? "market.lockedWeth" : "sets × S"}</span>
        </dd>
        <dt className="text-ink-2">Claims outstanding (LONG + SHORT supply)</dt>
        <dd className="text-right">{claims !== undefined ? fmtWad(claims, 4) : "—"}</dd>
        <dt className="font-medium">Claims per WETH of collateral</dt>
        <dd className="text-right font-semibold">{ratio !== undefined ? `${ratio.toFixed(2)}×` : "—"}</dd>
      </dl>
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 text-[12px] font-medium text-ink-2">Vault inventory (shipped to Aqua, unsold)</div>
        <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13.5px]">
          <dt className="text-ink-2">LONG in vault / sold</dt>
          <dd className="text-right">
            {data.vaultLong.ok ? fmtWad(data.vaultLong.value, 4) : "—"} / {soldLong !== undefined ? fmtWad(soldLong, 4) : "—"}
          </dd>
          <dt className="text-ink-2">SHORT in vault / sold</dt>
          <dd className="text-right">
            {data.vaultShort.ok ? fmtWad(data.vaultShort.value, 4) : "—"} / {soldShort !== undefined ? fmtWad(soldShort, 4) : "—"}
          </dd>
          <dt className="text-ink-2">WETH in vault (buyback reserve + proceeds)</dt>
          <dd className="text-right">{data.vaultWeth.ok ? fmtWad(data.vaultWeth.value, 4) : "—"}</dd>
        </dl>
        <p className="mt-2 text-[12px] text-ink-3">&ldquo;Sold&rdquo; = sets outstanding − vault balance of that side.</p>
      </div>
      {data.order.ok && (
        <p className="mt-3 break-all text-[11.5px] text-ink-3">
          Strategy maker <Mono>{shortAddr(data.order.value.maker)}</Mono>, program {(data.order.value.data.length - 2) / 2} bytes.
        </p>
      )}
    </Card>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[13.5px] ${active ? "border-ink bg-ink text-page [&_span]:text-ink-3" : "border-line bg-surface hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

function Segmented({ value, options, labels, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded px-3 py-1 text-[13.5px] ${value === o ? "bg-ink text-page" : "text-ink-2 hover:bg-hover"}`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}
