// Tremor CRE workflow (docs/spec.md §8): measure one block span of the source pool's arbitrage
// loss (LVR) and volume, and write it to TremorReceiver.
//
// Per execution (CRE limits: 15 EVM reads, 15 HTTP calls, 100 blocks per filterLogs):
//   1  callContract  TremorReceiver.lastProcessedBlock()                       (EVM read 1)
//   1b callContract  Multicall3.getBlockNumber() at latest  (live mode only: confirmations > 0)
//   2  filterLogs    Swap logs of [from, to], <= 12 chunks of <= 100 blocks    (EVM reads 2..13;
//                    11 chunks in live mode, so the head read stays inside the budget)
//   3  callContract  Multicall3.getCurrentBlockTimestamp() at `from` and `to`  (EVM reads 14, 15)
// Live mode caps each span at head - confirmations, so a report never covers blocks that can still reorg
// (lastProcessedBlock cannot be rolled back). Backfill mode (confirmations = 0) uses the fixed maxToBlock cap.
//   4  HTTP GET      Binance 1m klines for token0 and token1                   (HTTP 1, 2; node mode)
//   5  §7.5 maths in node mode (lvr.ts); consensus: every field identical
//   6  runtime.report + writeReport to TremorReceiver
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	cre,
	encodeCallMsg,
	getNetwork,
	hexToBase64,
	identical,
	LATEST_BLOCK_NUMBER,
	type NodeRuntime,
	prepareReportRequest,
	protoBigIntToBigint,
	blockNumber as protoBlockNumber,
	type Runtime,
	text,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	type Hex,
	parseAbi,
	parseAbiParameters,
	zeroAddress,
} from 'viem'
import { z } from 'zod'
import {
	checkCoverage,
	chunkRange,
	computeLvr,
	decodeSwap,
	formatWad,
	interpolateTimestamp,
	klinesUrl,
	MAX_LOG_CALLS,
	MAX_LOG_CHUNK,
	parseKlines,
	type Swap,
	V3_SWAP_TOPIC,
	V4_SWAP_TOPIC,
} from './lvr'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const tokenFields = {
	klineSymbol0: z.string(), // Binance symbol pricing token0 in USDT, e.g. UNIUSDT
	klineSymbol1: z.string(), // e.g. ETHUSDT
	decimals0: z.number().int().min(0).max(36),
	decimals1: z.number().int().min(0).max(36),
}

export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	isTestnet: z.boolean(),
	receiver: address,
	multicall3: address,
	gasLimit: z.string(),
	// first block to measure when the receiver has not processed anything yet (lastProcessedBlock == 0)
	startBlock: z.number().int().positive(),
	// never measure past this block (the fork block on Anvil). 0 = no cap.
	maxToBlock: z.number().int().min(0),
	// live mode: measure only up to head - confirmations (reorg-safe). 0 = backfill mode (no head read).
	confirmations: z.number().int().min(0).max(10_000).default(0),
	blocksPerRun: z.number().int().positive().max(MAX_LOG_CALLS * MAX_LOG_CHUNK),
	logChunk: z.number().int().positive().max(MAX_LOG_CHUNK),
	binanceBaseUrl: z.string().regex(/^https?:\/\/[^\s/]+$/), // not .url(): it fails inside the CRE WASM runtime
	source: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('v3'), pool: address, feePips: z.number().int().min(0).max(1_000_000), ...tokenFields }),
		z.object({ kind: z.literal('v4'), poolManager: address, poolId: bytes32, ...tokenFields }),
	]),
})

export type Config = z.infer<typeof configSchema>

const RECEIVER_ABI = parseAbi(['function lastProcessedBlock() view returns (uint64)'])
const MULTICALL3_ABI = parseAbi([
	'function getCurrentBlockTimestamp() view returns (uint256 timestamp)',
	'function getBlockNumber() view returns (uint256 blockNumber)',
])
const REPORT_PARAMS = parseAbiParameters('uint64, uint64, uint64, int256, uint256, uint32')

/** What every node returns; consensus requires all six fields to be identical. */
type Measurement = {
	fromBlock: bigint
	toBlock: bigint
	toTimestamp: bigint
	lvrUsdWad: bigint
	volumeUsdWad: bigint
	nSwaps: bigint
}

