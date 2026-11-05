"""Independent exact reference model for Tremor market maths (docs/spec.md §2, §6.2, §7.1-7.4, §11).

Written from the spec formulas, not from the Solidity. Stdlib only.

Units (spec §2, §7.4):
  S, prices (mid, m, h, a0, b0): WETH wei per WHOLE claim token (1e18 claim-token wei).
  lambda: WETH wei per whole token, per whole token traded.
  kappa:  WETH wei per whole token of skew; skew is given in WAD (whole tokens * 1e18).
  n: claim-token wei. x: WETH wei. Variances (V, vCap, vFwd, Vp, q): WAD.

Every quantity is first computed as an exact rational (fractions.Fraction) straight from the spec
formula and is then rounded ONCE where an integer is required:
  - amounts the taker pays: ceil;  amounts the taker receives: floor          (spec §7.4)
  - units sold to the taker: floor (largest n);  units taken from taker: ceil (smallest n)
  - payoutLong: floor                                                         (spec §7.2)
  - mid, h, Vp, V: the spec does not state a rounding; this model uses floor of the exact value
  - skew adjustment kappa*skew/1e18: spec silent; this model truncates toward zero
Realized variance uses Decimal with 80 significant digits for ln.
"""

from __future__ import annotations

from decimal import Decimal, getcontext
from fractions import Fraction
from math import ceil, floor, isqrt

getcontext().prec = 80

WAD = 10**18
YEAR = 31_536_000

# spec §11 defaults
DEFAULTS = dict(
    S=10**18,
    LAMBDA=2 * 10**15,
    KAPPA=10**15,
    H0=5 * 10**16,
    H_MIN=10**16,
    V_CAP=225 * 10**16,
    V_FWD=33 * 10**16,
    FINALIZE_DELAY=3600,
    MIN_WINDOW=7 * 86400,
)


class NoQuote(Exception):
    pass


def _floor(f: Fraction) -> int:
    return floor(f)


def _ceil(f: Fraction) -> int:
    return ceil(f)


# ------------------------------------------------------------------ payoff / mid (§7.2, §7.4)

def mid_long(S: int, v_proj: int, v_cap: int) -> int:
    """mid_L = S * min(Vp, Vcap) / Vcap, floored."""
    return _floor(Fraction(S) * min(v_proj, v_cap) / v_cap)


def payout_long(S: int, v: int, v_cap: int) -> int:
    """payoutLong = floor(S * min(V, Vcap) / Vcap) (§7.2)."""
    return _floor(Fraction(S) * min(v, v_cap) / v_cap)


def skewed(mid: int, kappa: int, skew_wad: int, S: int) -> int:
    """m = clamp(mid + kappa * skew, 0, S), skew in whole tokens (skew_wad / 1e18).
    The adjustment kappa*skew_wad/1e18 is truncated toward zero (spec silent)."""
    adj_exact = Fraction(kappa * skew_wad, WAD)
    adj = int(adj_exact)  # int() of a Fraction truncates toward zero
    m = mid + adj
    return max(0, min(S, m))


def half_spread(S: int, h0: int, h_min: int, T: int, e: int) -> int:
    """h = S * (hMin + (h0 - hMin) * (T - e) / T), with h0, hMin WAD fractions; e clamped to [0, T]. Floored once."""
    e = max(0, min(e, T))
    frac = Fraction(h_min, WAD) + Fraction(h0 - h_min, WAD) * Fraction(T - e, T)
    return _floor(S * frac)


# ------------------------------------------------------------------ projected variance (§7.3)

def projected_variance(q: int, v_fwd: int, T: int, e: int) -> int:
    """Vp = (Q*YEAR + vFwd*(T - e)) / T, floored."""
    e = max(0, min(e, T))
    return _floor(Fraction(q * YEAR + v_fwd * (T - e), T))


def settle_variance(q: int, T: int) -> int:
    """V = Q * YEAR / (t1 - t0), floored (§6.2 Finalize)."""
    return _floor(Fraction(q * YEAR, T))


# ------------------------------------------------------------------ taker buys (§7.4)
# unit ask a(q) = a0 + lambda*q  (q in whole tokens). Cost of N whole tokens = a0*N + lambda*N^2/2.
# With n wei: N = n/1e18.

