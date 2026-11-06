#!/usr/bin/env bash
# Drive every step of Tremor on Sepolia, one command per step, against contracts/deployments/sepolia.json.
# Uses CRE_ETH_PRIVATE_KEY from sepolia.env (git-ignored); the key is never printed.
#
#   status   what the contracts say right now
#   arb      arbitrage the pool to the market price (Binance UNI/ETH) and set the test UNI/ETH feed to it
#   cre      one CRE workflow run (cre/run-sepolia.sh): measures the next confirmed span, writes a report
#   swaps    N round-trip swaps (default 3) of 0.0005 WETH; they pay the hook fee once it is set
#   cover    hook.handleHookFees(): redeem fee claims, convert tUNI to WETH, buy LONG on Aqua through 0x22
#   settle   checkpoint every Chainlink ETH/USD round, finalize the window, claim the payout, drip it to LPs
#
# Typical order: arb, (wait ~15 min) cre, (after the epoch boundary + ~15 min) cre, swaps, cover, (after t1 + 1 h) settle
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/sepolia.env"
[ -f "$ENVF" ] || { echo "missing $ENVF"; exit 1; }
set -a; . "$ENVF"; set +a
RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
D="$ROOT/contracts/deployments/sepolia.json"
j() { jq -r "$1" "$D"; }
HOOK=$(j .hook); MARKET=$(j .market); RECEIVER=$(j .receiver); VAULT=$(j .vault); ROUTER=$(j .router)
OP=$(j .poolOperator); WETH=$(j .weth); TUNI=$(j .uni); FEED=$(j .uniEthFeed); PM=$(j .poolManager)
ID=$(j .windows.live); POOLID=$(j .poolId)
KEY="($(j .poolKey.currency0),$(j .poolKey.currency1),$(j .poolKey.fee),$(j .poolKey.tickSpacing),$(j .poolKey.hooks))"
ME=$(cast wallet address --private-key "$CRE_ETH_PRIVATE_KEY")
AUTH=(--private-key "$CRE_ETH_PRIVATE_KEY" --rpc-url "$RPC")
redact() { sed "s/${CRE_ETH_PRIVATE_KEY#0x}/<key>/g"; }

send() { # send <label> <to> <sig> [args...]
  local label=$1; shift
  local out
  if out=$(cast send "$@" "${AUTH[@]}" --json 2>&1); then
    echo "  $label: $(echo "$out" | jq -r '.status + " " + .transactionHash')"
  else
    echo "  $label FAILED: $(echo "$out" | redact | tail -3)"; return 1
  fi
}
call() { cast call "$@" --rpc-url "$RPC"; }
binance_price() { # WETH per UNI, WAD, from Binance UNIUSDT / ETHUSDT
  python3 -I -c "
import json,urllib.request
g=lambda s: float(json.load(urllib.request.urlopen('https://data-api.binance.vision/api/v3/ticker/price?symbol='+s))['price'])
print(int(g('UNIUSDT')/g('ETHUSDT')*1e18))"
}
sqrt_x96() { python3 -I -c "from math import isqrt; print(isqrt($1 * 2**192 // 10**18))"; }
pool_sqrt() { # slot0 of the pool: extsload(keccak(poolId . 6)), low 160 bits
  local slot; slot=$(cast keccak "$(cast abi-encode 'f(bytes32,uint256)' "$POOLID" 6)")
  python3 -I -c "print(int('$(call "$PM" 'extsload(bytes32)(bytes32)' "$slot")',16) & ((1<<160)-1))"
}

