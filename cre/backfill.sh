#!/usr/bin/env bash
# Backfill (spec §8): run the CRE simulation repeatedly until TremorReceiver.lastProcessedBlock()
# reaches TARGET_BLOCK. Each run measures <= blocksPerRun (1,200) blocks and writes one report
# through the MockKeystoneForwarder on the Anvil fork.
#
# usage: ./backfill.sh <target-block> [max-runs]
# env:   RPC_URL   (default http://127.0.0.1:8545)
#        RECEIVER  (default: "receiver" in tremor-lvr/config.fork.json)
#        CRE_ETH_PRIVATE_KEY in cre/.env (see README.md)
# needs: cre (logged in), curl, node
set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:?usage: ./backfill.sh <target-block> [max-runs]}"
MAX_RUNS="${2:-200}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
CONFIG="tremor-lvr/config.fork.json"

[[ "$TARGET" =~ ^[0-9]+$ ]] || { echo "target block must be a number" >&2; exit 2; }
[ -f "$CONFIG" ] || { echo "$CONFIG not found; run: bun run scripts/make-config.ts" >&2; exit 2; }

cfg() { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))['$1']))"; }
RECEIVER="${RECEIVER:-$(cfg receiver)}"
MAX_TO="$(cfg maxToBlock)"
if [ "$MAX_TO" != "0" ] && [ "$TARGET" -gt "$MAX_TO" ]; then
  echo "target $TARGET is past maxToBlock $MAX_TO in $CONFIG; the workflow would never reach it" >&2
  exit 2
fi

# lastProcessedBlock() selector 0x33de61d2
last_processed() {
  local out
  out=$(curl -sf -X POST -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$RECEIVER\",\"data\":\"0x33de61d2\"},\"latest\"]}" \
    "$RPC_URL") || { echo "RPC $RPC_URL unreachable" >&2; return 1; }
  node -e "const r=JSON.parse(process.argv[1]); if(r.error||!r.result||r.result==='0x'){console.error(JSON.stringify(r.error||r));process.exit(1)}; console.log(BigInt(r.result).toString())" "$out"
}

last=$(last_processed)
echo "receiver $RECEIVER lastProcessedBlock=$last target=$TARGET"
runs=0
while [ "$last" -lt "$TARGET" ]; do
  runs=$((runs + 1))
  if [ "$runs" -gt "$MAX_RUNS" ]; then
    echo "stopping after $MAX_RUNS runs (lastProcessedBlock=$last)" >&2
    exit 1
  fi
  echo "=== run $runs: lastProcessedBlock=$last"
  cre workflow simulate ./tremor-lvr --target fork-settings \
    --broadcast --non-interactive --trigger-index 0
  prev="$last"
  last=$(last_processed)
  if [ "$last" -le "$prev" ]; then
    echo "lastProcessedBlock did not advance ($prev -> $last); stopping" >&2
    exit 1
  fi
done
echo "done: lastProcessedBlock=$last >= $TARGET after $runs run(s)"
