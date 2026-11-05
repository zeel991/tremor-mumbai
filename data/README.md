# LVR on Uniswap v3 ETH/USDC 0.05%: real numbers

Pool: `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640` (Ethereum mainnet), the largest ETH/USDC pool.

## Sources

| What | Source | Script |
|---|---|---|
| ETH volatility | Binance ETHUSDT 5-minute closes, 2024-11-04 → 2026-11-01 (209,664 candles) | `klines.py`, `weekly_vol.py` |
| Every swap in 3 weeks | `eth_getLogs` on the pool's Swap event via `rpc.mevblocker.io` | `fetch_swaps.py` |
| Swap valuation | Binance 1-minute candles, interpolated to the second of each swap | `markout.py` |
| Pool TVL; fees for all 104 weeks | DefiLlama yields (pool `665dc8bc-…`) | inline |

## Method

- **Fees** = 0.05% of each swap's input.
- **LP net** = what the pool received minus what it paid out on each swap, valued at the Binance price at that moment. This includes the fee.
- **Arbitrage loss (measured LVR)** = fees − LP net.
- **Formula LVR** = TVL × weekly realized variance ÷ 8. This is the full-range model; it is a model, not a measurement.

## Measured weeks (every swap)

| Week | ETH vol (ann.) | ETH move | Swaps | Volume | TVL | Fees | Arb loss | LP net |
|---|---|---|---|---|---|---|---|---|
| 2026-04-27 (calm) | 39.6% | −2.0% | 27,205 | $244M | $100.6M | $122,004 | $63,930 | +$58,073 |
| 2025-10-20 (normal) | 59.5% | +4.4% | 32,573 | $331M | $72.6M | $165,340 | $50,064 | +$115,275 |
| 2025-02-24 (violent) | 119.3% | −10.7% | 67,595 | $2,775M | $195.8M | $1,388,439 | $520,521 | +$867,918 |

**Per $1M of TVL:**

| Week | Fees | Arb loss | LP net | Formula LVR | Arb loss as % of fees |
|---|---|---|---|---|---|
| Calm | $1,212 | $635 | +$577 | $377 | 52% |
| Normal | $2,278 | $690 | +$1,588 | $852 | 30% |
| Violent | $7,091 | $2,658 | +$4,433 | $3,420 | 37% |

The fee calculation matches DefiLlama's estimate within 1–3% in all three weeks.

## All 104 weeks (DefiLlama fees vs formula LVR, per $1M TVL)

| ETH vol | Weeks | Avg fees | Avg formula LVR | LVR as % of fees |
|---|---|---|---|---|
| < 45% | 18 | $2,378 | $386 | 16% |
| 45–60% | 34 | $3,024 | $674 | 22% |
| 60–80% | 33 | $5,546 | $1,153 | 21% |
| > 80% | 19 | $8,001 | $2,317 | 29% |

The formula LVR never exceeded fees in any of the 104 weeks.

## Other pools: same 3 weeks, every swap (`fetch_swaps_pool.py`, `markout_pool.py`)

All pools are on Ethereum mainnet. Each pool's tokens and fee tier were checked on-chain. Fees match DefiLlama within about 1–12%. Values are per $1M of average TVL.

| Pool | Week | Pair vol | Fees | Arb loss | LP net | Arb as % of fees |
|---|---|---|---|---|---|---|
| ETH/USDC 0.05% | calm / normal / violent | 40 / 60 / 119% | 1,198 / 2,228 / 8,126 | 628 / 675 / 3,046 | +570 / +1,553 / +5,080 | 52 / 30 / 37% |
| ETH/USDC 0.3% | calm / normal / violent | 40 / 60 / 119% | 2,349 / 6,474 / 12,736 | 2,111 / 5,254 / 9,190 | +238 / +1,219 / +3,546 | 90 / 81 / 72% |
| LINK/WETH 0.3% | calm / normal / violent | 31 / 46 / 75% | 934 / 3,621 / 9,604 | 631 / 2,656 / 7,956 | +303 / +965 / +1,648 | 68 / 73 / 83% |
| UNI/WETH 0.3% | calm / normal / violent | 27 / 36 / 85% | 497 / 854 / 7,675 | 382 / 776 / 10,758 | +115 / +78 / **−3,084** | 77 / 91 / **140%** |
| PEPE/WETH 0.3% | calm / normal / violent | 72 / 50 / 87% | 880 / 153 / 5,881 | 782 / 82 / 3,142 | +98 / +71 / +2,739 | 89 / 54 / 53% |

