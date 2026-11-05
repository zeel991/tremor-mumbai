# usage: summarize_full.py <full_dir> <weekly_vol.json>  -> prints per-pool stats, writes full_104w.json next to the script
import json, sys, os, glob
full, volp = sys.argv[1], sys.argv[2]
evol = {r["week"]: r["ann_vol"] for r in json.load(open(volp))}
names = {"uniweth": "UNI/WETH 0.3%", "ethusdc30": "ETH/USDC 0.3%"}
out, bad = {}, []
for tag, name in names.items():
    rows = []
    for f in sorted(glob.glob(f"{full}/res_{tag}_*.json")):
        try: r = json.load(open(f))
        except Exception: bad.append(f); continue
        m = 1e6 / r["tvl_usd"]
        rows.append({"week": r["week"], "eth_vol": evol[r["week"]], "pair_vol": r["pair_ann_vol"], "swaps": r["swaps"], "tvl": r["tvl_usd"],
                     "fees": r["fees_usd"], "arb": r["arb_loss_usd"], "net": r["lp_net_usd"],
                     "fees_1m": r["fees_usd"] * m, "arb_1m": r["arb_loss_usd"] * m, "net_1m": r["lp_net_usd"] * m})
    out[name] = rows
    n = len(rows); neg = [r for r in rows if r["net"] < 0]
    tf, ta, tn = sum(r["fees"] for r in rows), sum(r["arb"] for r in rows), sum(r["net"] for r in rows)
    print(f"\n== {name}: {n} weeks")
    print(f"  total fees ${tf:,.0f}  arb loss ${ta:,.0f} ({ta/tf*100:.0f}% of fees)  LP net ${tn:,.0f}")
    print(f"  losing weeks: {len(neg)}  total lost in them ${sum(r['net'] for r in neg):,.0f}")
    for lo, hi in ((0, .45), (.45, .6), (.6, .8), (.8, 2)):
        b = [r for r in rows if lo <= r["eth_vol"] < hi]
        if b:
            f = sum(r["fees_1m"] for r in b) / len(b); a = sum(r["arb_1m"] for r in b) / len(b)
            print(f"  ETH vol {lo*100:.0f}-{hi*100:.0f}%: n={len(b):3d} losing={sum(r['net']<0 for r in b):2d}  avg/$1M fees ${f:,.0f} arb ${a:,.0f} net ${f-a:,.0f}  arb/fees {a/f*100:.0f}%")
    worst = sorted(rows, key=lambda r: r["net"])[:5]
    print("  worst weeks:", [(r["week"], f"ETH vol {r['eth_vol']*100:.0f}%", f"net ${r['net']:,.0f}", f"{r['net_1m']:,.0f}/$1M") for r in worst])
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "full_104w.json"), "w"), indent=1)
print("\nunreadable result files:", bad)
