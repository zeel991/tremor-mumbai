// Off-chain check of the workflow's maths (no CRE runtime).
//
// usage: bun run scripts/validate.ts [--hour 2025-10-10T21:00:00Z] [--rpc https://rpc.mevblocker.io]
//
// 1. Finds the mainnet blocks of one historical UTC hour.
// 2. Fetches the v3 UNI/WETH 0.3% pool's Swap logs in <= 100-block chunks (as the workflow does),
//    the span's first/last block timestamps via Multicall3.getCurrentBlockTimestamp() at those
//    blocks, and Binance UNIUSDT/ETHUSDT 1m klines with the workflow's URL.
// 3. Computes LVR with ../tremor-lvr/lvr.ts, the module the workflow imports.
// 4. Runs the unmodified data/markout_pool.py on the same swaps and the same candles, twice:
//      A. per-swap time = the workflow's block-interpolated timestamp;
//      B. per-swap time = the real block timestamp (from the RPC's log.blockTimestamp).
//    A and B each compare TS vs Python (same maths?); TS(A) vs TS(B) is the interpolation error.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	chunkRange,
	computeLvr,
	decodeSwap,
	formatWad,
	interpolateTimestamp,
	type Kline,
	klinesUrl,
	MAX_LOG_CALLS,
	parseKlines,
	priceTimes60,
	type Swap,
	V3_SWAP_TOPIC,
	WAD,
} from '../tremor-lvr/lvr'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const outDir = resolve(here, '.validate-out')

const args = process.argv.slice(2)
const opt = (n: string, d: string) => {
	const i = args.indexOf(`--${n}`)
	return i >= 0 ? args[i + 1] : d
}
const RPC = opt('rpc', 'https://rpc.mevblocker.io')
const HOUR = opt('hour', '2025-10-10T21:00:00Z')
const BINANCE = 'https://api.binance.com'
const POOL = '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801'
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const GET_CURRENT_BLOCK_TIMESTAMP = '0x0f28c97d' // getCurrentBlockTimestamp()
const FEE_PIPS = 3000n
const TOKENS = { decimals0: 18, decimals1: 18 }
const HTTP_LIMIT = 250 * 1024