On the 0.3% pools, measured arb loss is 2–6× the full-range formula, because concentrated liquidity loses more than the formula assumes.

## Long run: UNI/WETH 0.3% and ETH/USDC 0.3%, all 104 weeks (`run_week.sh`, `summarize_full.py`)

All 104 weeks are complete for both pools: 2024-11-04 to 2026-11-01, every swap. Raw results are in `full_104w.json`.

| Pool | Fees | Arb loss | Arb as % of fees | LP net | Losing weeks |
|---|---|---|---|---|---|
| UNI/WETH 0.3%, all weeks | $11.04M | $9.54M | 86% | +$1.51M | **14 of 104 (13%)**, losing $335,891 in total |
| UNI/WETH 0.3%, excluding the 2026-10-26 week | $10.74M | $10.02M | **93%** | +$0.72M | 14 of 103 |
| ETH/USDC 0.3% | $30.77M | $24.81M | 81% | +$5.97M | 0 |

**The outlier week (2026-10-26).** On 29 Oct 2026, 22:34–22:42 UTC, about 1M UNI was sold into the pool at 0.00204–0.00225 ETH. Binance UNI/ETH stayed at about 0.00285, so the sales were 20–28% below market. LPs bought cheaply and gained about $524k in one minute and $787k over the week. The method counts that as "negative arbitrage loss", but it isn't arbitrage, so the table shows UNI with and without that week. It does not change the losing-week count. Our fee total for that week is also about 3× DefiLlama's estimate (likely the dump's fees); in every other checked week they match within about 1–12%.

UNI/WETH by ETH volatility, excluding the outlier week (average per $1M):

| ETH vol | Weeks | Losing | Fees | Arb loss | Net | Arb as % of fees |
|---|---|---|---|---|---|---|
| < 45% | 18 | 0 | 1,819 | 1,533 | +286 | 84% |
| 45–60% | 33 | 5 | 3,642 | 3,198 | +443 | 88% |
| 60–80% | 33 | 4 | 4,290 | 3,969 | +322 | 93% |
| > 80% | 19 | 5 | 4,240 | 4,220 | **+21** | **100%** |

In the most volatile weeks, arbitrage took essentially all the fees. 5 of those 19 weeks were losses.

Worst UNI/WETH weeks:

| Week | ETH vol | LP net | Per $1M |
|---|---|---|---|
| 2025-10-06 | 108% | −$137,516 | −$6,500 |
| 2025-02-24 | 119% | −$100,687 | −$3,084 |
| 2025-06-02 | 53% | −$52,690 | −$1,520 |
| 2025-08-11 | 74% | −$18,872 | −$389 |
| 2025-01-13 | 91% | −$13,378 | −$277 |

ETH/USDC 0.3% never had a losing week. Its weakest weeks were calm ones (e.g. 2026-08-10, ETH vol 27%, +$95 per $1M).

## Limits

- Pool-level totals only. Fees and losses are not split per LP. Narrow-range, passive or just-in-time (JIT) LPs can do very differently from the pool average.
- The Binance minute price is an approximate "true" price. USDT and USDC are treated as $1.
- Formula LVR assumes full-range liquidity; measured arb loss came out between 0.78× and 1.69× of it.
- Five Ethereum mainnet pools only. L2 pools (e.g. Base) were not checked: no free RPC would serve their history.
- The fast block lookup in `fetch_swaps_pool.py` was checked against the binary search: same blocks for the 2025-02-24 week. Later it was capped at the chain head after it overshot for the final week.