const evmClientFor = (config: Config) => {
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.chainSelectorName,
		isTestnet: config.isTestnet,
	})
	if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

type EVM = ReturnType<typeof evmClientFor>

const readLastProcessedBlock = (runtime: Runtime<Config>, evm: EVM): bigint => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: runtime.config.receiver as Address,
				data: encodeFunctionData({ abi: RECEIVER_ABI, functionName: 'lastProcessedBlock' }),
			}),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()
	return decodeFunctionResult({ abi: RECEIVER_ABI, functionName: 'lastProcessedBlock', data: bytesToHex(reply.data) })
}

const readBlockTimestamp = (runtime: Runtime<Config>, evm: EVM, block: bigint): bigint => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: runtime.config.multicall3 as Address,
				data: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: 'getCurrentBlockTimestamp' }),
			}),
			blockNumber: protoBlockNumber(block),
		})
		.result()
	return decodeFunctionResult({
		abi: MULTICALL3_ABI,
		functionName: 'getCurrentBlockTimestamp',
		data: bytesToHex(reply.data),
	})
}

const readHeadBlock = (runtime: Runtime<Config>, evm: EVM): bigint => {
	const reply = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: runtime.config.multicall3 as Address,
				data: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: 'getBlockNumber' }),
			}),
			blockNumber: LATEST_BLOCK_NUMBER,
		})
		.result()
	return decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: 'getBlockNumber', data: bytesToHex(reply.data) })
}

/** Log-call budget for this run: one fewer in live mode, which spends a read on the head block. */
export const logCallBudget = (cfg: Pick<Config, 'confirmations'>): number =>
	(cfg.confirmations ?? 0) > 0 ? MAX_LOG_CALLS - 1 : MAX_LOG_CALLS

const readSwaps = (runtime: Runtime<Config>, evm: EVM, from: bigint, to: bigint): Swap[] => {
	const src = runtime.config.source
	const emitter = src.kind === 'v3' ? src.pool : src.poolManager
	const topics =
		src.kind === 'v3'
			? [{ topic: [hexToBase64(V3_SWAP_TOPIC)] }]
			: [{ topic: [hexToBase64(V4_SWAP_TOPIC)] }, { topic: [hexToBase64(src.poolId)] }]
	const v3Fee = src.kind === 'v3' ? BigInt(src.feePips) : 0n

	const chunks = chunkRange(from, to, runtime.config.logChunk)
	const budget = logCallBudget(runtime.config)
	if (chunks.length > budget) throw new Error(`span needs ${chunks.length} filterLogs calls (> ${budget})`)

	const swaps: Swap[] = []
	for (const [a, b] of chunks) {
		const reply = evm
			.filterLogs(runtime, {
				filterQuery: {
					addresses: [hexToBase64(emitter)],
					topics,
					fromBlock: protoBlockNumber(a),
					toBlock: protoBlockNumber(b),
				},
			})
			.result()
		for (const log of reply.logs) {
			if (log.removed) continue
			if (!log.blockNumber) throw new Error('log without blockNumber')
			swaps.push(decodeSwap(src.kind, bytesToHex(log.data), protoBigIntToBigint(log.blockNumber), log.index, v3Fee))
		}
	}
	swaps.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1))
	return swaps
}