case "${1:-status}" in
status)
  NOW=$(cast block --rpc-url "$RPC" -f timestamp)
  W=$(call "$MARKET" "window(uint256)((uint64,uint64,uint256,uint256,uint256,uint16,uint80,uint256,uint64,uint256,uint256,bool,uint256,address,address))" "$ID")
  T0=$(echo "$W" | tr -d '()' | cut -d, -f1 | awk '{print $1}'); T1=$(echo "$W" | tr -d '()' | cut -d, -f2 | awk '{print $1}')
  echo "now $NOW | window $ID: opens in $(( (T0-NOW)/60 )) min, closes in $(( (T1-NOW)/60 )) min (t1=$T1)"
  echo "caughtUp $(call "$MARKET" 'caughtUp(uint256)(bool)' "$ID") | finalized $(echo "$W" | tr -d '()' | cut -d, -f12)"
  echo "receiver: lastProcessedBlock $(call "$RECEIVER" 'lastProcessedBlock()(uint64)') epoch $(call "$RECEIVER" 'currentEpoch()(uint256)') pendingPips $(call "$RECEIVER" 'pendingPips()(uint24)')"
  echo "epoch 0 closes at $(( $(j .epochOrigin) + 604800 )) (in $(( ($(j .epochOrigin) + 604800 - NOW)/60 )) min)"
  echo "hook: premiumPips $(call "$HOOK" 'premiumPips()(uint24)') validUntil $(call "$HOOK" 'premiumValidUntil()(uint64)') coverHeld $(call "$HOOK" 'coverHeld(uint256)(bool)' "$ID")"
  LONG=$(echo "$W" | tr -d '()' | cut -d, -f14 | tr -d ' ')
  echo "hook LONG $(call "$LONG" 'balanceOf(address)(uint256)' "$HOOK") | dripped $(call "$HOOK" 'dripDone()(uint256)') of $(call "$HOOK" 'dripTotal()(uint256)')"
  echo "pool sqrtPriceX96 $(pool_sqrt) | market price $(sqrt_x96 "$(binance_price)")"
  ;;
arb)
  P=$(binance_price); TARGET=$(sqrt_x96 "$P"); CUR=$(pool_sqrt)
  echo "Binance UNI/ETH $P (WAD); pool sqrtPriceX96 $CUR -> $TARGET"
  if python3 -c "import sys; sys.exit(0 if $TARGET < $CUR else 1)"; then Z=true; else Z=false; fi
  send "approve tUNI" "$TUNI" "approve(address,uint256)" "$OP" "$(cast max-uint)"
  send "approve WETH" "$WETH" "approve(address,uint256)" "$OP" "$(cast max-uint)"
  send "arbitrage swap to market price" "$OP" "swapToPrice((address,address,uint24,int24,address),bool,uint160)" "$KEY" "$Z" "$TARGET"
  send "test UNI/ETH feed -> market price" "$FEED" "setAnswer(int256)" "$P"
  ;;
cre)
  "$ROOT/cre/run-sepolia.sh"
  ;;
swaps)
  N=${2:-3}
  for i in $(seq 1 "$N"); do
    send "swap 0.0005 WETH -> tUNI" "$OP" "swapExactIn((address,address,uint24,int24,address),bool,uint256)" "$KEY" false 500000000000000
    send "swap 1 tUNI -> WETH" "$OP" "swapExactIn((address,address,uint24,int24,address),bool,uint256)" "$KEY" true 1000000000000000000
  done
  ;;
cover)
  send "hook.handleHookFees" "$HOOK" "handleHookFees(address[])" "[]"
  ;;
settle)
  for k in 1 2 3; do send "market.checkpoint" "$MARKET" "checkpoint(uint256,uint256)" "$ID" 64 || true; done
  send "market.finalize" "$MARKET" "finalize(uint256)" "$ID"
  send "hook.claimPayout" "$HOOK" "claimPayout(uint256)" "$ID" || true
  send "hook.setDripBlocks(2)" "$HOOK" "setDripBlocks(uint64)" 2
  sleep 30
  send "hook.drip (donate to LPs)" "$HOOK" "drip()" || true
  send "vault.settle" "$VAULT" "settle(uint256)" "$ID"
  ;;
*) echo "unknown step $1"; exit 1 ;;
esac
