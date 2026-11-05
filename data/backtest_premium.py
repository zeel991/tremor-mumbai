# usage: backtest_premium.py <full_dir> <tag>
# Premium rule (set by CRE each week): rate_w = clamp(k * arbLoss_{w-1} / volume_{w-1}, 0, cap)
# Recovered_w = rate_w * volume_w (assumes volume unchanged by the premium -> upper bound).
import json, sys, glob
full, tag = sys.argv[1], sys.argv[2]
rows = sorted((json.load(open(f)) for f in glob.glob(f"{full}/res_{tag}_*.json")), key=lambda r: r["week"])
rows = [r for r in rows if r["week"] != "2026-10-26"]          # outlier dump week excluded (see README)
for k in (0.25, 0.5, 1.0):
    for cap in (0.001, 0.003):
        rec = loss = over = charged = 0.0; neg_before = neg_after = 0
        for prev, cur in zip(rows, rows[1:]):
            rate = min(max(k * prev["arb_loss_usd"] / prev["volume_usd"], 0), cap) if prev["volume_usd"] else 0
            r = rate * cur["volume_usd"]
            rec += min(r, max(cur["arb_loss_usd"], 0)); charged += r; loss += max(cur["arb_loss_usd"], 0)
            over += max(r - max(cur["arb_loss_usd"], 0), 0)
            neg_before += cur["lp_net_usd"] < 0
            neg_after += cur["lp_net_usd"] + r < 0
        print(f"k={k:<4} cap={cap*1e4:>3.0f}bps  charged ${charged/1e6:5.2f}M  recovers {rec/loss*100:5.1f}% of arb loss  over-charge ${over/1e6:4.2f}M  losing weeks {neg_before} -> {neg_after}")