let rpcCalls = 0
const rpc = async (method: string, params: unknown[]): Promise<any> => {
	for (let attempt = 0; attempt < 6; attempt++) {
		rpcCalls++
		try {
			const r = await fetch(RPC, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			})
			const j: any = await r.json()
			if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`)
			return j.result
		} catch (e) {
			if (attempt === 5) throw e
			await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)))
		}
	}
}
const hex = (n: bigint | number) => '0x' + BigInt(n).toString(16)

const blockTs = new Map<bigint, bigint>()
const timestampOf = async (n: bigint): Promise<bigint> => {
	const c = blockTs.get(n)
	if (c !== undefined) return c
	const b = await rpc('eth_getBlockByNumber', [hex(n), false])
	const t = BigInt(b.timestamp)
	blockTs.set(n, t)
	return t
}

/** First block with timestamp >= t. */
const blockAt = async (t: bigint): Promise<bigint> => {
	let lo = 15_537_394n // the merge; 12 s slots after it
	let hi = BigInt(await rpc('eth_blockNumber', []))
	if ((await timestampOf(hi)) < t) throw new Error('hour is in the future')
	while (lo < hi) {
		const mid = (lo + hi) / 2n
		if ((await timestampOf(mid)) < t) lo = mid + 1n
		else hi = mid
	}
	return lo
}

const multicallTimestamp = async (n: bigint): Promise<bigint> =>
	BigInt(await rpc('eth_call', [{ to: MULTICALL3, data: GET_CURRENT_BLOCK_TIMESTAMP }, hex(n)]))

const fetchKlines = async (symbol: string, tsFrom: bigint, tsTo: bigint) => {
	const url = klinesUrl(BINANCE, symbol, tsFrom, tsTo)
	const r = await fetch(url)
	const body = await r.text()
	if (r.status !== 200) throw new Error(`${symbol}: HTTP ${r.status} ${body.slice(0, 200)}`)
	return { url, bytes: Buffer.byteLength(body), klines: parseKlines(JSON.parse(body)), raw: JSON.parse(body) as any[][] }
}

/** Raw integer with `dec` decimals -> exact decimal literal (a JSON number Python parses correctly rounded). */
const units = (x: bigint, dec: number): string => {
	const neg = x < 0n
	const a = neg ? -x : x
	const s = a.toString().padStart(dec + 1, '0')
	return `${neg ? '-' : ''}${s.slice(0, s.length - dec)}.${s.slice(s.length - dec)}`
}

const runPython = (label: string, swaps: Swap[], timeOf: (s: Swap) => bigint, raw0: any[][], raw1: any[][], week: string) => {
	const dir = resolve(outDir, label)
	const cache = resolve(dir, 'klines')
	mkdirSync(cache, { recursive: true })
	// markout_pool.py's swaps.json: {"week", "swaps": [[t, amount0, amount1], ...]} in token units
	const rows = swaps.map((s) => `[${timeOf(s)},${units(s.amount0, 18)},${units(s.amount1, 18)}]`)
	writeFileSync(resolve(dir, 'swaps.json'), `{"pool":"${POOL.toLowerCase()}","week":"${week}","swaps":[${rows.join(',')}]}`)
	// its kline cache format: [[openTimeSeconds, open, close], ...] (pre-filled so it makes no network call)
	const cacheRows = (raw: any[][]) =>
		'[' + raw.map((k) => `[${Math.floor(Number(k[0]) / 1000)},${String(k[1])},${String(k[4])}]`).join(',') + ']'
	writeFileSync(resolve(cache, `UNIUSDT_1m_${week}.json`), cacheRows(raw0))
	writeFileSync(resolve(cache, `ETHUSDT_1m_${week}.json`), cacheRows(raw1))
	writeFileSync(resolve(dir, 'llama.json'), '{"data":[]}') // TVL/fee fields unused here
	const py = spawnSync(
		'python3',
		[
			resolve(repo, 'data/markout_pool.py'),
			resolve(dir, 'swaps.json'),
			'UNI',
			'ETH',
			'0.003',
			resolve(dir, 'llama.json'),
			cache,
		],
		{ encoding: 'utf8' },
	)
	if (py.status !== 0) throw new Error(`markout_pool.py failed: ${py.stderr}`)
	return JSON.parse(py.stdout.trim().split('\n').pop()!) as {
		swaps: number
		fees_usd: number
		lp_net_usd: number
		arb_loss_usd: number
		volume_usd: number
	}
}

const usd = (x: bigint) => Number(x) / 1e18
const fmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })

const main = async () => {
	const t0 = BigInt(Math.floor(Date.parse(HOUR) / 1000))
	if (t0 % 3600n !== 0n) throw new Error('--hour must be a whole UTC hour')
	const week = new Date(Number(t0) * 1000).toISOString().slice(0, 10)

	// 1. block span of the hour
	const fromBlock = await blockAt(t0)
	const toBlock = (await blockAt(t0 + 3600n)) - 1n
	const nBlocks = toBlock - fromBlock + 1n
	console.log(`hour ${HOUR}: blocks [${fromBlock}, ${toBlock}] (${nBlocks} blocks)`)

	// 2a. swap logs, <= 100-block chunks
	const chunks = chunkRange(fromBlock, toBlock, 100)
	if (chunks.length > MAX_LOG_CALLS) throw new Error(`${chunks.length} chunks > ${MAX_LOG_CALLS}`)
	const swaps: Swap[] = []
	const realTs = new Map<string, bigint>()
	for (const [a, b] of chunks) {
		const logs: any[] = await rpc('eth_getLogs', [{ address: POOL, topics: [V3_SWAP_TOPIC], fromBlock: hex(a), toBlock: hex(b) }])
		for (const l of logs) {
			if (l.removed) continue
			const s = decodeSwap('v3', l.data, BigInt(l.blockNumber), Number(l.logIndex), FEE_PIPS)
			swaps.push(s)
			const ts = l.blockTimestamp ? BigInt(l.blockTimestamp) : await timestampOf(s.blockNumber)
			realTs.set(`${s.blockNumber}:${s.logIndex}`, ts)
		}
	}
	console.log(`filterLogs-equivalent calls: ${chunks.length} (limit ${MAX_LOG_CALLS}); swaps: ${swaps.length}`)
	if (swaps.length === 0) throw new Error('no swaps in that hour; pick another --hour')

	// 2b. span timestamps via Multicall3 at historical blocks (cross-checked against headers)
	const tsFrom = await multicallTimestamp(fromBlock)
	const tsTo = await multicallTimestamp(toBlock)
	const hdrFrom = await timestampOf(fromBlock)
	const hdrTo = await timestampOf(toBlock)
	console.log(
		`Multicall3 timestamps: ${tsFrom} .. ${tsTo} (headers ${hdrFrom} .. ${hdrTo}: ${tsFrom === hdrFrom && tsTo === hdrTo ? 'match' : 'MISMATCH'})`,
	)

	// 2c. klines, the workflow's two GETs
	const kU = await fetchKlines('UNIUSDT', tsFrom, tsTo)
	const kE = await fetchKlines('ETHUSDT', tsFrom, tsTo)
	for (const [s, k] of [
		['UNIUSDT', kU],
		['ETHUSDT', kE],
	] as const) {
		console.log(`klines ${s}: ${k.klines.length} rows, ${k.bytes} bytes (limit ${HTTP_LIMIT}) ${k.bytes < HTTP_LIMIT ? 'ok' : 'OVER'}`)
	}

	// 3. TypeScript (the workflow's module)
	const interp = (s: Swap) => interpolateTimestamp(s.blockNumber, fromBlock, toBlock, tsFrom, tsTo)
	const real = (s: Swap) => realTs.get(`${s.blockNumber}:${s.logIndex}`)!
	const tsA = computeLvr(swaps, kU.klines, kE.klines, TOKENS, interp)
	const tsB = computeLvr(swaps, kU.klines, kE.klines, TOKENS, real)
	// markout_pool.py's volume is |a0|*P0 (UNI leg); spec §7.5's is |a1|*P_ETH. Compute the former too, for comparison.
	const vol0 = (k: Kline[], timeOf: (s: Swap) => bigint) =>
		swaps.reduce((acc, s) => {
			const v = (s.amount0 * priceTimes60(k, timeOf(s))) / (60n * WAD)
			return acc + (v < 0n ? -v : v)
		}, 0n)
	const maxInterpErr = swaps.reduce((m, s) => {
		const d = Number(interp(s) - real(s))
		return Math.max(m, Math.abs(d))
	}, 0)

	// 4. Python, unmodified data/markout_pool.py
	const pyA = runPython('A-interpolated', swaps, interp, kU.raw, kE.raw, week)
	const pyB = runPython('B-real-timestamps', swaps, real, kU.raw, kE.raw, week)

	const gross = usd(computeLvr(swaps, kU.klines, kE.klines, TOKENS, interp).volumeUsdWad) * 2 // scale for tolerance
	const tol = Math.max(1e-6, gross * 1e-12)
	let ok = true
	const row = (name: string, a: number, b: number) => {
		const d = a - b
		const pass = Math.abs(d) <= tol
		ok &&= pass
		console.log(`  ${name.padEnd(28)} TS ${fmt(a).padStart(18)}   PY ${fmt(b).padStart(18)}   diff ${d.toExponential(2).padStart(10)}  ${pass ? 'PASS' : 'FAIL'}`)
	}
	for (const [label, t, p, timeOf] of [
		['A: interpolated timestamps (what the workflow does)', tsA, pyA, interp],
		['B: real block timestamps', tsB, pyB, real],
	] as const) {
		console.log(`\n${label}`)
		if (p.swaps !== t.nSwaps) {
			ok = false
			console.log(`  swap count TS ${t.nSwaps} vs PY ${p.swaps}: FAIL`)
		}
		row('fees (USD)', usd(t.feesUsdWad), p.fees_usd)
		row('LP net = value (USD)', usd(t.valueUsdWad), p.lp_net_usd)
		row('LVR = fees - value (USD)', usd(t.lvrUsdWad), p.arb_loss_usd)
		row('volume |a0|*P_UNI (USD)', usd(vol0(kU.klines, timeOf)), p.volume_usd)
		console.log(`  volume |a1|*P_ETH (spec §7.5, reported) ${fmt(usd(t.volumeUsdWad))}`)
	}
	console.log(`  tolerance: |diff| <= ${tol.toExponential(2)} USD`)

	console.log(`\nInterpolation effect (TS A vs TS B), max per-swap time error ${maxInterpErr} s:`)
	console.log(`  LVR    A ${formatWad(tsA.lvrUsdWad, 2)}  B ${formatWad(tsB.lvrUsdWad, 2)}  diff ${formatWad(tsA.lvrUsdWad - tsB.lvrUsdWad, 2)}`)
	console.log(`  volume A ${formatWad(tsA.volumeUsdWad, 2)}  B ${formatWad(tsB.volumeUsdWad, 2)}  diff ${formatWad(tsA.volumeUsdWad - tsB.volumeUsdWad, 2)}`)
	console.log(`\nreport the workflow would write for this span:`)
	console.log(
		`  (fromBlock ${fromBlock}, toBlock ${toBlock}, toTimestamp ${tsTo}, lvrUsdWad ${tsA.lvrUsdWad}, volumeUsdWad ${tsA.volumeUsdWad}, nSwaps ${tsA.nSwaps})`,
	)
	console.log(`\nRPC calls made by this script: ${rpcCalls} (the workflow itself needs 1 + ${chunks.length} + 2 EVM reads, 2 HTTP)`)
	console.log(ok ? '\nRESULT: PASS (TypeScript module == data/markout_pool.py within tolerance)' : '\nRESULT: FAIL')
	process.exit(ok ? 0 : 1)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
