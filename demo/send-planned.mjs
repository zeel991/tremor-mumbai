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
const first = Number(plan[0].transaction.nonce);
// Resume: transactions with a planned nonce below the account's nonce are already on-chain.
const start = nonce - first;
if (start < 0 || start > plan.length) throw new Error(`account nonce ${nonce} is outside the plan (${first}..${first + plan.length - 1}); re-simulate`);
if (start > 0) console.log(`resuming at transaction ${start} (0..${start - 1} already confirmed)`);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const estimate = (call) => {
  // public RPCs load-balance across replicas; one a block behind can mis-estimate a dependent tx
  for (let attempt = 1; ; attempt++) {
    try {
      return BigInt(rpcCall("eth_estimateGas", [call]));
    } catch (e) {
      if (attempt >= 4) throw new Error(`gas estimate failed 4 times: ${String(e.stderr ?? e.message).split("\n")[0]}`);
      sleep(4000);
    }
  }
};

for (const [i, t] of plan.entries()) {
  if (i < start) continue;
  const tx = t.transaction;
  const call = { from: tx.from, data: tx.input, value: tx.value ?? "0x0", ...(tx.to ? { to: tx.to } : {}) };
  const est = estimate(call);
  const gas = (est * 13n) / 10n;
  const args = ["send", "--async", "--private-key", key, "--rpc-url", rpc, "--nonce", String(nonce), "--gas-limit", gas.toString(),
    "--priority-gas-price", "10000000", "--gas-price", "30000000", "--value", BigInt(call.value).toString()];
  if (tx.to) args.push(tx.to, tx.input);
  else args.push("--create", tx.input);
  let hash;
  try {
    hash = execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop();
  } catch (e) {
    // Never print the command line or raw stderr: both can contain the private key.
    const msg = String(e.stderr ?? "").split("\n").find((l) => /error|revert|nonce|insufficient|underpriced/i.test(l)) ?? "send failed";
    console.error(`${String(i).padStart(2)} FAIL ${(t.contractName ?? "-")} ${t.function ?? "CREATE"}: ${msg.replaceAll(key, "<key>").slice(0, 200)}`);
    process.exit(1);
  }
  // public RPCs drop receipt polls now and then: retry instead of aborting a half-sent deployment
  let r;
  for (let attempt = 1; ; attempt++) {
    try {
      r = JSON.parse(cast(["receipt", hash, "--rpc-url", rpc, "--json", "--confirmations", "1"]));
      break;
    } catch (e) {
      if (attempt >= 20) throw e;
      execFileSync("sleep", ["6"]);
    }
  }
  const label = `${t.contractName ?? "-"} ${t.function ?? (tx.to ? "call" : "CREATE")}`;
  console.log(`${String(i).padStart(2)} ${r.status === "0x1" ? "ok  " : "FAIL"} ${label.padEnd(48)} gas ${BigInt(r.gasUsed)}/${gas} ${hash}${r.contractAddress ? " -> " + r.contractAddress : ""}`);
  if (r.status !== "0x1") process.exit(1);
  nonce++;
}
console.log("all transactions confirmed");
