#!/usr/bin/env python3
import json, os, re, sqlite3, sys
A = os.environ.get("JOBCOST_AGENTS", "/data/agents")
if len(sys.argv) < 2 or "#" not in sys.argv[1]:
    print("usage: job-cost <repo>#<issue> [--steps]"); sys.exit(2)
tag = "JOB " + sys.argv[1].split("/")[-1]
RX = re.compile(r"JOB (?:[\w.-]+/)?%s(?!\d)" % re.escape(tag[4:]))
rows = []
for d in sorted(os.listdir(A)):
    db, cf = "%s/%s/data/system.db" % (A, d), "%s/%s/config.json" % (A, d)
    if not (os.path.isfile(db) and os.path.isfile(cf)) or d == "foreman":
        continue
    name = json.load(open(cf)).get("displayName") or json.load(open(cf)).get("name")
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=5)
        con.create_function("jobmatch", 1, lambda t: 1 if t and RX.search(t) else 0)
        sess = {r[0] for r in con.execute("select distinct session_id from messages where role='user' and jobmatch(content_json)")}
        runs = {r[0] for r in con.execute("select distinct run_id from tool_calls where jobmatch(input_json)")}
        q = "select id,session_id,status,model,started_at,finished_at,step_count,error from runs"
        for rid, sid, st, model, t0, t1, steps, err in con.execute(q):
            if rid not in runs and sid not in sess:
                continue
            if sid in sess and rid not in runs:
                first = con.execute("select min(created_at) from messages where session_id=? and role='user' and jobmatch(content_json)", (sid,)).fetchone()[0]
                if t1 and first and t1 < first:
                    continue
            i, c, w, o, n = con.execute("select coalesce(sum(input_tokens),0),coalesce(sum(cached_input_tokens),0),coalesce(sum(cache_write_tokens),0),coalesce(sum(output_tokens),0),count(*) from run_steps where run_id=?", (rid,)).fetchone()
            tc = con.execute("select count(*),coalesce(sum(is_error),0) from tool_calls where run_id=?", (rid,)).fetchone()
            rows.append(dict(who=name, run=rid, status=st, model=(model or "").replace("claude-", ""), start=t0 or "", end=t1 or "", calls=tc[0], errs=tc[1], inp=i, cached=c, write=w, out=o, steps=n, err=err))
    except Exception as e:
        print("skip %s: %s" % (d, str(e)[:60]))
rows.sort(key=lambda r: r["start"])
print("%s: %d runs" % (tag, len(rows)))
print("%-16s %-10s %-9s %5s %5s %10s %10s %10s %10s %8s  %s" % ("coworker", "model", "status", "calls", "errs", "input", "cached", "cache-new", "uncached", "output", "start (UTC)"))
T = dict(calls=0, errs=0, inp=0, cached=0, write=0, out=0)
for r in rows:
    for k in T:
        T[k] += r[k]
    print("%-16s %-10s %-9s %5d %5d %10d %10d %10d %10d %8d  %s  %s" % (r["who"][:16], r["model"][:10], r["status"], r["calls"], r["errs"], r["inp"], r["cached"], r["write"], r["inp"] - r["cached"] - r["write"], r["out"], r["start"][11:19], r["run"]))
print("%-16s %-10s %-9s %5d %5d %10d %10d %10d %10d %8d" % ("TOTAL", "", "", T["calls"], T["errs"], T["inp"], T["cached"], T["write"], T["inp"] - T["cached"] - T["write"], T["out"]))
print("input = cached (re-read from cache) + cache-new (written to cache) + uncached. failures: %d runs not 'done', %d tool errors." % (sum(1 for r in rows if r["status"] not in ("done", "running")), T["errs"]))
