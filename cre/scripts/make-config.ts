// Writes cre/tremor-lvr/config.fork.json from contracts/deployments/fork.json.
//
// usage: bun run scripts/make-config.ts [--source v3|v4] [--start-block N] [--max-to-block N]
//                                       [--blocks-per-run N] [--deployment path] [--out path]
//
//   --source        v3 (default): the real UNI/WETH 0.3% v3 pool (fork.json refV3Pool), spec §8 "fork demo".
//                   v4: the Tremor v4 pool via PoolManager + poolId (amounts negated, fee from the event).
//   --start-block   first block to measure if TremorReceiver.lastProcessedBlock() == 0 (default: forkBlock).
//                   If the owner already called receiver.setStartBlock(), this value is never used.
//   --max-to-block  never measure past this block (default: forkBlock).
//   --network       fork (default) or sepolia. sepolia reads deployments/sepolia.json, writes
//                   tremor-lvr/config.sepolia.json, uses the v4 source (the Tremor tUNI/WETH pool) and the
//                   ethereum-testnet-sepolia chain. Sepolia runs in live mode by default: no fixed cap
//                   (maxToBlock 0) and each span ends at head - confirmations.
//   --confirmations live mode: blocks behind the head that are never measured (default 64 on sepolia, 0 on fork).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const creDir = resolve(here, '..')

const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11'
const V3_POOL = '0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801'
const POOL_MANAGER = '0x000000000004444c5dc75cb358380d2e3de08a90'

const args = process.argv.slice(2)
const opt = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`)
	return i >= 0 ? args[i + 1] : undefined
}
const intOpt = (name: string): number | undefined => {
	const v = opt(name)
	if (v === undefined) return undefined
	const n = Number(v)
	if (!Number.isSafeInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`)
	return n
}

const network = opt('network') ?? 'fork'
if (network !== 'fork' && network !== 'sepolia') throw new Error('--network must be fork or sepolia')
const sepolia = network === 'sepolia'
const deploymentPath = resolve(opt('deployment') ?? resolve(creDir, `../contracts/deployments/${network}.json`))
const outPath = resolve(opt('out') ?? resolve(creDir, `tremor-lvr/config.${network}.json`))
const sourceKind = sepolia ? 'v4' : (opt('source') ?? 'v3')
if (sourceKind !== 'v3' && sourceKind !== 'v4') throw new Error('--source must be v3 or v4')

if (!existsSync(deploymentPath)) {
	console.error(`not found: ${deploymentPath}\nThe contracts deployment (DeployFork.s.sol) writes it; run that first.`)
	process.exit(1)
}
const d = JSON.parse(readFileSync(deploymentPath, 'utf8'))

const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)
const need = (k: string): unknown => {
	if (d[k] === undefined || d[k] === null) throw new Error(`fork.json is missing "${k}"`)
	return d[k]
}
const addr = (k: string): string => {
	const v = need(k)
	if (!isAddr(v)) throw new Error(`fork.json "${k}" is not an address: ${String(v)}`)
	return v
}
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const wantChain = sepolia ? 11155111 : 1
if (Number(need('chainId')) !== wantChain) throw new Error(`expected chainId ${wantChain}, got ${d.chainId}`)
const forkBlock = Number(need('forkBlock'))
if (!Number.isSafeInteger(forkBlock) || forkBlock <= 0) throw new Error(`bad forkBlock ${d.forkBlock}`)

const receiver = addr('receiver')
const multicall3 = isAddr(d.multicall3) ? d.multicall3 : MULTICALL3
if (!eq(multicall3, MULTICALL3)) console.warn(`warning: fork.json multicall3 ${multicall3} != canonical ${MULTICALL3}`)
// On Sepolia the pool is test UNI / Sepolia WETH; both are priced with Binance UNIUSDT / ETHUSDT.
const uniAddr = sepolia ? addr('uni') : UNI
const wethAddr = sepolia ? addr('weth') : WETH
if (isAddr(d.uni) && !eq(d.uni, uniAddr)) throw new Error(`deployment uni ${d.uni} != ${uniAddr}`)
if (isAddr(d.weth) && !eq(d.weth, wethAddr)) throw new Error(`deployment weth ${d.weth} != ${wethAddr}`)

// UNI/WETH: token0 = UNI (18 dec), token1 = WETH (18 dec), priced by Binance UNIUSDT / ETHUSDT
const tokens = { klineSymbol0: 'UNIUSDT', klineSymbol1: 'ETHUSDT', decimals0: 18, decimals1: 18 }

let source: Record<string, unknown>
if (sourceKind === 'v3') {
	const pool = isAddr(d.refV3Pool) ? d.refV3Pool : V3_POOL
	if (!eq(pool, V3_POOL)) console.warn(`warning: refV3Pool ${pool} != spec §4 pool ${V3_POOL}`)
	source = { kind: 'v3', pool, feePips: 3000, ...tokens }
} else {
	const poolManager = sepolia ? addr('poolManager') : isAddr(d.poolManager) ? d.poolManager : POOL_MANAGER
	const poolId = need('poolId')
	if (typeof poolId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(poolId)) throw new Error(`bad poolId ${poolId}`)
	const pk = d.poolKey ?? {}
	if (isAddr(pk.currency0) && !eq(pk.currency0, uniAddr)) throw new Error(`poolKey.currency0 ${pk.currency0} is not UNI`)
	if (isAddr(pk.currency1) && !eq(pk.currency1, wethAddr)) throw new Error(`poolKey.currency1 ${pk.currency1} is not WETH`)
	source = { kind: 'v4', poolManager, poolId, ...tokens }
}

const blocksPerRun = intOpt('blocks-per-run') ?? 1200
if (blocksPerRun < 1 || blocksPerRun > 1200) throw new Error('--blocks-per-run must be 1..1200 (12 filterLogs x 100 blocks)')

const config = {
	schedule: '0 0 * * * *',
	chainSelectorName: sepolia ? 'ethereum-testnet-sepolia' : 'ethereum-mainnet',
	isTestnet: sepolia,
	receiver,
	multicall3,
	gasLimit: '5000000', // epoch close also calls hook.setPremium + market.checkpoint(…, 64); CRE cap is 10M
	startBlock: intOpt('start-block') ?? forkBlock,
	maxToBlock: intOpt('max-to-block') ?? (sepolia ? 0 : forkBlock),
	confirmations: intOpt('confirmations') ?? (sepolia ? 64 : 0),
	blocksPerRun,
	logChunk: 100,
	binanceBaseUrl: 'https://api.binance.com',
	source,
}

writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n')
console.log(`wrote ${outPath}`)
console.log(JSON.stringify(config, null, 2))
if (d.windows) console.log(`fork.json windows (for choosing --start-block): ${JSON.stringify(d.windows)}`)
