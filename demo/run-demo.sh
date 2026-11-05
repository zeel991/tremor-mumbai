#!/usr/bin/env bash
# Tremor end-to-end demo on the LOCAL anvil mainnet fork (docs/spec.md §10 F2-F6, §13). Prints a tx hash per step.
# Prereq: anvil fork running + demo/setup-fork.sh done (contracts/deployments/fork.json exists).
# One-shot: run once per fresh deploy (the replay window is finalized at the end).
# F2 option: if the CRE CLI is logged in, run cre/backfill.sh instead of the forwarder-delivered reports below.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC=${RPC:-http://127.0.0.1:8545}
OWNER_PK=${OWNER_PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}   # anvil test key #0
TRADER_PK=${TRADER_PK:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}  # anvil test key #1
TRADER=$(cast wallet address --private-key "$TRADER_PK")
D="$ROOT/contracts/deployments/fork.json"
j() { jq -r "$1" "$D"; }
WETH=$(j .weth); UNI=$(j .uni); PM=$(j .poolManager); MARKET=$(j .market); ROUTER=$(j .router)
VAULT=$(j .vault); HOOK=$(j .hook); RECEIVER=$(j .receiver); OPER=$(j .poolOperator); FWD=$(j .creForwarder)
LIVE=$(j .windows.live); OCT=$(j .windows.oct2025)
KEY="($(j .poolKey.currency0),$(j .poolKey.currency1),$(j .poolKey.fee),$(j .poolKey.tickSpacing),$(j .poolKey.hooks))"
KEYT="(address,address,uint24,int24,address)"

tx() { # label, then cast send args; prints the hash
  local label=$1; shift
  local h; h=$(cast send "$@" --rpc-url "$RPC" --json | jq -r .transactionHash)
  printf "  %-58s %s\n" "$label" "$h"
}
show() { printf "  %-58s %s\n" "$1" "$2"; }

echo "== F2  CRE measurement -> premium (3 measured weeks of UNI/WETH 0.3%, delivered through the CRE forwarder)"
R="$ROOT/demo/measured-reports.json"
FIRST=$(jq -r '.reports[0].fromBlock' "$R")
if [ "$(cast call "$RECEIVER" 'lastProcessedBlock()(uint64)' --rpc-url "$RPC")" = "0" ]; then
  tx "receiver.setStartBlock($((FIRST-1)))" "$RECEIVER" "setStartBlock(uint64)" $((FIRST-1)) --private-key "$OWNER_PK"
fi
cast rpc anvil_impersonateAccount "$FWD" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$FWD" 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null
LAST_DONE=$(cast call "$RECEIVER" 'lastProcessedBlock()(uint64)' --rpc-url "$RPC" | awk '{print $1}')
for i in 0 1 2; do
  r=$(jq -c ".reports[$i]" "$R")
  if [ "$(jq -r .toBlock <<<"$r")" -le "$LAST_DONE" ]; then show "week $(jq -r .week <<<"$r") already delivered" "(skip)"; continue; fi
  rep=$(cast abi-encode "f(uint64,uint64,uint64,int256,uint256,uint32)" \
    "$(jq -r .fromBlock <<<"$r")" "$(jq -r .toBlock <<<"$r")" "$(jq -r .toTimestamp <<<"$r")" \
    "$(jq -r .lvrUsdWad <<<"$r")" "$(jq -r .volumeUsdWad <<<"$r")" "$(jq -r .nSwaps <<<"$r")")
  tx "onReport week $(jq -r .week <<<"$r") (LP net \$$(jq -r .lpNetUsd <<<"$r"))" "$RECEIVER" "onReport(bytes,bytes)" 0x "$rep" --from "$FWD" --unlocked
  show "  -> hook premium (pips)" "$(cast call "$HOOK" 'premiumPips()(uint24)' --rpc-url "$RPC")"
done
cast rpc anvil_stopImpersonatingAccount "$FWD" --rpc-url "$RPC" >/dev/null

echo "== F3  swaps on the Tremor UNI/WETH v4 pool pay the hook fee"
cast send "$WETH" "deposit()" --value 50ether --private-key "$TRADER_PK" --rpc-url "$RPC" >/dev/null
cast send "$UNI" "transfer(address,uint256)" "$TRADER" 40000ether --private-key "$OWNER_PK" --rpc-url "$RPC" >/dev/null
cast send "$UNI" "approve(address,uint256)" "$OPER" $(cast max-uint) --private-key "$TRADER_PK" --rpc-url "$RPC" >/dev/null
cast send "$WETH" "approve(address,uint256)" "$OPER" $(cast max-uint) --private-key "$TRADER_PK" --rpc-url "$RPC" >/dev/null
for k in 1 2 3; do
  tx "swap 5,000 UNI -> WETH" "$OPER" "swapExactIn($KEYT,bool,uint256)" "$KEY" true 5000ether --private-key "$TRADER_PK"
  tx "swap 12 WETH -> UNI" "$OPER" "swapExactIn($KEYT,bool,uint256)" "$KEY" false 12ether --private-key "$TRADER_PK"
