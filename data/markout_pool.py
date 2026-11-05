# usage: markout_pool.py <swaps.json> <sym0|USD> <sym1|USD> <fee_rate> <defillama_chart.json> <klines_cache_dir>
# Values every swap at Binance 1m prices (interpolated to the second). USD = a stablecoin valued at $1.
import json, sys, os, time, math, bisect, urllib.request, datetime as dt
sw_path, s0, s1, fee, llama_path, cache = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5], sys.argv[6]
S = json.load(open(sw_path)); week = S["week"]
t0 = int(dt.datetime.fromisoformat(week).replace(tzinfo=dt.timezone.utc).timestamp()); t1 = t0 + 7 * 86400
def klines(sym):
    if sym == "USD": return None
    f = f"{cache}/{sym}USDT_1m_{week}.json"
    if os.path.exists(f): return json.load(open(f))
    rows, t = [], t0 * 1000
    while t < t1 * 1000:
        url = f"https://api.binance.com/api/v3/klines?symbol={sym}USDT&interval=1m&startTime={t}&endTime={t1*1000-1}&limit=1000"
        with urllib.request.urlopen(url, timeout=30) as r: b = json.load(r)
        if not b: break
        rows += [(x[0] // 1000, float(x[1]), float(x[4])) for x in b]; t = b[-1][0] + 60000; time.sleep(0.12)
    json.dump(rows, open(f, "w")); return rows
def pricer(sym):
    K = klines(sym)
    if K is None: return lambda t: 1.0
    kt = [k[0] for k in K]
    def p(t):
        i = max(bisect.bisect_right(kt, t) - 1, 0); st, o, c = K[i]; f = min(max((t - st) / 60, 0), 1)
        return o + (c - o) * f
    return p
p0, p1 = pricer(s0), pricer(s1)
fees = mark = vol_usd = 0.0
for t, a0, a1 in S["swaps"]:
    v0, v1 = a0 * p0(t), a1 * p1(t)
    fees += fee * (v0 if a0 > 0 else v1)
    mark += v0 + v1
    vol_usd += abs(v0)
# realized variance of the pair price (5-min sampling) for the formula
grid = range(t0, t1 + 1, 300)
ratio = [p0(t) / p1(t) for t in grid]
rvar = sum(math.log(b / a) ** 2 for a, b in zip(ratio, ratio[1:]))
ll = {r["timestamp"][:10]: r for r in json.load(open(llama_path))["data"]}
days = [(dt.date.fromisoformat(week) + dt.timedelta(i)).isoformat() for i in range(7)]
tvl = sum(ll[d]["tvlUsd"] for d in days if d in ll) / max(1, sum(d in ll for d in days))
llama_fees = sum(ll[d]["apyBase"] / 100 / 365 * ll[d]["tvlUsd"] for d in days if d in ll and ll[d].get("apyBase") is not None)
r = {"pool": S.get("pool", "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640"), "pair": f"{s0}/{s1}", "week": week, "swaps": len(S["swaps"]), "volume_usd": vol_usd, "tvl_usd": tvl,
     "pair_ann_vol": math.sqrt(rvar * 52), "fees_usd": fees, "llama_fees_usd": llama_fees, "lp_net_usd": mark,
     "arb_loss_usd": fees - mark, "formula_lvr_usd": tvl * rvar / 8}
print(json.dumps(r))
