// Hand-written ABI fragments, used only for contracts whose Foundry artifact
// (contracts/out/<C>.sol/<C>.json) does not exist yet. `npm run sync` prefers the real artifact.
//
// Sources:
//  - market / vault / hook / receiver: contracts/src/interfaces/ITremor.sol
//  - router quote/swap/Swapped: swap-vm v1.0.2 src/SwapVM.sol:111-162 (both are `nonpayable` in the
//    implementation; ISwapVM declares quote `view`. We only eth_call quote, so either works).
//  - router errors: swap-vm v1.0.2 libs/TakerTraits.sol, SwapVM.sol, plus Tremor's own (spec §6.2/§6.3)
//  - ERC-20 / ERC-6909: standard.
//
// RE-CHECK once real ABIs exist: see the list in the web/ hand-off notes (hook getters, receiver
// event field order, router custom-instruction errors).
import { parseAbi, type Abi } from "viem";

export const marketAbi: Abi = parseAbi([
  "struct WindowView { uint64 t0; uint64 t1; uint256 S; uint256 vCap; uint256 vFwd; uint16 phaseId; uint80 lastRound; uint256 lastAnswer; uint64 lastUpdatedAt; uint256 q; uint256 setsOutstanding; bool finalized; uint256 payoutLong; address long; address short; }",
  "function WETH() view returns (address)",
  "function window(uint256 id) view returns (WindowView)",
  "function windowCount() view returns (uint256)",
  "function projectedVariance(uint256 id) view returns (uint256)",
  "function quote(uint256 id, uint8 side, bool takerBuys, bool exactIn, uint256 amount, int256 skewUnits) view returns (uint256 amountIn, uint256 amountOut)",
  "event WindowCreated(uint256 indexed id, uint64 t0, uint64 t1, address long, address short, uint16 phaseId, uint256 p0)",
  "event Finalized(uint256 indexed id, uint256 variance, uint256 payoutLong)",
  "error WindowTooShort()",
  "error PastWindow()",
  "error NotFinalized()",
  "error AlreadyFinalized()",
  "error TooEarly()",
  "error PhaseChanged()",
  "error BadRound(uint80 roundId)",
  "error NoQuote()",
  "error InsufficientInventory()",
  "error UnknownWindow()",
]);

export const vaultAbi: Abi = parseAbi([
  "function currentOrderEncoded(uint256 id) view returns (bytes)",
  "function strategyHash(uint256 id) view returns (bytes32)",
  "event WindowOpened(uint256 indexed id, bytes32 strategyHash, uint256 nSets, uint256 wethForBuybacks)",
  "event WindowClosed(uint256 indexed id, bytes32 strategyHash)",
]);

export const hookAbi: Abi = parseAbi([
  "function premiumPips() view returns (uint24)",
  "function premiumValidUntil() view returns (uint64)",
  "event PremiumSet(uint24 pips, uint64 validUntil)",
  "event CoverBought(uint256 indexed windowId, uint256 wethIn, uint256 longOut)",
  "event PayoutClaimed(uint256 indexed windowId, uint256 wethOut)",
  "event Dripped(uint256 amount, uint256 remaining)",
]);

export const receiverAbi: Abi = parseAbi([
  "function lastProcessedBlock() view returns (uint64)",
  "event Measured(uint64 fromBlock, uint64 toBlock, int256 lvrUsdWad, uint256 volumeUsdWad, uint32 nSwaps, uint256 epoch)",
  "event EpochClosed(uint256 indexed epoch, int256 lvrUsdWad, uint256 volumeUsdWad, uint24 pips)",
]);

export const routerAbi: Abi = parseAbi([
  "struct Order { address maker; uint256 traits; bytes data; }",
  "function quote(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
  "function swap(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
  "function hash(Order order) view returns (bytes32)",
  "event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
  "error TakerTraitsMissingTraits()",
  "error TakerTraitsInsufficientMinOutputAmount(uint256 amountOut, uint256 amountOutMin)",
  "error TakerTraitsAmountOutMustBeGreaterThanZero(uint256 amountOut)",
  "error TakerTraitsTakerAmountInMismatch(uint256 takerAmount, uint256 computedAmount)",
  "error TakerTraitsDeadlineExpired()",
  "error AquaBalanceInsufficientAfterTakerPush(uint256 balanceIn, uint256 originalBalanceIn, uint256 amountIn, uint256 amountNetPulled)",
  "error DeadlineReached(address taker, uint256 deadline)",
  "error SafeTransferFromFailed()",
]);

export const erc20Abi: Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

// Uniswap v4 PoolManager is ERC-6909: `mapping(owner => mapping(id => balance)) public balanceOf`
// (v4-core src/ERC6909.sol:17). The id of a currency's claim is uint256(uint160(currency)).
export const erc6909Abi: Abi = parseAbi(["function balanceOf(address owner, uint256 id) view returns (uint256)"]);
