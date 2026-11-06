#!/usr/bin/env node
// Send a forge script's planned transactions one by one with the NODE's gas estimate (x1.3), in order.
// Why: Sepolia reprices state-growth gas (a WETH deposit estimates ~134k there), so forge's local gas
// limits run out of gas. Addresses still match the simulation: same sender, same nonce order.
//
// usage: node demo/send-planned.mjs <dry-run run-latest.json> <rpc>   (key from CRE_ETH_PRIVATE_KEY env)
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [file, rpc] = process.argv.slice(2);
const key = process.env.CRE_ETH_PRIVATE_KEY;
if (!file || !rpc || !key) throw new Error("usage: node send-planned.mjs <run-latest.json> <rpc> (CRE_ETH_PRIVATE_KEY in env)");
const plan = JSON.parse(readFileSync(file, "utf8")).transactions;
const cast = (args) => execFileSync("cast", args, { encoding: "utf8", env: { ...process.env, CRE_ETH_PRIVATE_KEY: "" } }).trim();
const rpcCall = (method, params) => JSON.parse(cast(["rpc", method, ...params.map((p) => JSON.stringify(p)), "--rpc-url", rpc]));

const from = plan[0].transaction.from;
let nonce = Number(cast(["nonce", from, "--rpc-url", rpc]));
if (nonce !== Number(plan[0].transaction.nonce)) throw new Error(`account nonce ${nonce} != planned ${Number(plan[0].transaction.nonce)}; re-simulate`);

for (const [i, t] of plan.entries()) {
  const tx = t.transaction;
  const call = { from: tx.from, data: tx.input, value: tx.value ?? "0x0", ...(tx.to ? { to: tx.to } : {}) };
  const est = BigInt(rpcCall("eth_estimateGas", [call]));
  const gas = (est * 13n) / 10n;
  const args = ["send", "--async", "--private-key", key, "--rpc-url", rpc, "--nonce", String(nonce), "--gas-limit", gas.toString(),
    "--priority-gas-price", "10000000", "--gas-price", "30000000", "--value", BigInt(call.value).toString()];
  if (tx.to) args.push(tx.to, tx.input);
  else args.push("--create", tx.input);
  const hash = execFileSync("cast", args, { encoding: "utf8" }).trim().split("\n").pop();
  const r = JSON.parse(cast(["receipt", hash, "--rpc-url", rpc, "--json", "--confirmations", "1"]));
  const label = `${t.contractName ?? "-"} ${t.function ?? (tx.to ? "call" : "CREATE")}`;
  console.log(`${String(i).padStart(2)} ${r.status === "0x1" ? "ok  " : "FAIL"} ${label.padEnd(48)} gas ${BigInt(r.gasUsed)}/${gas} ${hash}${r.contractAddress ? " -> " + r.contractAddress : ""}`);
  if (r.status !== "0x1") process.exit(1);
  nonce++;
}
console.log("all transactions confirmed");
