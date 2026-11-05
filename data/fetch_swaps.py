import json, sys, time, urllib.request, datetime as dt
RPC = "https://rpc.mevblocker.io"
POOL = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640"
TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for a in range(6):
        try:
            req = urllib.request.Request(RPC, body, {"content-type": "application/json", "user-agent": "lvr-check"})
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.load(r)
            if "error" in j: return None, j["error"]
            return j["result"], None
        except Exception as e:
            time.sleep(2 + 3 * a)
    return None, "network"
def ts(n):
    b, _ = rpc("eth_getBlockByNumber", [hex(n), False]); return int(b["timestamp"], 16)
def block_at(t):
    hi_b, _ = rpc("eth_blockNumber", []); hi = int(hi_b, 16); lo = 15537394  # merge
    while lo < hi:
        mid = (lo + hi) // 2
        if ts(mid) < t: lo = mid + 1
        else: hi = mid
    return lo
def s256(h): v = int(h, 16); return v - (1 << 256) if v >= 1 << 255 else v
week, out = sys.argv[1], sys.argv[2]
t0 = int(dt.datetime.fromisoformat(week).replace(tzinfo=dt.timezone.utc).timestamp()); t1 = t0 + 7 * 86400
b0, b1 = block_at(t0), block_at(t1)
swaps, b, step = [], b0, 3000
while b < b1:
    e = min(b + step, b1) - 1
    res, err = rpc("eth_getLogs", [{"address": POOL, "topics": [TOPIC], "fromBlock": hex(b), "toBlock": hex(e)}])
    if err:
        step = max(50, step // 2); continue
    for l in res:
        d = l["data"][2:]
        swaps.append([int(l["blockTimestamp"], 16), s256(d[0:64]) / 1e6, s256(d[64:128]) / 1e18])
    b = e + 1
    if step < 3000: step = min(3000, step * 2)
json.dump({"week": week, "block_from": b0, "block_to": b1 - 1, "swaps": swaps}, open(out, "w"))
print(week, "blocks", b0, b1 - 1, "swaps", len(swaps))
