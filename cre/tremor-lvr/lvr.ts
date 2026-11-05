// Measured LVR maths (docs/spec.md §7.5), as pure integer arithmetic.
//
// No imports and no I/O: the CRE workflow (workflow.ts) and the off-chain validator
// (../scripts/validate.ts) both import this file, so they run the exact same code.
//
// Reproduces data/markout_pool.py:
//   * price at second t = open + (close - open) * clamp((t - candleOpen) / 60, 0, 1) of the
//     last 1m candle whose open time is <= t (the first candle if t is earlier than all);
//   * value  = a0 * P0 + a1 * P1          (pool-perspective amounts: + = pool received)
//   * fee    = feeRate * (a0 > 0 ? value0 : value1)
//   * lvr    = fee - value                 (markout_pool.py: arb_loss = fees - lp_net)
// and volume = |a0| * P0 (the token0 leg), matching data/markout_pool.py, the backtest and spec §7.5.
//
// Every quantity is a bigint. USD values are WAD (1e18). Divisions truncate toward zero
// (BigInt semantics), so every node computes bit-identical results.

export const WAD = 10n ** 18n
export const PIPS = 1_000_000n

export const V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
// keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
export const V4_SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'

export const MAX_LOG_CHUNK = 100 // CRE ChainRead.LogQueryBlockLimit
export const MAX_LOG_CALLS = 12 // spec §8 run budget

export type SourceKind = 'v3' | 'v4'

/** One swap, amounts in raw token units, pool perspective (+ = the pool received). */
export type Swap = {
	blockNumber: bigint
	logIndex: number
	amount0: bigint
	amount1: bigint
	feePips: bigint
}

/** One Binance 1m candle: open time in unix seconds, open/close as WAD USD. */
export type Kline = {
	openTime: number
	open: bigint
	close: bigint
}

export type LvrResult = {
	lvrUsdWad: bigint
	feesUsdWad: bigint
	valueUsdWad: bigint
	volumeUsdWad: bigint
	nSwaps: number
}

export type TokenParams = {
	decimals0: number
	decimals1: number
}

// ---------- ABI words ----------

const strip0x = (h: string): string => (h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h)

/** 32-byte word `i` of hex `data`, as an unsigned bigint. */
export const wordAt = (dataHex: string, i: number): bigint => {
	const d = strip0x(dataHex)
	const w = d.slice(i * 64, i * 64 + 64)
	if (w.length !== 64) throw new Error(`log data too short for word ${i}`)
	return BigInt('0x' + w)
}

/** Two's-complement int256 view of a word (int128/int24 are sign-extended by the ABI). */
export const toSigned256 = (u: bigint): bigint => (u >= 1n << 255n ? u - (1n << 256n) : u)

/**
 * Decode a Swap log's data into pool-perspective amounts.
 *  v3: data = (int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick).
 *      Amounts are already pool-perspective. The fee is the pool's fixed tier (`v3FeePips`).
 *  v4: data = (int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee).
 *      Amounts are swapper-perspective (Pool.sol): negate. The fee is the event's own `fee` (pips).
 */
export const decodeSwap = (
	kind: SourceKind,
	dataHex: string,
	blockNumber: bigint,
	logIndex: number,
	v3FeePips: bigint,
): Swap => {
	const a0 = toSigned256(wordAt(dataHex, 0))
	const a1 = toSigned256(wordAt(dataHex, 1))
	if (kind === 'v3') {
		return { blockNumber, logIndex, amount0: a0, amount1: a1, feePips: v3FeePips }
	}
	const fee = wordAt(dataHex, 5)
	return { blockNumber, logIndex, amount0: -a0, amount1: -a1, feePips: fee }
}

// ---------- block spans ----------

/** Inclusive [from, to] chunks of at most `chunk` blocks. */
export const chunkRange = (from: bigint, to: bigint, chunk: number): Array<[bigint, bigint]> => {
	if (chunk < 1 || chunk > MAX_LOG_CHUNK) throw new Error(`chunk must be 1..${MAX_LOG_CHUNK}`)
	const out: Array<[bigint, bigint]> = []
	for (let a = from; a <= to; a += BigInt(chunk)) {
		const b = a + BigInt(chunk) - 1n
		out.push([a, b < to ? b : to])
	}
	return out
}

/**
 * Timestamp (unix seconds, floored) of `block`, linear in block number between the span's
 * first and last block timestamps (spec §8 step 5).
 */
