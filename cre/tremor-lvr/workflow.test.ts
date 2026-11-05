// Runs the workflow handler against the SDK's test runtime (mocked EVM + HTTP capabilities):
// checks the call budget (spec §8), the filterLogs queries, and that the written report equals
// lvr.ts on the same inputs. `bun test` from cre/tremor-lvr.
import { describe, expect } from 'bun:test'
import { bigintToProtoBigInt, bytesToHex, hexToBase64, protoBigIntToBigint, TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters, toHex } from 'viem'
import { computeLvr, decodeSwap, interpolateTimestamp, parseKlines, V3_SWAP_TOPIC, V4_SWAP_TOPIC } from './lvr'
import { type Config, initWorkflow, onCronTrigger } from './workflow'

const MAINNET = 5009297550715157269n
const RECEIVER = '0x00000000000000000000000000000000000000aa'
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const V3_POOL = '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801'
const PM = '0x000000000004444c5dc75cB358380D2e3dE08A90'
const POOL_ID = '0x' + '11'.repeat(32)

const base = {
	schedule: '0 0 * * * *',
	chainSelectorName: 'ethereum-mainnet',
	isTestnet: false,
	receiver: RECEIVER,
	multicall3: MULTICALL3,
	gasLimit: '1000000',
	startBlock: 20_000_000,
	maxToBlock: 30_000_000,
	blocksPerRun: 1200,
	logChunk: 100,
	binanceBaseUrl: 'https://api.binance.com',
}
const tokens = { klineSymbol0: 'UNIUSDT', klineSymbol1: 'ETHUSDT', decimals0: 18, decimals1: 18 }
const v3Config: Config = { ...base, source: { kind: 'v3', pool: V3_POOL, feePips: 3000, ...tokens } }
const v4Config: Config = { ...base, source: { kind: 'v4', poolManager: PM, poolId: POOL_ID, ...tokens } }

const LAST = 20_000_000n
const T0 = 1_760_130_011n // timestamp of block LAST+1
const tsOf = (b: bigint) => T0 + (b - (LAST + 1n)) * 12n

// synthetic candles: UNI ~ $6.5, ETH ~ $3800, moving every minute
const klineRows = (sym: string) => {
	const rows: unknown[][] = []
	const start = Number((T0 / 60n) * 60n) - 120
	for (let i = 0; i < 300; i++) {
		const p = sym === 'UNIUSDT' ? 6.5 + 0.013 * Math.sin(i / 7) : 3800 + 9 * Math.cos(i / 5)
		const q = p * (1 + 0.0007 * Math.sin(i))
		rows.push([(start + 60 * i) * 1000, p.toFixed(8), '0', '0', q.toFixed(8), '0', 0, '0', 0, '0', '0', '0'])
	}
	return rows
}

const v3Data = (a0: bigint, a1: bigint) =>
	encodeAbiParameters(parseAbiParameters('int256, int256, uint160, uint128, int24'), [a0, a1, 1n, 1n, 0])
const v4Data = (a0: bigint, a1: bigint, fee: number) =>
	encodeAbiParameters(parseAbiParameters('int128, int128, uint160, uint128, int24, uint24'), [a0, a1, 1n, 1n, 0, fee])

const E18 = 10n ** 18n
// [block, data] pool-perspective for v3; swapper-perspective for v4
const v3Logs: Array<[bigint, `0x${string}`]> = [
	[LAST + 5n, v3Data(1000n * E18, -(17n * E18) / 10n)], // pool received UNI, paid ETH
	[LAST + 650n, v3Data(-(400n * E18), (69n * E18) / 100n)], // pool paid UNI, received ETH
	[LAST + 1199n, v3Data(25n * E18, -(4n * E18) / 100n)],
]
const v4Logs: Array<[bigint, `0x${string}`]> = [
	[LAST + 7n, v4Data(-(1000n * E18), (17n * E18) / 10n, 3000)],
	[LAST + 900n, v4Data(400n * E18, -(69n * E18) / 100n, 500)],
]

