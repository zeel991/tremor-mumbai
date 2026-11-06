#!/usr/bin/env bash
# Deploy Tremor to Sepolia and write contracts/deployments/sepolia.json.
#
# Needs sepolia.env at the repo root (git-ignored) with:
#   CRE_ETH_PRIVATE_KEY=0x<a Sepolia key holding >= 0.1 Sepolia ETH>
#   SEPOLIA_RPC=https://...            (optional; default publicnode)
# The same key signs the CRE reports (cre/run-sepolia.sh). This script never prints it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/sepolia.env"
[ -f "$ENVF" ] || { echo "missing $ENVF: create it with CRE_ETH_PRIVATE_KEY=0x<funded Sepolia key>"; exit 1; }
set -a; . "$ENVF"; set +a
: "${CRE_ETH_PRIVATE_KEY:?CRE_ETH_PRIVATE_KEY is not set in sepolia.env}"
RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"

[ "$(cast chain-id --rpc-url "$RPC")" = "11155111" ] || { echo "$RPC is not Sepolia"; exit 1; }
DEPLOYER=$(cast wallet address --private-key "$CRE_ETH_PRIVATE_KEY")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
echo "deployer $DEPLOYER: $(cast from-wei "$BAL") Sepolia ETH"
python3 -c "import sys; sys.exit(0 if $BAL >= 90*10**15 else 1)" || { echo "need >= 0.09 Sepolia ETH (0.075 becomes WETH for liquidity and collateral)"; exit 1; }

# The test pool starts at the live mainnet Chainlink UNI/ETH price.
PRICE=$(cast call 0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e "latestRoundData()(uint80,int256,uint256,uint256,uint80)" \
  --rpc-url https://ethereum-rpc.publicnode.com | sed -n 2p | awk '{print $1}')
echo "pool start price (mainnet UNI/ETH, WAD): $PRICE"

cd "$ROOT/contracts"
# 1) Simulate against live Sepolia state (sends nothing) and write deployments/sepolia.json.
UNI_ETH_PRICE="$PRICE" forge script script/DeploySepolia.s.sol --rpc-url "$RPC" --private-key "$CRE_ETH_PRIVATE_KEY" -vv 2>&1 \
  | grep -E "hook mined|wrote|Error|error|revert|SIMULATION" || true
# 2) Send the planned transactions with the node's own gas estimates. Sepolia reprices state-growth gas
#    (contract deployments cost ~4-7x the local simulation), so forge's --broadcast gas limits run out of gas.
node "$ROOT/demo/send-planned.mjs" broadcast/DeploySepolia.s.sol/11155111/dry-run/run-latest.json "$RPC"
test -f deployments/sepolia.json && jq '{uni, market, router, vault, hook, receiver, poolId, windows, forkBlock}' deployments/sepolia.json
echo "explorer: https://sepolia.etherscan.io/address/$(jq -r .hook deployments/sepolia.json)"
