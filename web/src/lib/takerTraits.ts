// TypeScript port of TakerTraitsLib.build from 1inch swap-vm v1.0.2,
// contracts/lib/swap-vm/src/libs/TakerTraits.sol. Followed line by line:
//
//   :93-99    flag constants (IS_EXACT_IN 0x0001 ... USE_TRANSFER_FROM_AND_AQUA_PUSH 0x0040)
//   :106      threshold must be 0 or 32 bytes
//   :108-113  callback data requires the matching has*Callback flag
//   :115-124  cumulative slice end offsets index0..index9 (index3 applies toUint16 to the
//             length only; index4..9 apply it to the sum - reproduced below)
//   :126-137  slicesIndexes = OR of uint160(index_k) << (16 * k), inside uint160
//   :139-159  abi.encodePacked(uint160 slicesIndexes, uint16 flags, threshold, to?, deadline?,
//             hook data x4, callback data x2, instructionsArgs, signature)
//
// The parser (:167-170) reads the first 22 bytes as uint176: low 16 bits = flags, the next
// 160 bits = slice indexes. So a bare "0x" is NOT a valid takerTraitsAndData: SwapVM.quote/swap
// call TakerTraitsLib.parse first (SwapVM.sol:120, :166) and revert with TakerTraitsMissingTraits.
// isExactIn is read from these flags (SwapVM.sol:121), so quotes must set IS_EXACT_IN too.
//
// In Aqua mode the router pulls the taker's input only when USE_TRANSFER_FROM_AND_AQUA_PUSH is
// set (SwapVM.sol:234-238: safeTransferFrom(taker -> router), then AQUA.push). Without it the swap
// reverts with AquaBalanceInsufficientAfterTakerPush (SwapVM.sol:239-240). The taker therefore
// approves the ROUTER for tokenIn.
import { concat, encodePacked, getAddress, size, toHex, type Address, type Hex } from "viem";

export const IS_EXACT_IN_BIT_FLAG = 0x0001;
export const SHOULD_UNWRAP_BIT_FLAG = 0x0002;
export const HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG = 0x0004;
export const HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG = 0x0008;
export const IS_STRICT_THRESHOLD_BIT_FLAG = 0x0010;
export const IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG = 0x0020;
export const USE_TRANSFER_FROM_AND_AQUA_PUSH_FLAG = 0x0040;

export type TakerTraitsArgs = {
  taker: Address;
  isExactIn: boolean;
  shouldUnwrapWeth: boolean;
  isStrictThresholdAmount: boolean;
  isFirstTransferFromTaker: boolean;
  useTransferFromAndAquaPush: boolean;
  threshold: Hex; // "0x" or 32 bytes
  to: Address; // zero address = taker
  deadline: number; // uint40, 0 = none
  hasPreTransferInCallback: boolean;
  hasPreTransferOutCallback: boolean;
  preTransferInHookData: Hex;
  postTransferInHookData: Hex;
  preTransferOutHookData: Hex;
  postTransferOutHookData: Hex;
  preTransferInCallbackData: Hex;
  preTransferOutCallbackData: Hex;
  instructionsArgs: Hex;
  signature: Hex;
};

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const MASK160 = (1n << 160n) - 1n;
const U16_MAX = 0xffff;

function toUint16(n: number): number {
  // OpenZeppelin SafeCast.toUint16 reverts on overflow
  if (n > U16_MAX) throw new Error(`SafeCastOverflowedUintDowncast(16, ${n})`);
  return n;
}

