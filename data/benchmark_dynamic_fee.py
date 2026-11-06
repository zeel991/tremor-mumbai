"""Equal-cost benchmark: the same weekly add-on fee (A) paid straight to LPs as a dynamic fee, or (B) spent on
Tremor LONG cover whose payout goes to LPs. Answers "why not just raise the LP fee?" (review, 6 Nov 2026).

Inputs: data/full_104w.json (UNI/WETH 0.3%, 104 weeks: fees, measured arbitrage loss `arb`, LP net, Binance-sampled
annualized pair volatility `pair_vol`).

Assumptions (all stated in the output):
  - Weekly volume = fees / 0.003.
  - Add-on rate for week w = min(0.5 * arb[w-1] / volume[w-1], 0.30%), floored at 0 (the deployed rule).
  - Retention r scales volume, fees, measured loss and the add-on revenue proportionally (composition-neutral,
    which flatters both A and B: in reality the cleanest flow leaves first).
  - B buys LONG at the deployed ask at window open: mid = S*min(vFwd,vCap)/vCap = 0.3300/2.25, plus half-spread
    h0 = 0.05*S, i.e. 0.1967 per LONG with S = 1. Flat price: no slope, unlimited depth (flatters B).
  - LONG pays min(V, vCap)/vCap per token, V = (k * pair_vol)^2 with k = 0.70: Chainlink-sampled vol was 0.70x the
    Binance-sampled vol in both settled replay weeks (305%/436%, 59.8%/85%). k = 1.0 is shown as a sensitivity.
  - Payout lands in the same week (no drip delay, no JIT capture; flatters B).

usage: python3 data/benchmark_dynamic_fee.py
"""
import json
import statistics as st
from pathlib import Path

POOL = "UNI/WETH 0.3%"
OUTLIER = "2026-10-26"
VCAP, VFWD, H0 = 2.25, 0.33, 0.05
ASK = min(VFWD, VCAP) / VCAP + H0  # per LONG, S = 1
K, CAP = 0.5, 0.003

weeks = json.loads(Path(__file__).with_name("full_104w.json").read_text())[POOL]


def scenario(r=1.0, k_vol=0.70, exclude_outlier=True):
    rows = []
    for prev, cur in zip(weeks, weeks[1:]):
        vol_prev = prev["fees"] / 0.003
        vol_cur = cur["fees"] / 0.003 * r
        rate = min(max(K * prev["arb"] / vol_prev, 0.0), CAP) if vol_prev else 0.0
        addon = rate * vol_cur
        V = (k_vol * cur["pair_vol"]) ** 2
        payoff = min(V, VCAP) / VCAP
        payout = addon / ASK * payoff
        rows.append({"week": cur["week"], "base": cur["net"] * r, "A": cur["net"] * r + addon, "B": cur["net"] * r + payout,
                     "addon": addon, "payout": payout, "payoff": payoff, "capped": V >= VCAP})
    if exclude_outlier:
        rows = [x for x in rows if x["week"] != OUTLIER]
    return rows


def stats(rows, key):
    xs = [x[key] for x in rows]
    s = sorted(xs)
    return {"total": sum(xs), "mean": st.mean(xs), "sd": st.pstdev(xs), "worst": s[0], "p5": s[max(0, int(0.05 * len(s)) - 1)],
            "neg": sum(1 for v in xs if v < 0), "n": len(xs)}


def fmt(v):
    return f"{'-' if v < 0 else ''}${abs(v):,.0f}"


def table(rows, title):
    print(f"\n{title}  ({rows and len(rows)} weeks)")
    print(f"{'':<26}{'total':>13}{'mean/wk':>11}{'sd/wk':>11}{'worst wk':>12}{'5th pct':>11}{'neg wks':>9}")
    for key, label in [("base", "No add-on (today)"), ("A", "A: dynamic LP fee"), ("B", "B: Tremor LONG cover")]:
        s = stats(rows, key)
        print(f"{label:<26}{fmt(s['total']):>13}{fmt(s['mean']):>11}{fmt(s['sd']):>11}{fmt(s['worst']):>12}{fmt(s['p5']):>11}{s['neg']:>9}")


if __name__ == "__main__":
    print(f"Equal-cost benchmark, {POOL}. LONG ask {ASK:.4f} per 1.0 max payout. Outlier week {OUTLIER} excluded.")
    base = scenario()
    table(base, "Retention 100%, Chainlink/Binance vol ratio k = 0.70")

    spent = sum(x["addon"] for x in base)
    paid = sum(x["payout"] for x in base)
    capped = sum(1 for x in base if x["capped"])
    roi = [x["payoff"] / ASK for x in base]
    print(f"\nLONG economics at the deployed ask (k = 0.70): add-on spent {fmt(spent)}, cover paid {fmt(paid)} "
          f"({paid / spent:.0%} of premium returned).")
    print(f"  per-week buyer return payoff/ask: mean {st.mean(roi):.2f}x, median {st.median(roi):.2f}x, "
          f"loses money in {sum(1 for v in roi if v < 1)}/{len(roi)} weeks, cap hit in {capped} weeks.")

    table(scenario(k_vol=1.0), "Sensitivity: k = 1.0 (payout on Binance-sampled vol, upper bound)")

    print("\nRetention sensitivity (k = 0.70). Total LP net over the sample; today's pool earned "
          f"{fmt(stats(base, 'base')['total'])}.")
    print(f"{'retention':<11}{'A total':>13}{'B total':>13}{'A worst':>11}{'B worst':>11}{'A neg':>7}{'B neg':>7}")
    for r in (1.0, 0.75, 0.5, 0.25, 0.10):
        rows = scenario(r=r)
        a, b = stats(rows, "A"), stats(rows, "B")
        print(f"{r:<11.0%}{fmt(a['total']):>13}{fmt(b['total']):>13}{fmt(a['worst']):>11}{fmt(b['worst']):>11}{a['neg']:>7}{b['neg']:>7}")
