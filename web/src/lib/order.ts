import { decodeAbiParameters, type Address, type Hex } from "viem";

export type Order = { maker: Address; traits: bigint; data: Hex };

// ISwapVM.Order = (address maker, MakerTraits traits /* uint256 */, bytes data).
// TremorVault.currentOrderEncoded(id) returns abi.encode(order) (ITremor.sol), i.e. a single tuple.
const ORDER_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "maker", type: "address" },
      { name: "traits", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

export function decodeOrder(encoded: Hex): Order {
  const [o] = decodeAbiParameters(ORDER_PARAMS, encoded);
  return { maker: o.maker, traits: o.traits, data: o.data };
}
