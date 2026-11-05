"""Generate Foundry test vectors from the exact reference model.

  python3 reference/gen_vectors.py
writes contracts/test/vectors/pricing.json and contracts/test/vectors/variance.json.

All integers are emitted as decimal strings (JSON numbers lose precision above 2^53) in parallel arrays,
so Solidity reads them with vm.parseJsonUintArray / parseJsonIntArray / parseJsonBoolArray.
Deterministic: fixed RNG seeds.
"""

from __future__ import annotations

import json
import os
import random
import sys
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_CEILING
from fractions import Fraction

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pricing_reference as P  # noqa: E402

WAD = P.WAD
D = P.DEFAULTS
S, LAM, KAPPA, H0, HMIN, VCAP, VFWD = D["S"], D["LAMBDA"], D["KAPPA"], D["H0"], D["H_MIN"], D["V_CAP"], D["V_FWD"]
WEEK = 7 * 86400

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "contracts", "test", "vectors")

rng = random.Random(20261107)


def table(keys):
    return {k: [] for k in keys}


def push(t, **kw):
    assert set(kw) == set(t), (set(kw) ^ set(t))
    for k, v in kw.items():
        t[k].append(v if isinstance(v, bool) else str(v))


# ------------------------------------------------------------------ prices a0 / b0 used across vectors