done
WETH_ID=$(cast to-dec "$WETH"); UNI_ID=$(cast to-dec "$UNI")
show "hook ERC-6909 claims WETH (wei)" "$(cast call "$PM" 'balanceOf(address,uint256)(uint256)' "$HOOK" "$WETH_ID" --rpc-url "$RPC")"
show "hook ERC-6909 claims UNI (wei)" "$(cast call "$PM" 'balanceOf(address,uint256)(uint256)' "$HOOK" "$UNI_ID" --rpc-url "$RPC")"

echo "== F4  handleHookFees: redeem claims, UNI->WETH, buy LONG cover on Aqua via SwapVM instruction 0x22"
cast rpc evm_increaseTime 3601 --rpc-url "$RPC" >/dev/null; cast rpc evm_mine --rpc-url "$RPC" >/dev/null
tx "hook.handleHookFees([])" "$HOOK" "handleHookFees(address[])" "[]" --private-key "$TRADER_PK"
OCT_LONG=$(cast call "$MARKET" 'window(uint256)((uint64,uint64,uint256,uint256,uint256,uint16,uint80,uint256,uint64,uint256,uint256,bool,uint256,address,address))' "$OCT" --rpc-url "$RPC" | tr -d '()' | awk -F', ' '{print $14}')
show "hook LONG held (Oct-2025 replay window)" "$(cast call "$OCT_LONG" 'balanceOf(address)(uint256)' "$HOOK" --rpc-url "$RPC")"

echo "== Trader on the live window: quote then swap WETH -> LONG through 0x22 (taker traits: exact-in + transferFrom&AquaPush)"
LIVE_LONG=$(cast call "$MARKET" 'window(uint256)((uint64,uint64,uint256,uint256,uint256,uint16,uint80,uint256,uint64,uint256,uint256,bool,uint256,address,address))' "$LIVE" --rpc-url "$RPC" | tr -d '()' | awk -F', ' '{print $14}')
ORDER=$(cast call "$VAULT" 'currentOrder(uint256)((address,uint256,bytes))' "$LIVE" --rpc-url "$RPC" | sed 's/ \[[^]]*\]//g')
# slicesIndexes as uint160 (10 x uint16, all = threshold length), then uint16 flags 0x0061
Q_TRAITS="0x$(printf '%040x' 0)0061"
QUOTE=$(cast call "$ROUTER" 'quote((address,uint256,bytes),address,address,uint256,bytes)(uint256,uint256,bytes32)' "$ORDER" "$WETH" "$LIVE_LONG" 1ether "$Q_TRAITS" --rpc-url "$RPC")
OUT=$(echo "$QUOTE" | sed -n 2p | awk '{print $1}')
MIN=$(python3 -I -c "print(int('$OUT')*99//100)")
S_TRAITS="0x$(python3 -I -c "print('%040x' % sum(32<<s for s in range(0,160,16)))")0061$(cast to-uint256 "$MIN" | sed 's/^0x//')"
show "router.quote 1 WETH -> LONG" "$OUT"
cast send "$WETH" "approve(address,uint256)" "$ROUTER" $(cast max-uint) --private-key "$TRADER_PK" --rpc-url "$RPC" >/dev/null
tx "router.swap 1 WETH -> LONG (min out = quote - 1%)" "$ROUTER" "swap((address,uint256,bytes),address,address,uint256,bytes)" "$ORDER" "$WETH" "$LIVE_LONG" 1ether "$S_TRAITS" --private-key "$TRADER_PK"
show "trader LONG balance" "$(cast call "$LIVE_LONG" 'balanceOf(address)(uint256)' "$TRADER" --rpc-url "$RPC")"

echo "== F5  settle the Oct-2025 window from real Chainlink UNI/ETH rounds, pay LPs"
for n in 1 2 3; do tx "market.checkpoint(oct, 64)" "$MARKET" "checkpoint(uint256,uint256)" "$OCT" 64 --private-key "$TRADER_PK"; done
tx "market.finalize(oct)" "$MARKET" "finalize(uint256)" "$OCT" --private-key "$TRADER_PK"
tx "hook.setDripBlocks(10) (demo: short drip)" "$HOOK" "setDripBlocks(uint64)" 10 --private-key "$OWNER_PK"
tx "hook.claimPayout(oct)" "$HOOK" "claimPayout(uint256)" "$OCT" --private-key "$TRADER_PK"
show "payout WETH scheduled for LPs" "$(cast call "$HOOK" 'dripTotal()(uint256)' --rpc-url "$RPC")"
for _ in $(seq 1 10); do cast rpc evm_mine --rpc-url "$RPC" >/dev/null; done   # 10 blocks
tx "hook.drip() -> PoolManager.donate to in-range LPs" "$HOOK" "drip()" --private-key "$TRADER_PK"
show "donated so far" "$(cast call "$HOOK" 'dripDone()(uint256)' --rpc-url "$RPC")"

echo "== F6  writer closes and settles the replay window"
tx "vault.closeWindow(oct) (Aqua dock)" "$VAULT" "closeWindow(uint256)" "$OCT" --private-key "$OWNER_PK"
tx "vault.settle(oct)" "$VAULT" "settle(uint256)" "$OCT" --private-key "$OWNER_PK"
echo "done"
