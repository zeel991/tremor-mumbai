#!/usr/bin/env node
// Copies the contracts team's outputs into web/src/generated/ so the app can import them.
//
//   contracts/deployments/fork.json                      -> src/generated/deployment.json
//   contracts/out/<Contract>.sol/<Contract>.json (.abi)  -> src/generated/abis.json
//   data/full_104w.json                                  -> src/generated/full_104w.json
//
// Missing deployment or ABIs are not errors: the app shows a "not deployed" message and falls
// back to the hand-written ABI fragments in src/lib/fallbackAbis.ts. Re-run `npm run sync`
// (or restart `npm run dev`) after the contracts are deployed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(webDir, "..");
const outDir = join(webDir, "src", "generated");
mkdirSync(outDir, { recursive: true });

const rel = (p) => relative(repoDir, p);
const write = (name, value) => writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + "\n");

// ---- deployment ---------------------------------------------------------------------------
const REQUIRED_KEYS = [
  "chainId", "weth", "uni", "aqua", "poolManager", "market", "router", "vault", "hook", "receiver",
  "poolKey", "poolId", "windows", "epochOrigin", "forkBlock",
];
// TREMOR_FORK_JSON overrides the path (e.g. point it at a non-existent file to test the "not deployed" UI).
// NEXT_PUBLIC_TREMOR_NETWORK=sepolia reads deployments/sepolia.json instead of fork.json.
const network = process.env.NEXT_PUBLIC_TREMOR_NETWORK === "sepolia" ? "sepolia" : "fork";
const forkPath = process.env.TREMOR_FORK_JSON ? resolve(process.env.TREMOR_FORK_JSON) : join(repoDir, "contracts", "deployments", `${network}.json`);
let deployment;
if (!existsSync(forkPath)) {
  deployment = { status: "missing", path: rel(forkPath), problems: ["file not found"], deployment: null };
} else {
  try {
    const parsed = JSON.parse(readFileSync(forkPath, "utf8"));
    const problems = REQUIRED_KEYS.filter((k) => parsed[k] === undefined || parsed[k] === null).map((k) => `missing key "${k}"`);
    for (const w of network === "fork" ? ["live", "oct2025", "feb2025"] : ["live"]) {
      if (parsed.windows && parsed.windows[w] === undefined) problems.push(`missing windows.${w}`);
    }
    deployment = { status: problems.length ? "incomplete" : "ok", path: rel(forkPath), problems, deployment: parsed };
  } catch (e) {
    deployment = { status: "invalid", path: rel(forkPath), problems: [`JSON parse error: ${e.message}`], deployment: null };
  }
}
write("deployment.json", deployment);

// ---- ABIs ---------------------------------------------------------------------------------
const CONTRACTS = [
  "VarianceMarket", "TremorVault", "TremorHook", "TremorReceiver", "TremorAquaSwapVMRouter", "ClaimToken",
];
const abis = {};
for (const name of CONTRACTS) {
  const p = join(repoDir, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) { abis[name] = null; continue; }
  try {
    const artifact = JSON.parse(readFileSync(p, "utf8"));
    abis[name] = Array.isArray(artifact.abi) ? { source: rel(p), abi: artifact.abi } : null;
  } catch {
    abis[name] = null;
  }
}
// Hosted builds (Vercel from git) have no contracts/out: fall back to the committed ABI snapshot, which this script
// refreshes whenever the Foundry artifacts are present.
const snapshotPath = join(webDir, "abis.snapshot.json");
if (CONTRACTS.every((c) => abis[c])) {
  writeFileSync(snapshotPath, JSON.stringify(abis, null, 2) + "\n");
} else if (existsSync(snapshotPath)) {
  const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
  for (const c of CONTRACTS) if (!abis[c] && snap[c]) abis[c] = { ...snap[c], source: `${snap[c].source} (snapshot)` };
}
write("abis.json", abis);

// ---- 104-week dataset ---------------------------------------------------------------------
const dataPath = join(repoDir, "data", "full_104w.json");
if (!existsSync(dataPath)) {
  console.error(`[sync] ${rel(dataPath)} not found; the data view needs it.`);
  process.exit(1);
}
write("full_104w.json", JSON.parse(readFileSync(dataPath, "utf8")));

// ---- price-shock scenarios (contracts/test/scenario/PriceShock.t.sol) ----------------------
const scenDir = join(repoDir, "data", "scenarios");
const scenarios = {};
for (const n of ["crash", "shock_then_calm", "calm"]) {
  const f = join(scenDir, `${n}.ndjson`);
  if (existsSync(f)) scenarios[n] = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
write("scenarios.json", scenarios);

// ---- report -------------------------------------------------------------------------------
const found = CONTRACTS.filter((c) => abis[c]);
console.log(`[sync] deployment: ${deployment.status} (${deployment.path})${deployment.problems.length ? " - " + deployment.problems.join("; ") : ""}`);
const missing = CONTRACTS.filter((c) => !abis[c]);
console.log(`[sync] ABIs from artifacts: ${found.length ? found.join(", ") : "none"}${missing.length ? `; hand-written fallback for ${missing.join(", ")}` : ""}`);
console.log(`[sync] data: ${rel(dataPath)}; scenarios: ${Object.keys(scenarios).join(", ") || "none"}`);