export const interpolateTimestamp = (
	block: bigint,
	fromBlock: bigint,
	toBlock: bigint,
	tsFrom: bigint,
	tsTo: bigint,
): bigint => {
	if (toBlock === fromBlock) return tsFrom
	return tsFrom + ((block - fromBlock) * (tsTo - tsFrom)) / (toBlock - fromBlock)
}

// ---------- prices ----------

/** Parse a non-negative decimal string ("6.12300000") into a WAD bigint, exactly (truncating past 18 dp). */
export const decimalToWad = (s: string): bigint => {
	const t = s.trim()
	if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`bad decimal: ${s}`)
	const [ip, fp = ''] = t.split('.')
	return BigInt(ip) * WAD + BigInt((fp + '0'.repeat(18)).slice(0, 18))
}

/** Binance /api/v3/klines rows -> Kline[], sorted by open time. */
export const parseKlines = (rows: unknown): Kline[] => {
	if (!Array.isArray(rows)) throw new Error('klines: expected an array')
	const out: Kline[] = rows.map((r) => {
		if (!Array.isArray(r) || r.length < 5) throw new Error('klines: bad row')
		const openMs = Number(r[0])
		if (!Number.isSafeInteger(openMs)) throw new Error('klines: bad open time')
		return { openTime: Math.floor(openMs / 1000), open: decimalToWad(String(r[1])), close: decimalToWad(String(r[4])) }
	})
	out.sort((x, y) => x.openTime - y.openTime)
	return out
}

/**
 * Price at second t, multiplied by 60 (WAD * 60), so the in-minute interpolation has no
 * rounding: open*60 + (close-open)*clamp(t - openTime, 0, 60).
 */
export const priceTimes60 = (k: Kline[], t: bigint): bigint => {
	if (k.length === 0) throw new Error('no klines')
	const tn = Number(t)
	// bisect_right(openTimes, t) - 1, clamped at 0
	let lo = 0
	let hi = k.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (k[mid].openTime <= tn) lo = mid + 1
		else hi = mid
	}
	const c = k[Math.max(lo - 1, 0)]
	let dt = BigInt(tn - c.openTime)
	if (dt < 0n) dt = 0n
	if (dt > 60n) dt = 60n
	return c.open * 60n + (c.close - c.open) * dt
}

/** Klines must cover the span: first open <= tsFrom and last open >= tsTo - 60. */
export const checkCoverage = (k: Kline[], tsFrom: bigint, tsTo: bigint, label: string): void => {
	if (k.length === 0) throw new Error(`${label}: no klines`)
	if (BigInt(k[0].openTime) > tsFrom) throw new Error(`${label}: klines start after span start`)
	if (BigInt(k[k.length - 1].openTime) < tsTo - 60n) throw new Error(`${label}: klines end before span end`)
}

// ---------- LVR ----------

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/**
 * Σ over swaps of spec §7.5. `timeOf` maps a swap to its unix second (the workflow passes
 * block-interpolated time; the validator can pass either).
 */
export const computeLvr = (
	swaps: Swap[],
	k0: Kline[],
	k1: Kline[],
	tokens: TokenParams,
	timeOf: (s: Swap) => bigint,
): LvrResult => {
	const den0 = 60n * 10n ** BigInt(tokens.decimals0)
	const den1 = 60n * 10n ** BigInt(tokens.decimals1)
	let fees = 0n
	let value = 0n
	let volume = 0n
	for (const s of swaps) {
		const t = timeOf(s)
		const v0 = (s.amount0 * priceTimes60(k0, t)) / den0
		const v1 = (s.amount1 * priceTimes60(k1, t)) / den1
		fees += ((s.amount0 > 0n ? v0 : v1) * s.feePips) / PIPS
		value += v0 + v1
		volume += abs(v0)
	}
	return { lvrUsdWad: fees - value, feesUsdWad: fees, valueUsdWad: value, volumeUsdWad: volume, nSwaps: swaps.length }
}

/** Binance klines URL covering [tsFrom - 60 s, tsTo + 60 s] (spec §8 step 4). */
export const klinesUrl = (base: string, symbol: string, tsFrom: bigint, tsTo: bigint): string =>
	`${base}/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${(tsFrom - 60n) * 1000n}&endTime=${
		(tsTo + 60n) * 1000n
	}&limit=1000`

/** WAD bigint -> decimal string (for logs and reports). */
export const formatWad = (x: bigint, dp = 6): string => {
	const neg = x < 0n
	const a = neg ? -x : x
	const ip = a / WAD
	const fp = (a % WAD).toString().padStart(18, '0').slice(0, dp)
	return `${neg ? '-' : ''}${ip.toString()}${dp > 0 ? '.' + fp : ''}`
}
