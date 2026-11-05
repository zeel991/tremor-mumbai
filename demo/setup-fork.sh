#!/usr/bin/env bash
# Deploy Tremor to a LOCAL anvil fork of Ethereum mainnet and write contracts/deployments/fork.json.
# Start the fork first:   anvil --fork-url <mainnet rpc> --chain-id 1 --compute-units-per-second 150 --retries 12
# Uses anvil's public test account #0 (local only) and impersonates the Uniswap timelock for demo UNI.
set -euo pipefail
RPC=${RPC:-http://127.0.0.1:8545}
PK=${PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}   # anvil test key #0
DEPLOYER=$(cast wallet address --private-key "$PK")
UNI=0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
WHALE=0x1a9C8182C09F50C8318d769245beA52c32BE35BC   # Uniswap timelock (holds UNI)
cd "$(cd "$(dirname "$0")" && pwd)/../contracts"

[ "$(cast chain-id --rpc-url "$RPC")" = "1" ] || { echo "expected a chainId-1 mainnet fork at $RPC"; exit 1; }
cast rpc anvil_impersonateAccount "$WHALE" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$WHALE" 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null   # 100 ETH for gas
cast send "$UNI" "transfer(address,uint256)" "$DEPLOYER" 300000ether --from "$WHALE" --unlocked --rpc-url "$RPC" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$WHALE" --rpc-url "$RPC" >/dev/null
echo "funded $DEPLOYER with UNI: $(cast call $UNI 'balanceOf(address)(uint256)' $DEPLOYER --rpc-url $RPC)"

forge script script/DeployFork.s.sol:DeployFork --rpc-url "$RPC" --private-key "$PK" --broadcast --slow -vv 2>&1 | grep -E "hook mined|wrote|Error|error|ONCHAIN|Total Paid" || true
test -f deployments/fork.json && cat deployments/fork.json