/** Node mode: two Binance GETs, then the §7.5 sum. Only six integers leave the node. */
const measureInNode = (
	nodeRuntime: NodeRuntime<Config>,
	swaps: Swap[],
	fromBlock: bigint,
	toBlock: bigint,
	tsFrom: bigint,
	tsTo: bigint,
): Measurement => {
	const src = nodeRuntime.config.source
	if (swaps.length === 0) {
		return { fromBlock, toBlock, toTimestamp: tsTo, lvrUsdWad: 0n, volumeUsdWad: 0n, nSwaps: 0n }
	}
	const http = new cre.capabilities.HTTPClient()
	const fetchKlines = (symbol: string) => {
		const url = klinesUrl(nodeRuntime.config.binanceBaseUrl, symbol, tsFrom, tsTo)
		const resp = http.sendRequest(nodeRuntime, { url, method: 'GET' }).result()
		if (resp.statusCode !== 200) throw new Error(`klines ${symbol}: HTTP ${resp.statusCode}`)
		const k = parseKlines(JSON.parse(text(resp)))
		checkCoverage(k, tsFrom, tsTo, symbol)
		return k
	}
	const k0 = fetchKlines(src.klineSymbol0)
	const k1 = fetchKlines(src.klineSymbol1)
	const r = computeLvr(swaps, k0, k1, { decimals0: src.decimals0, decimals1: src.decimals1 }, (s) =>
		interpolateTimestamp(s.blockNumber, fromBlock, toBlock, tsFrom, tsTo),
	)
	return {
		fromBlock,
		toBlock,
		toTimestamp: tsTo,
		lvrUsdWad: r.lvrUsdWad,
		volumeUsdWad: r.volumeUsdWad,
		nSwaps: BigInt(r.nSwaps),
	}
}

export const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
	const cfg = runtime.config
	const evm = evmClientFor(cfg)

	// 1. where the receiver left off
	const last = readLastProcessedBlock(runtime, evm)
	const fromBlock = last === 0n ? BigInt(cfg.startBlock) : last + 1n
	const maxSpan = BigInt(Math.min(cfg.blocksPerRun, logCallBudget(cfg) * cfg.logChunk))
	let toBlock = fromBlock + maxSpan - 1n
	if (cfg.maxToBlock > 0 && toBlock > BigInt(cfg.maxToBlock)) toBlock = BigInt(cfg.maxToBlock)
	let safeHead = -1n
	if ((cfg.confirmations ?? 0) > 0) {
		safeHead = readHeadBlock(runtime, evm) - BigInt(cfg.confirmations)
		if (toBlock > safeHead) toBlock = safeHead
	}
	if (toBlock < fromBlock) {
		runtime.log(
			`caught up: lastProcessedBlock=${last}, maxToBlock=${cfg.maxToBlock}, safeHead=${safeHead}; nothing to write`,
		)
		return 'caught-up'
	}
	runtime.log(`span [${fromBlock}, ${toBlock}] (${toBlock - fromBlock + 1n} blocks), lastProcessedBlock=${last}`)

	// 2. swaps
	const swaps = readSwaps(runtime, evm, fromBlock, toBlock)
	runtime.log(`swaps: ${swaps.length}`)

	// 3. span timestamps
	const tsFrom = readBlockTimestamp(runtime, evm, fromBlock)
	const tsTo = readBlockTimestamp(runtime, evm, toBlock)
	if (tsTo < tsFrom) throw new Error('timestamps out of order')
	runtime.log(`timestamps: ${tsFrom} .. ${tsTo}`)

	// 4-5. prices + maths in node mode, consensus on identical integers
	const m = runtime
		.runInNodeMode(
			measureInNode,
			ConsensusAggregationByFields<Measurement>({
				fromBlock: identical,
				toBlock: identical,
				toTimestamp: identical,
				lvrUsdWad: identical,
				volumeUsdWad: identical,
				nSwaps: identical,
			}),
		)(swaps, fromBlock, toBlock, tsFrom, tsTo)
		.result()
	runtime.log(
		`measured: lvr=$${formatWad(m.lvrUsdWad, 2)} volume=$${formatWad(m.volumeUsdWad, 2)} nSwaps=${m.nSwaps} toTimestamp=${m.toTimestamp}`,
	)

	// 6. report
	const payload: Hex = encodeAbiParameters(REPORT_PARAMS, [
		m.fromBlock,
		m.toBlock,
		m.toTimestamp,
		m.lvrUsdWad,
		m.volumeUsdWad,
		Number(m.nSwaps),
	])
	const report = runtime.report(prepareReportRequest(payload)).result()
	const write = evm
		.writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
		.result()
	if (write.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: ${write.errorMessage || write.txStatus}`)
	}
	const txHash = bytesToHex(write.txHash || new Uint8Array(32))
	runtime.log(`report written: tx ${txHash}`)
	return `${m.fromBlock}-${m.toBlock} lvr=${m.lvrUsdWad} vol=${m.volumeUsdWad} n=${m.nSwaps} tx=${txHash}`
}

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}