export function buildTakerTraits(args: TakerTraitsArgs): Hex {
  const thresholdLen = size(args.threshold);
  if (thresholdLen !== 32 && thresholdLen !== 0) throw new Error("TakerTraitsThresholdLengthInvalid");
  if (size(args.preTransferInCallbackData) > 0 && !args.hasPreTransferInCallback) throw new Error("TakerTraitsMissingHasPreTransferInFlag");
  if (size(args.preTransferOutCallbackData) > 0 && !args.hasPreTransferOutCallback) throw new Error("TakerTraitsMissingHasPreTransferOutFlag");

  const hasTo = getAddress(args.to) !== ZERO && getAddress(args.to) !== getAddress(args.taker);
  const hasDeadline = args.deadline !== 0;

  const index0 = thresholdLen;
  const index1 = index0 + (hasTo ? 20 : 0);
  const index2 = index1 + (hasDeadline ? 5 : 0);
  const index3 = index2 + toUint16(size(args.preTransferInHookData));
  const index4 = toUint16(index3 + size(args.postTransferInHookData));
  const index5 = toUint16(index4 + size(args.preTransferOutHookData));
  const index6 = toUint16(index5 + size(args.postTransferOutHookData));
  const index7 = toUint16(index6 + size(args.preTransferInCallbackData));
  const index8 = toUint16(index7 + size(args.preTransferOutCallbackData));
  const index9 = toUint16(index8 + size(args.instructionsArgs));

  const idx = [index0, index1, index2, index3, index4, index5, index6, index7, index8, index9];
  // uint160(index_k) << (16k), evaluated in uint160 (bits above 160 are dropped, as in Solidity)
  const slicesIndexes = idx.reduce((acc, v, k) => acc | (((BigInt(v) & MASK160) << BigInt(16 * k)) & MASK160), 0n);

  const flags =
    (args.isExactIn ? IS_EXACT_IN_BIT_FLAG : 0) |
    (args.shouldUnwrapWeth ? SHOULD_UNWRAP_BIT_FLAG : 0) |
    (args.isStrictThresholdAmount ? IS_STRICT_THRESHOLD_BIT_FLAG : 0) |
    (args.isFirstTransferFromTaker ? IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG : 0) |
    (args.useTransferFromAndAquaPush ? USE_TRANSFER_FROM_AND_AQUA_PUSH_FLAG : 0) |
    (args.hasPreTransferInCallback ? HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG : 0) |
    (args.hasPreTransferOutCallback ? HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG : 0);

  return concat([
    encodePacked(["uint160", "uint16"], [slicesIndexes, flags]),
    args.threshold,
    hasTo ? encodePacked(["address"], [getAddress(args.to)]) : "0x",
    hasDeadline ? encodePacked(["uint40"], [args.deadline]) : "0x",
    args.preTransferInHookData,
    args.postTransferInHookData,
    args.preTransferOutHookData,
    args.postTransferOutHookData,
    args.preTransferInCallbackData,
    args.preTransferOutCallbackData,
    args.instructionsArgs,
    args.signature,
  ]);
}

const base = (taker: Address): TakerTraitsArgs => ({
  taker,
  isExactIn: true,
  shouldUnwrapWeth: false,
  isStrictThresholdAmount: false,
  isFirstTransferFromTaker: false,
  useTransferFromAndAquaPush: true,
  threshold: "0x",
  to: ZERO,
  deadline: 0,
  hasPreTransferInCallback: false,
  hasPreTransferOutCallback: false,
  preTransferInHookData: "0x",
  postTransferInHookData: "0x",
  preTransferOutHookData: "0x",
  postTransferOutHookData: "0x",
  preTransferInCallbackData: "0x",
  preTransferOutCallbackData: "0x",
  instructionsArgs: "0x",
  signature: "0x",
});

/** Exact-in, Aqua transferFrom+push, no threshold. Used for quotes (22 bytes). */
export function quoteTraits(taker: Address = ZERO): Hex {
  return buildTakerTraits(base(taker));
}

/** Exact-in, Aqua transferFrom+push, minimum output `minOut` (54 bytes). Used for swaps. */
export function exactInSwapTraits(taker: Address, minOut: bigint): Hex {
  return buildTakerTraits({ ...base(taker), threshold: toHex(minOut, { size: 32 }) });
}

/** threshold = floor(amountOut * (1 - slippageBps / 10_000)). Default 1%. */
export function minOutWithSlippage(amountOut: bigint, slippageBps = 100n): bigint {
  return (amountOut * (10_000n - slippageBps)) / 10_000n;
}
