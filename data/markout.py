import json, sys, time, math, urllib.request, datetime as dt, bisect
raw = sys.argv[1]
def klines_1m(t0, t1):
    rows, t = [], t0 * 1000
    while t < t1 * 1000:
        url = f"https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&startTime={t}&endTime={t1*1000-1}&limit=1000"
        with urllib.request.urlopen(url, timeout=30) as r: b = json.load(r)
        if not b: break
        rows += [(x[0] // 1000, float(x[1]), float(x[4])) for x in b]; t = b[-1][0] + 60000; time.sleep(0.15)
    return rows
llama = {r["timestamp"][:10]: r for r in json.load(open(f"{raw}/llama_v3_005.json"))["data"]}
vol = {r["week"]: r for r in json.load(open(f"{raw}/weekly_vol.json"))}
out = []
for week in sys.argv[2:]:
    S = json.load(open(f"{raw}/swaps_{week}.json"))
    t0 = int(dt.datetime.fromisoformat(week).replace(tzinfo=dt.timezone.utc).timestamp()); t1 = t0 + 7 * 86400
    K = klines_1m(t0, t1); kt = [k[0] for k in K]
    def price(t):
        i = bisect.bisect_right(kt, t) - 1
        if i < 0: return K[0][1]
        st, o, c = K[i]; f = min(max((t - st) / 60, 0), 1)
        return o + (c - o) * f        # interpolate inside the minute
    fees = mark = vol_usd = 0.0
    for t, a0, a1 in S["swaps"]:
        p = price(t)
        fees += 0.0005 * (a0 if a0 > 0 else a1 * p)
        mark += a0 + a1 * p                 # pool's gain valued at Binance price (includes the fee)
        vol_usd += abs(a0)
    tvl = llama[week]["tvlUsd"]
    rvar = vol[week]["ann_vol"] ** 2 / 52
    out.append({"week": week, "ann_vol": vol[week]["ann_vol"], "eth_move_pct": vol[week]["move_pct"], "swaps": len(S["swaps"]),
                "volume_usd": vol_usd, "tvl_usd": tvl, "fees_usd": fees, "lp_markout_usd": mark,
                "arb_loss_usd": fees - mark, "formula_lvr_usd": tvl * rvar / 8,
                "per_1m": {"fees": fees / tvl * 1e6, "arb_loss": (fees - mark) / tvl * 1e6, "net": mark / tvl * 1e6, "formula_lvr": rvar / 8 * 1e6},
                "llama_fee_estimate_usd": sum(llama[(dt.date.fromisoformat(week) + dt.timedelta(d)).isoformat()]["apyBase"] / 100 / 365 * llama[(dt.date.fromisoformat(week) + dt.timedelta(d)).isoformat()]["tvlUsd"] for d in range(7))})
json.dump(out, open(f"{raw}/lvr_results.json", "w"), indent=1)
for r in out:
    print(f"\n{r['week']}  vol {r['ann_vol']*100:.1f}%  ETH {r['eth_move_pct']:+.1f}%  swaps {r['swaps']:,}  volume ${r['volume_usd']/1e6:,.0f}M  TVL ${r['tvl_usd']/1e6:,.1f}M")
    print(f"  fees ${r['fees_usd']:,.0f} (DefiLlama est ${r['llama_fee_estimate_usd']:,.0f})  arb loss ${r['arb_loss_usd']:,.0f}  LP net ${r['lp_markout_usd']:,.0f}  formula LVR ${r['formula_lvr_usd']:,.0f}")
    p = r["per_1m"]; print(f"  per $1M TVL: fees ${p['fees']:,.0f}  arb loss ${p['arb_loss']:,.0f}  net ${p['net']:,.0f}  formula ${p['formula_lvr']:,.0f}")
