// Checks src/lib/takerTraits.ts against bytes produced by the Solidity original,
// TakerTraitsLib.build (swap-vm v1.0.2, contracts/lib/swap-vm/src/libs/TakerTraits.sol:105-160),
// run under forge 1.8.1 / solc 0.8.30 with the same inputs. Run: npm run check:traits
import { toHex, type Address, type Hex } from "viem";
import { buildTakerTraits, exactInSwapTraits, quoteTraits, type TakerTraitsArgs } from "../src/lib/takerTraits.ts";

const SOLIDITY: Hex[] = [
  "0x00000000000000000000000000000000000000000041",
  "0x002000200020002000200020002000200020002000410000000000000000000000000000000000000000000000000db4da5f49f8b478",
  "0x002000200020002000200020002000200020002000410000000000000000000000000000000000000000000000000db4da5f49f8b478",
  "0x0047004300420040003f003c003a003900340020007f000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000b200690d9da00102030405060708090a0b0c0d0eff",
];

const taker: Address = "0x00000000000000000000000000000000000000a1";
const base: TakerTraitsArgs = {
  taker, isExactIn: true, shouldUnwrapWeth: false, isStrictThresholdAmount: false, isFirstTransferFromTaker: false,
  useTransferFromAndAquaPush: true, threshold: "0x", to: "0x0000000000000000000000000000000000000000", deadline: 0,
  hasPreTransferInCallback: false, hasPreTransferOutCallback: false,
  preTransferInHookData: "0x", postTransferInHookData: "0x", preTransferOutHookData: "0x", postTransferOutHookData: "0x",
  preTransferInCallbackData: "0x", preTransferOutCallbackData: "0x", instructionsArgs: "0x", signature: "0x",
};

const ours: Hex[] = [
  // 1: quote traits (exact-in + Aqua transferFrom/push, no threshold)
  quoteTraits(taker),
  // 2: swap traits, min output 987654321098765432
  exactInSwapTraits(taker, 987654321098765432n),
  // 3: same with to == taker (must be omitted)
  buildTakerTraits({ ...base, threshold: toHex(987654321098765432n, { size: 32 }), to: taker }),
  // 4: every flag and every slice populated
  buildTakerTraits({
    ...base,
    shouldUnwrapWeth: true, isStrictThresholdAmount: true, isFirstTransferFromTaker: true,
    hasPreTransferInCallback: true, hasPreTransferOutCallback: true,
    threshold: toHex(7n, { size: 32 }), to: "0x00000000000000000000000000000000000000b2", deadline: 1762500000,
    preTransferInHookData: "0x01", postTransferInHookData: "0x0203", preTransferOutHookData: "0x040506",
    postTransferOutHookData: "0x07", preTransferInCallbackData: "0x0809", preTransferOutCallbackData: "0x0a",
    instructionsArgs: "0x0b0c0d0e", signature: "0xff",
  }),
];

let fail = 0;
ours.forEach((o, i) => {
  const ok = o.toLowerCase() === SOLIDITY[i].toLowerCase();
  if (!ok) fail++;
  console.log(`vector ${i + 1}: ${ok ? "MATCH" : "MISMATCH"}${ok ? "" : `\n  sol ${SOLIDITY[i]}\n  ts  ${o}`}`);
});
process.exit(fail ? 1 : 0);
