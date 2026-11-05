import json, sys, math, datetime as dt
rows = json.load(open(sys.argv[1]))
wk = {}
for (t0, p0), (t1, p1) in zip(rows, rows[1:]):
    if t1 - t0 != 300000: continue          # skip gaps
    w = (t1 - 1730678400000) // (7*86400000)
    r = math.log(p1/p0)
    a = wk.setdefault(w, [0.0, 0, p0, p1]); a[0] += r*r; a[1] += 1; a[3] = p1
res = []
for w, (s, n, po, pc) in sorted(wk.items()):
    start = dt.datetime.utcfromtimestamp((1730678400000 + w*7*86400000)/1000).date()
    res.append({"week": str(start), "ann_vol": math.sqrt(s*52), "n": n, "open": po, "close": pc, "move_pct": (pc/po-1)*100})
json.dump(res, open(sys.argv[2], "w"), indent=1)
v = sorted(r["ann_vol"] for r in res)
q = lambda p: v[int(p*(len(v)-1))]
print("weeks", len(res), "min %.0f%% p10 %.0f%% p25 %.0f%% median %.0f%% p75 %.0f%% p90 %.0f%% max %.0f%%" % tuple(100*x for x in (v[0], q(.1), q(.25), q(.5), q(.75), q(.9), v[-1])))
for r in sorted(res, key=lambda r: r["ann_vol"]):
    pass
srt = sorted(res, key=lambda r: r["ann_vol"])
print("calmest 3:", [(r["week"], round(100*r["ann_vol"])) for r in srt[:3]])
print("median-ish:", [(r["week"], round(100*r["ann_vol"])) for r in srt[len(srt)//2-1:len(srt)//2+2]])
print("wildest 5:", [(r["week"], round(100*r["ann_vol"]), round(r["move_pct"],1)) for r in srt[-5:]])
print("weeks >=100%:", sum(r["ann_vol"]>=1 for r in res), " weeks <=40%:", sum(r["ann_vol"]<=0.4 for r in res))
