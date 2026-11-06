#!/usr/bin/env bash
# One CRE run against Sepolia: measure the next span of the Tremor tUNI/WETH pool (live mode: up to head - 64
# confirmed blocks, at most 1,100 blocks per run) and write a report
# through the Sepolia MockKeystoneForwarder. Uses CRE_ETH_PRIVATE_KEY from ../sepolia.env (git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
ENVF="$(cd .. && pwd)/sepolia.env"
[ -f "$ENVF" ] || { echo "missing $ENVF"; exit 1; }
set -a; . "$ENVF"; set +a
export SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
export PATH="$HOME/.cre/bin:$PATH"
bun run scripts/make-config.ts --network sepolia >/dev/null
cre workflow simulate ./tremor-lvr --target sepolia-settings --broadcast --non-interactive --trigger-index 0 -e "$ENVF" 2>&1 \
  | grep -E "USER LOG|Result|rror|failed"