def realistic_prices():
    """a0/b0 values that the defaults actually produce, plus edges."""
    out = set()
    T = WEEK
    for vproj in (0, 1, 10**17, VFWD, 10**18, VCAP - 1, VCAP, 5 * 10**18):
        for e in (0, T // 3, T // 2, T - 1, T):
            for skew in (0, 10**18, -(10**18), 37 * 10**18, -(250 * 10**18)):
                for side_long in (True, False):
                    ml = P.mid_long(S, vproj, VCAP)
                    m = P.skewed(ml if side_long else S - ml, KAPPA, skew, S)
                    h = P.half_spread(S, H0, HMIN, T, e)
                    if m + h < S:
                        out.add(("a", m + h))
                    if m > h:
                        out.add(("b", m - h))
    a = sorted(v for k, v in out if k == "a")
    b = sorted(v for k, v in out if k == "b")
    return a, b


A0S, B0S = realistic_prices()
EDGE_A0 = [1, 2, 10**9, 10**16, S // 2, S - 10**16, S - 10**15, S - 2, S - 1]
EDGE_B0 = [1, 2, 10**9, 10**15, 10**16, S // 2, S - 10**16, S - 1]


def pick(lst, k):
    return rng.sample(lst, min(k, len(lst)))


def gen_pricing():
    v = {}

    # midLong / payoutLong
    t = table(["S", "v", "vCap", "expected"])
    for s in (S, 1, 3 * 10**18 + 7, 10**18 - 1, 12345, 10**24):
        for vv in (0, 1, 10**17, VFWD, VCAP - 1, VCAP, VCAP + 1, 10**21):
            for cap in (VCAP, 10**18, 3):
                push(t, S=s, v=vv, vCap=cap, expected=P.mid_long(s, vv, cap))
    for _ in range(60):
        s, vv, cap = rng.randrange(1, 10**22), rng.randrange(0, 10**19), rng.randrange(1, 10**19)
        push(t, S=s, v=vv, vCap=cap, expected=P.payout_long(s, vv, cap))
    v["midLong"] = t

    # skewed
    t = table(["mid", "kappa", "skew", "S", "expected"])
    for mid in (0, 1, S // 3, S // 2, S - 1, S):
        for skew in (0, 1, -1, 999, -999, 10**18, -(10**18), 1500 * 10**15 + 1, -(1500 * 10**15 + 1),
                     2000 * 10**18, -(2000 * 10**18), 10**30, -(10**30)):
            for kap in (KAPPA, 0, 7 * 10**14 + 3):
                push(t, mid=mid, kappa=kap, skew=skew, S=S, expected=P.skewed(mid, kap, skew, S))
    for _ in range(60):
        mid = rng.randrange(0, S + 1)
        skew = rng.randrange(-(10**21), 10**21)
        push(t, mid=mid, kappa=KAPPA, skew=skew, S=S, expected=P.skewed(mid, KAPPA, skew, S))
    v["skewed"] = t

    # halfSpread
    t = table(["S", "h0", "hMin", "T", "e", "expected"])
    for s in (S, 3 * 10**18 + 7, 10**18 - 1, 777, 10**24 + 1):
        for T in (WEEK, WEEK + 1, 10 * 86400 + 13):
            for e in (0, 1, T // 3, T // 2, T - 1, T, T + 5, 10**12):
                for h0, hm in ((H0, HMIN), (H0, H0), (10**17, 0), (H0 + 1, HMIN + 3)):
                    push(t, S=s, h0=h0, hMin=hm, T=T, e=e, expected=P.half_spread(s, h0, hm, T, e))
    v["halfSpread"] = t

    # buyCost / maxBuy / buyUnitsForInput
    tc = table(["a0", "lambda", "n", "expected"])
    tm = table(["a0", "lambda", "S", "expected"])
    tu = table(["a0", "lambda", "x", "expected"])
    a0s = EDGE_A0 + pick(A0S, 40) + [rng.randrange(1, S) for _ in range(30)]
    lams = (LAM, 1, 10**18, 3 * 10**15 + 1)
    for a0 in a0s:
        for lam in lams if a0 in EDGE_A0 else (LAM,):
            mb = P.max_buy(a0, lam, S)
            push(tm, a0=a0, **{"lambda": lam}, S=S, expected=mb)
            ns = {0, 1, 2, 3, 999, 10**15, 10**18, 10**18 + 1, mb, max(mb - 1, 0), mb + 1, rng.randrange(0, mb + 2)}
            for n in sorted(ns):
                push(tc, a0=a0, **{"lambda": lam}, n=n, expected=P.buy_cost(a0, lam, n))
            xs = {0, 1, 2, 3, 1000, 10**15, 10**17, 10**18, 10 * 10**18, rng.randrange(0, 10**20)}
            cmb = P.buy_cost(a0, lam, mb)
            xs |= {cmb, cmb - 1 if cmb else 0, cmb + 1}
            for _ in range(4):
                n = rng.randrange(1, mb + 2)
                c = P.buy_cost(a0, lam, n)
                xs |= {c, c - 1, c + 1}
            for x in sorted(xs):
                push(tu, a0=a0, **{"lambda": lam}, x=x, expected=P.buy_units_for_input(a0, lam, x))
    for a0 in (S, S + 1, 2 * S):
        push(tm, a0=a0, **{"lambda": LAM}, S=S, expected=P.max_buy(a0, LAM, S))
    v["buyCost"], v["maxBuy"], v["buyUnitsForInput"] = tc, tm, tu

    # maxSell / sellProceeds / sellUnitsForOutput
    tm = table(["b0", "lambda", "expected"])
    tp = table(["b0", "lambda", "n", "expected", "reverts"])
    tu = table(["b0", "lambda", "x", "expected", "reverts"])
    b0s = EDGE_B0 + pick(B0S, 40) + [rng.randrange(1, S) for _ in range(30)]
    for b0 in b0s:
        for lam in lams if b0 in EDGE_B0 else (LAM,):
            ms = P.max_sell(b0, lam)
            push(tm, b0=b0, **{"lambda": lam}, expected=ms)
            ns = {0, 1, 2, 3, 999, 10**15, 10**18, ms, max(ms - 1, 0), ms + 1, ms + 10**18, rng.randrange(0, ms + 2)}
            for n in sorted(ns):
                try:
                    push(tp, b0=b0, **{"lambda": lam}, n=n, expected=P.sell_proceeds(b0, lam, n), reverts=False)
                except P.NoQuote:
                    push(tp, b0=b0, **{"lambda": lam}, n=n, expected=0, reverts=True)
            pmax = P.sell_proceeds(b0, lam, ms)
            xs = {0, 1, 2, 3, 1000, 10**15, 10**17, 10**18, pmax, max(pmax - 1, 0), pmax + 1, pmax + 10**18,
                  b0 * b0 // (2 * lam), b0 * b0 // (2 * lam) + 1}
            for _ in range(4):
                n = rng.randrange(0, ms + 1)
                pv = P.sell_proceeds(b0, lam, n)
                xs |= {pv, pv + 1, max(pv - 1, 0)}
            for x in sorted(xs):
                try:
                    push(tu, b0=b0, **{"lambda": lam}, x=x, expected=P.sell_units_for_output(b0, lam, x), reverts=False)
                except P.NoQuote:
                    push(tu, b0=b0, **{"lambda": lam}, x=x, expected=0, reverts=True)
    v["maxSell"], v["sellProceeds"], v["sellUnitsForOutput"] = tm, tp, tu

    # lnWad: exact ln of the WAD ratio actually fed to lnWad, rounded to nearest wei (Decimal, 80 digits)
    t = table(["x", "expected"])
    xs = [WAD, WAD + 1, WAD - 1, WAD // 2, 2 * WAD, 10**17, 10 * WAD, 1, 10**36]
    xs += [rng.randrange(WAD * 9 // 10, WAD * 11 // 10) for _ in range(120)]
    xs += [rng.randrange(WAD // 2, 2 * WAD) for _ in range(60)]
    for x in xs:
        lnv = (Decimal(x) / Decimal(WAD)).ln() * WAD
        push(t, x=x, expected=int(lnv.to_integral_value(rounding=ROUND_HALF_EVEN)))
    v["lnWad"] = t

    v["marketQuote"] = gen_market_quotes()
    v["params"] = dict(S=str(S), lambda_=str(LAM), kappa=str(KAPPA), h0=str(H0), hMin=str(HMIN),
                       vCap=str(VCAP), vFwd=str(VFWD))
    return v


def gen_market_quotes():
    """Whole-market quote vectors. The market test builds a window with a CONSTANT price path (so q == 0 exactly),
    places the last ingested round at t0 + e, and calls VarianceMarket.quote. Defaults for h0/hMin/lambda/kappa."""
    t = table(["S", "vCap", "vFwd", "T", "e", "side", "takerBuys", "exactIn", "amount", "skew",
               "vProj", "expectedIn", "expectedOut", "reverts"])
    T = WEEK

    def add(s, cap, vf, e, side_long, buys, exact_in, amount, skew):
        vp = P.projected_variance(0, vf, T, e)
        try:
            ai, ao = P.quote(S=s, v_cap=cap, v_proj=vp, T=T, e=e, kappa=KAPPA, h0=H0, h_min=HMIN, lam=LAM,
                             side_long=side_long, taker_buys=buys, exact_in=exact_in, amount=amount, skew_wad=skew)
            rev = False
        except P.NoQuote:
            ai = ao = 0
            rev = True
        push(t, S=s, vCap=cap, vFwd=vf, T=T, e=e, side=0 if side_long else 1, takerBuys=buys, exactIn=exact_in,
             amount=amount, skew=skew, vProj=vp, expectedIn=ai, expectedOut=ao, reverts=rev)

    for vf in (VFWD, 0, VCAP, 3 * 10**18, 10**18):
        for e in (0, T // 2, T - 3600):
            for side_long in (True, False):
                for skew in (0, 25 * 10**18, -(40 * 10**18)):
                    ml = P.mid_long(S, P.projected_variance(0, vf, T, e), VCAP)
                    m = P.skewed(ml if side_long else S - ml, KAPPA, skew, S)
                    h = P.half_spread(S, H0, HMIN, T, e)
                    a0, b0 = m + h, m - h
                    # buys
                    amts_out = [1, 10**18, 50 * 10**18]
                    amts_in = [1, 10**15, 10**18, 10 * 10**18]
                    if a0 < S:
                        mb = P.max_buy(a0, LAM, S)
                        amts_out += [mb, mb + 1]
                        amts_in += [P.buy_cost(a0, LAM, mb), P.buy_cost(a0, LAM, mb + 1)]
                    for a in amts_out:
                        add(S, VCAP, vf, e, side_long, True, False, a, skew)
                    for a in amts_in:
                        add(S, VCAP, vf, e, side_long, True, True, a, skew)
                    # sells
                    s_in = [1, 10**18, 50 * 10**18]
                    s_out = [1, 10**15, 10**17]
                    if b0 > 0:
                        ms = P.max_sell(b0, LAM)
                        s_in += [ms, ms + 1]
                        pm = P.sell_proceeds(b0, LAM, ms)
                        s_out += [pm, pm + 1]
                    for a in s_in:
                        add(S, VCAP, vf, e, side_long, False, True, a, skew)
                    for a in s_out:
                        add(S, VCAP, vf, e, side_long, False, False, a, skew)
    # non-default S / vCap
    for s, cap in ((3 * 10**18 + 7, VCAP), (10**18, 10**18), (5 * 10**17 + 1, 4 * 10**18 + 1)):
        for side_long in (True, False):
            for buys in (True, False):
                for exact_in in (True, False):
                    add(s, cap, VFWD, T // 3, side_long, buys, exact_in, 3 * 10**18 + 11, 0)
    return t


# ------------------------------------------------------------------ variance paths

T0 = 1_760_000_000  # a Unix time; the test warps around it


def path_rounds(moves, t0, t1, *, p_start=2_600_000_000_000_000, pre=3, post=2, times=None):
    """Build rounds: `pre` rounds before/at t0 (anchor is the last one), then one round per move inside (t0, t1),
    then `post` rounds at/after t1. moves are relative changes (Fraction) applied to the integer price."""
    rounds = []
    p = p_start
    u = t0 - 3 * 3600
    for i in range(pre):
        rounds.append((p, u))
        p = int(p * (1 + Fraction(rng.randrange(-15, 16), 1000)))
        u += 3600
    rounds[-1] = (rounds[-1][0], t0 if pre >= 2 else rounds[-1][1])  # anchor exactly at t0
    p = rounds[-1][0]
    n = len(moves)
    if times is None:
        span = t1 - t0
        times = sorted(rng.sample(range(t0 + 1, t1), n))
    for mv, tt in zip(moves, times):
        p = max(1, int(Fraction(p) * (1 + mv)))
        rounds.append((p, tt))
    u = t1
    for i in range(post):
        p = int(p * Fraction(105, 100))
        rounds.append((p, u))
        u += 1800
    return rounds


def signed(mag):
    return mag if rng.random() < 0.5 else -mag


def gen_variance():
    paths = []

    def add(name, rounds, t0, t1, s=S, cap=VCAP, note=""):
        rv = P.realized_variance(rounds, t0, t1)
        terms = rv["terms"]
        T = t1 - t0
        # Per-term tolerance (wei of q). Error sources for one term, with r = ln(ratio):
        #   (a) ratio = floor(p_i*1e18/p_{i-1}): ratio error < 1 wei -> r error < 1/ratio wei
        #   (b) lnWad approximation error: measured <= 1 wei on the lnWad vectors; budget 2 wei
        #   (c) r*r/1e18 truncation: < 1 wei;  error of r^2 from dr: (2|r| + dr/1e18) * dr
        # tol_i = ceil((2|r| + 1) * (1/ratio + 2)) + 1, i.e. ~4-10 wei for |r| <= 1; well under the 1e3/term target.
        tol_terms = []
        for r in terms:
            ratio = r.exp()
            dr = Decimal(1) / ratio + 2
            tol_terms.append(int(((2 * abs(r) + 1) * dr).to_integral_value(rounding=ROUND_CEILING)) + 1)
        q_wad = rv["q_wad"]
        q_tol = sum(tol_terms)
        v_exact = rv["V_wad"]
        v_tol = int((Decimal(q_tol) * P.YEAR / T).to_integral_value(rounding=ROUND_CEILING)) + 1
        pay_exact = P.payout_from_real_variance(s, v_exact, cap)
        pay_tol = int((Decimal(v_tol) * s / cap).to_integral_value(rounding=ROUND_CEILING)) + 1
        paths.append(dict(
            name=name, note=note, t0=str(t0), t1=str(t1), S=str(s), vCap=str(cap),
            answers=[str(a) for a, _ in rounds], updatedAts=[str(u) for _, u in rounds],
            anchorIndex=str(rv["anchor_index"]), p0=str(rv["p0"]), nTerms=str(len(terms)),
            termsWad=[str(int((r * r * WAD).to_integral_value(rounding=ROUND_HALF_EVEN))) for r in terms],
            termTolWad=[str(x) for x in tol_terms],
            qWad=str(int(q_wad.to_integral_value(rounding=ROUND_HALF_EVEN))), qTolWad=str(q_tol),
            V=str(int(v_exact.to_integral_value(rounding=ROUND_HALF_EVEN))), VTol=str(v_tol),
            payoutLong=str(int(pay_exact.to_integral_value(rounding=ROUND_HALF_EVEN))), payoutTol=str(pay_tol),
            vol=f"{float((v_exact / WAD).sqrt()):.4f}",
        ))

    t0, t1 = T0, T0 + WEEK
    # zero variance: constant price
    add("constant_price", path_rounds([Fraction(0)] * 28, t0, t1), t0, t1, note="q = 0, V = 0, payoutLong = 0")
    # no rounds inside the window at all: q = 0
    add("no_rounds_in_window", path_rounds([], t0, t1), t0, t1, note="only anchor and post-t1 rounds")
    # realistic UNI/ETH week: ~28 rounds, deviation-threshold 2% moves
    moves = [Fraction(signed(rng.randrange(2000, 2400)), 100000) for _ in range(28)]
    add("uni_eth_2pct_28rounds", path_rounds(moves, t0, t1), t0, t1, note="2.0-2.4% moves, 28 rounds")
    # realistic with smaller heartbeat moves mixed in
    moves = [Fraction(signed(rng.choice([rng.randrange(2000, 2600), rng.randrange(0, 800)])), 100000) for _ in range(31)]
    add("uni_eth_mixed_31rounds", path_rounds(moves, t0, t1), t0, t1, note="mix of 2% and heartbeat moves")
    # 436%-vol week (spec §11 max measured): V ~= 19.0 > vCap -> payoutLong = S
    target_q = Decimal("4.36") ** 2 * WEEK / P.YEAR
    nr = 160
    mag = float(target_q / nr) ** 0.5
    moves = [Fraction(signed(int(mag * 1e6 * rng.uniform(0.9, 1.1))), 10**6) for _ in range(nr)]
    add("vol_436pct_week", path_rounds(moves, t0, t1), t0, t1, note="~436% annualized vol; above cap")
    # near cap: V just below 2.25
    target_q = Decimal("2.23") * WEEK / P.YEAR
    nr = 28
    mag = float(target_q / nr) ** 0.5
    moves = [Fraction(signed(int(mag * 1e7)), 10**7) for _ in range(nr)]
    add("near_cap", path_rounds(moves, t0, t1), t0, t1, note="V just below vCap")
    # large single moves (|r| up to ~0.69)
    moves = [Fraction(-1, 2), Fraction(1, 1), Fraction(1, 3), Fraction(-1, 4), Fraction(1, 100)]
    add("crash_and_recover", path_rounds(moves, t0, t1), t0, t1, note="-50%, +100%, +33%, -25%, +1%")
    # longer window, non-default S and cap
    t1b = t0 + 10 * 86400 + 13
    moves = [Fraction(signed(rng.randrange(1000, 3000)), 100000) for _ in range(45)]
    add("ten_day_nondefault_S", path_rounds(moves, t0, t1b), t0, t1b, s=3 * 10**18 + 7, cap=10**18,
        note="T = 10d+13s, S = 3e18+7, vCap = 1e18")
    # equal timestamps allowed (updatedAt == lastUpdatedAt)
    times = sorted([t0 + 100, t0 + 100, t0 + 5000, t0 + 5000, t0 + 90000, t1 - 1])
    moves = [Fraction(1, 50), Fraction(-1, 50), Fraction(1, 40), Fraction(0), Fraction(-1, 30), Fraction(1, 20)]
    add("equal_timestamps_last_at_t1_minus_1", path_rounds(moves, t0, t1, times=times), t0, t1,
        note="duplicate updatedAt values; last round at t1-1")
    # 1-wei price magnitudes (tiny answers) to stress ratio flooring
    moves = [Fraction(signed(rng.randrange(1000, 5000)), 100000) for _ in range(20)]
    add("tiny_answers", path_rounds(moves, t0, t1, p_start=10**6), t0, t1, note="answers ~1e6 (coarse ratios)")
    return {"count": str(len(paths)), "paths": paths}


def main():
    os.makedirs(OUT, exist_ok=True)
    pv = gen_pricing()
    with open(os.path.join(OUT, "pricing.json"), "w") as f:
        json.dump(pv, f, indent=1)
    vv = gen_variance()
    with open(os.path.join(OUT, "variance.json"), "w") as f:
        json.dump(vv, f, indent=1)
    counts = {k: len(next(iter(t.values()))) for k, t in pv.items() if k != "params"}
    print("pricing.json:", counts, "total", sum(counts.values()))
    print("variance.json:", len(vv["paths"]), "paths")
    for p in vv["paths"]:
        print(f"  {p['name']:40s} terms={p['nTerms']:>4s} vol={p['vol']} V={int(p['V'])/1e18:.6f} "
              f"payout={int(p['payoutLong'])/1e18:.6f} qTol={p['qTolWad']}")


if __name__ == "__main__":
    main()
