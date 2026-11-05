import json, sys, time, urllib.request, os
out = sys.argv[1]
start = 1730678400000  # 2024-11-04 00:00 UTC
end   = 1793577600000  # 2026-11-02 00:00 UTC
rows = []
t = start
while t < end:
    url = f"https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=5m&startTime={t}&endTime={end-1}&limit=1000"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                batch = json.load(r)
            break
        except Exception as e:
            time.sleep(2 + attempt * 3)
    else:
        raise SystemExit(f"failed at {t}")
    if not batch: break
    rows += [[b[0], float(b[4])] for b in batch]   # open time, close price
    t = batch[-1][0] + 300000
    time.sleep(0.15)
json.dump(rows, open(out, "w"))
print(len(rows), rows[0], rows[-1])