def _buy_cost_exact(a0: int, lam: int, n: int) -> Fraction:
    N = Fraction(n, WAD)
    return a0 * N + Fraction(lam) * N * N / 2


def buy_cost(a0: int, lam: int, n: int) -> int:
    """amountIn = ceil(n*a0 + lambda*n^2/2) (whole-token units, WETH wei)."""
    return _ceil(_buy_cost_exact(a0, lam, n))


def max_buy(a0: int, lam: int, S: int) -> int:
    """largest n (wei) with n <= (S - a0)/lambda whole tokens; 0 if a0 >= S."""
    if a0 >= S:
        return 0
    return _floor(Fraction((S - a0) * WAD, lam))


def buy_units_for_input(a0: int, lam: int, x: int) -> int:
    """Characterisation: the LARGEST n >= 0 with buy_cost(n) <= x. Found by exponential + binary search
    over the exact cost function (no square-root formula), so it is independent of the closed form."""
    if buy_cost(a0, lam, 0) > x:
        return 0
    lo, hi = 0, 1
    while buy_cost(a0, lam, hi) <= x:
        lo, hi = hi, hi * 2
    # invariant: cost(lo) <= x < cost(hi)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if buy_cost(a0, lam, mid) <= x:
            lo = mid
        else:
            hi = mid
    return lo


def buy_units_closed_form(a0: int, lam: int, x: int) -> int:
    """Spec closed form n = floor((-a0 + sqrt(a0^2 + 2*lambda*x)) / lambda) evaluated EXACTLY (whole-token
    units, converted to wei). Used only as a cross-check of the characterisation."""
    # in wei: n = floor(1e18*(sqrt(a0^2 + 2*lambda*x) - a0)/lambda) = floor((sqrt(D*1e36) - a0*1e18)/lambda)
    D = a0 * a0 + 2 * lam * x
    r = isqrt(D * WAD * WAD)  # floor of the real root; floor((floor(R) - c)/l) == floor((R - c)/l) for ints c, l
    return (r - a0 * WAD) // lam


# ------------------------------------------------------------------ taker sells (§7.4)
# unit bid b(q) = b0 - lambda*q. Proceeds of N whole tokens = b0*N - lambda*N^2/2.

def max_sell(b0: int, lam: int) -> int:
    """largest n (wei) with n <= b0/lambda whole tokens."""
    return _floor(Fraction(b0 * WAD, lam))


def _sell_proceeds_exact(b0: int, lam: int, n: int) -> Fraction:
    N = Fraction(n, WAD)
    return b0 * N - Fraction(lam) * N * N / 2


def sell_proceeds(b0: int, lam: int, n: int) -> int:
    """amountOut = floor(n*b0 - lambda*n^2/2); NoQuote if n > b0/lambda."""
    if n > max_sell(b0, lam):
        raise NoQuote("n > maxSell")
    return _floor(_sell_proceeds_exact(b0, lam, n))


def sell_units_for_output(b0: int, lam: int, x: int) -> int:
    """Characterisation: the SMALLEST n in [0, maxSell] with sell_proceeds(n) >= x; NoQuote if none.
    sell_proceeds is non-decreasing on [0, maxSell], so binary search is exact."""
    cap = max_sell(b0, lam)
    if sell_proceeds(b0, lam, cap) < x:
        raise NoQuote("x above max proceeds")
    lo, hi = -1, cap  # proceeds(lo) < x <= proceeds(hi), with proceeds(-1) := -inf
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if sell_proceeds(b0, lam, mid) >= x:
            hi = mid
        else:
            lo = mid
    return hi