const install = (config: Config, logs: Array<[bigint, `0x${string}`]>) => {
	const calls = { lastProcessed: 0, timestamp: 0, filterLogs: 0, http: 0, write: 0 }
	const ranges: Array<[bigint, bigint]> = []
	const filters: { addresses: string[]; topics: string[][] }[] = []
	let written: Uint8Array | undefined
	const evm = EvmMock.testInstance(MAINNET)
	evm.callContract = (req) => {
		const to = bytesToHex(req.call!.to).toLowerCase()
		if (to === RECEIVER) {
			calls.lastProcessed++
			return { data: hexToBase64(encodeAbiParameters(parseAbiParameters('uint64'), [LAST])) }
		}
		if (to === MULTICALL3.toLowerCase()) {
			calls.timestamp++
			const b = protoBigIntToBigint(req.blockNumber!)
			return { data: hexToBase64(encodeAbiParameters(parseAbiParameters('uint256'), [tsOf(b)])) }
		}
		throw new Error(`unexpected callContract to ${to}`)
	}
	evm.filterLogs = (req) => {
		calls.filterLogs++
		const q = req.filterQuery!
		const a = protoBigIntToBigint(q.fromBlock!)
		const b = protoBigIntToBigint(q.toBlock!)
		ranges.push([a, b])
		filters.push({ addresses: q.addresses.map(bytesToHex), topics: q.topics.map((t) => t.topic.map(bytesToHex)) })
		return {
			logs: logs
				.filter(([blk]) => blk >= a && blk <= b)
				.map(([blk, data], i) => ({ data: hexToBase64(data), blockNumber: bigintToProtoBigInt(blk), index: i })),
		}
	}
	evm.writeReport = (req) => {
		calls.write++
		written = req.report!.rawReport
		return { txStatus: TxStatus.SUCCESS, txHash: hexToBase64(toHex(new Uint8Array(32).fill(1))) }
	}
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		calls.http++
		const sym = new URL(req.url).searchParams.get('symbol')!
		return { statusCode: 200, body: Buffer.from(JSON.stringify(klineRows(sym))).toString('base64') }
	}
	const runtime = newTestRuntime<Config>(null, undefined, config)
	return { runtime, calls, ranges, filters, report: () => written }
}

const decodeReport = (raw: Uint8Array) =>
	decodeAbiParameters(
		parseAbiParameters('uint64, uint64, uint64, int256, uint256, uint32'),
		bytesToHex(raw.slice(REPORT_METADATA_HEADER_LENGTH)),
	)

const expected = (config: Config, logs: Array<[bigint, `0x${string}`]>) => {
	const from = LAST + 1n
	const to = LAST + 1200n
	const kind = config.source.kind
	const swaps = logs.map(([b, d], i) => decodeSwap(kind, d, b, i, 3000n))
	return computeLvr(swaps, parseKlines(klineRows('UNIUSDT')), parseKlines(klineRows('ETHUSDT')), tokens, (s) =>
		interpolateTimestamp(s.blockNumber, from, to, tsOf(from), tsOf(to)),
	)
}

describe('tremor-lvr workflow', () => {
	test('v3: call budget, filter queries, report == lvr.ts', () => {
		const { runtime, calls, ranges, filters, report } = install(v3Config, v3Logs)
		onCronTrigger(runtime, {} as never)
		expect(calls).toEqual({ lastProcessed: 1, timestamp: 2, filterLogs: 12, http: 2, write: 1 })
		// 12 contiguous <= 100-block chunks covering [LAST+1, LAST+1200]
		expect(ranges[0][0]).toBe(LAST + 1n)
		expect(ranges[11][1]).toBe(LAST + 1200n)
		for (let i = 0; i < ranges.length; i++) {
			expect(ranges[i][1] - ranges[i][0] + 1n <= 100n).toBe(true)
			if (i > 0) expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1n)
		}
		expect(filters[0].addresses[0].toLowerCase()).toBe(V3_POOL.toLowerCase())
		expect(filters[0].topics).toEqual([[V3_SWAP_TOPIC]])
		const [from, to, toTs, lvr, vol, n] = decodeReport(report()!)
		const e = expected(v3Config, v3Logs)
		expect([from, to, toTs]).toEqual([LAST + 1n, LAST + 1200n, tsOf(LAST + 1200n)])
		expect(lvr).toBe(e.lvrUsdWad)
		expect(vol).toBe(e.volumeUsdWad)
		expect(n).toBe(3)
		expect(e.volumeUsdWad > 0n).toBe(true)
	})

	test('v4: id topic filter, swapper-perspective amounts negated, per-swap fee', () => {
		const { runtime, calls, filters, report } = install(v4Config, v4Logs)
		onCronTrigger(runtime, {} as never)
		expect(calls.filterLogs).toBe(12)
		expect(filters[0].addresses[0].toLowerCase()).toBe(PM.toLowerCase())
		expect(filters[0].topics).toEqual([[V4_SWAP_TOPIC], [POOL_ID]])
		const [, , , lvr, vol, n] = decodeReport(report()!)
		const e = expected(v4Config, v4Logs)
		expect(lvr).toBe(e.lvrUsdWad)
		expect(vol).toBe(e.volumeUsdWad)
		expect(n).toBe(2)
		// negation: the first v4 swap is the pool *receiving* 1000 UNI
		const s = decodeSwap('v4', v4Logs[0][1], v4Logs[0][0], 0, 0n)
		expect(s.amount0).toBe(1000n * E18)
		expect(s.feePips).toBe(3000n)
	})

	test('caught up: no write past maxToBlock', () => {
		const { runtime, calls } = install({ ...v3Config, maxToBlock: Number(LAST) }, v3Logs)
		expect(onCronTrigger(runtime, {} as never)).toBe('caught-up')
		expect(calls).toEqual({ lastProcessed: 1, timestamp: 0, filterLogs: 0, http: 0, write: 0 })
	})

	test('initWorkflow wires one cron handler', () => {
		const h = initWorkflow(v3Config)
		expect(h).toHaveLength(1)
		expect(h[0].fn).toBe(onCronTrigger)
	})
})
