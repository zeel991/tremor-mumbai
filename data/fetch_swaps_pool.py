# usage: fetch_swaps_pool.py <pool> <week YYYY-MM-DD> <dec0> <dec1> <out.json>
import json, sys, time, urllib.request, datetime as dt
RPC = "https://rpc.mevblocker.io"
TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
pool, week, d0, d1, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for a in range(6):
        try:
            req = urllib.request.Request(RPC, body, {"content-type": "application/json", "user-agent": "lvr-check"})
            with urllib.request.urlopen(req, timeout=60) as r: j = json.load(r)
            return (None, j["error"]) if "error" in j else (j["result"], None)
        except Exception: time.sleep(2 + 3 * a)
    return None, "network"
def ts(n): b, _ = rpc("eth_getBlockByNumber", [hex(n), False]); return int(b["timestamp"], 16)
def block_at(t):
    # interpolation search: post-merge slots are 12s, so jump by the time gap / 12 until close, then step exactly
    head = int(rpc("eth_blockNumber", [])[0], 16)
    n = min(15537394 + (t - 1663224179) // 12, head)
    for _ in range(12):
        d = t - ts(n)
        if abs(d) < 24: break
        n = min(n + d // 12, head)
    while ts(n) >= t: n -= 1
    while ts(n) < t: n += 1
    return n
def s256(h): v = int(h, 16); return v - (1 << 256) if v >= 1 << 255 else v
t0 = int(dt.datetime.fromisoformat(week).replace(tzinfo=dt.timezone.utc).timestamp())
b0, b1 = block_at(t0), block_at(t0 + 7 * 86400)
swaps, b, step = [], b0, 6000
while b < b1:
    e = min(b + step, b1) - 1
    res, err = rpc("eth_getLogs", [{"address": pool, "topics": [TOPIC], "fromBlock": hex(b), "toBlock": hex(e)}])
    if err: step = max(50, step // 2); continue
    for l in res:
        d = l["data"][2:]
        swaps.append([int(l["blockTimestamp"], 16), s256(d[0:64]) / 10**d0, s256(d[64:128]) / 10**d1])
    b = e + 1; step = min(6000, step * 2)
json.dump({"pool": pool, "week": week, "block_from": b0, "block_to": b1 - 1, "swaps": swaps}, open(out, "w"))
print(pool, week, "swaps", len(swaps))