def sell_units_closed_form(b0: int, lam: int, x: int) -> int:
    """Spec closed form n = ceil((b0 - sqrt(b0^2 - 2*lambda*x)) / lambda), evaluated exactly. Cross-check only."""
    D = b0 * b0 - 2 * lam * x
    if D < 0:
        raise NoQuote("b0^2 < 2*lambda*x")
    R = isqrt(D * WAD * WAD)
    num = b0 * WAD - R  # ceil((b0*1e18 - floor(Rreal))/l) == ceil((b0*1e18 - Rreal)/l)
    return -((-num) // lam)


# ------------------------------------------------------------------ full quote (§7.4)

def quote(*, S, v_cap, v_proj, T, e, kappa, h0, h_min, lam, side_long: bool, taker_buys: bool,
          exact_in: bool, amount: int, skew_wad: int):
    """Returns (amountIn, amountOut); raises NoQuote."""
    mid_l = mid_long(S, v_proj, v_cap)
    mid_x = mid_l if side_long else S - mid_l
    m = skewed(mid_x, kappa, skew_wad, S)
    h = half_spread(S, h0, h_min, T, e)
    if taker_buys:
        a0 = m + h
        if a0 >= S:
            raise NoQuote("a0 >= S")
        if exact_in:
            n = buy_units_for_input(a0, lam, amount)
            res = (amount, n)
        else:
            n = amount
            res = (buy_cost(a0, lam, n), n)
        if n > max_buy(a0, lam, S):
            raise NoQuote("n > maxBuy")
        return res
    b0 = m - h
    if b0 <= 0:
        raise NoQuote("b0 <= 0")
    if exact_in:
        return (amount, sell_proceeds(b0, lam, amount))
    return (sell_units_for_output(b0, lam, amount), amount)


# ------------------------------------------------------------------ realized variance (§7.1, §6.2)

def ln_dec(x: Fraction) -> Decimal:
    return (Decimal(x.numerator) / Decimal(x.denominator)).ln()


def realized_variance(rounds, t0: int, t1: int):
    """rounds: list of (answer, updatedAt) in round order (one Chainlink phase).
    p0 = answer of the last round with updatedAt <= t0; p_i = answers of rounds with t0 < updatedAt < t1.
    Returns dict with exact r_i (Decimal), q (Decimal, WAD-scaled), and counts. Raises ValueError on bad rounds."""
    anchor = None
    for i, (a, u) in enumerate(rounds):
        if u <= t0:
            anchor = i
    if anchor is None:
        raise ValueError("no round at or before t0")
    p_prev = rounds[anchor][0]
    last_u = rounds[anchor][1]
    terms = []
    for a, u in rounds[anchor + 1:]:
        if u >= t1:
            break
        if a <= 0 or u < last_u:
            raise ValueError("bad round")
        r = ln_dec(Fraction(a, p_prev))
        terms.append(r)
        p_prev, last_u = a, u
    q = sum((r * r for r in terms), Decimal(0))
    return dict(p0=rounds[anchor][0], anchor_index=anchor, terms=terms, q_real=q,
                q_wad=q * WAD, V_wad=q * WAD * YEAR / (t1 - t0))


def payout_from_real_variance(S: int, v_wad: Decimal, v_cap: int) -> Decimal:
    v = min(v_wad, Decimal(v_cap))
    return Decimal(S) * v / Decimal(v_cap)


# ------------------------------------------------------------------ self-checks

def _self_check():
    d = DEFAULTS
    S, lam = d["S"], d["LAMBDA"]
    # characterisation vs exact closed form
    import random
    rng = random.Random(7)
    for _ in range(3000):
        a0 = rng.randrange(1, S)
        x = rng.choice([rng.randrange(0, 10**6), rng.randrange(0, 10**18), rng.randrange(0, 10**21)])
        assert buy_units_for_input(a0, lam, x) == buy_units_closed_form(a0, lam, x), (a0, x)
        b0 = rng.randrange(1, S)
        xs = rng.randrange(0, b0 * b0 // (2 * lam) + 2)
        try:
            ref = sell_units_for_output(b0, lam, xs)
        except NoQuote:
            ref = None
        try:
            cf = sell_units_closed_form(b0, lam, xs)
            if cf > max_sell(b0, lam):
                cf = None
        except NoQuote:
            cf = None
        assert ref == cf, (b0, xs, ref, cf)
    # I2
    for v in (0, 1, 10**18, d["V_CAP"], 10**20):
        pl = payout_long(S, v, d["V_CAP"])
        assert 0 <= pl <= S and pl + (S - pl) == S
    print("pricing_reference self-check OK")


if __name__ == "__main__":
    _self_check()
