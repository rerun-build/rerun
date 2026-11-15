#!/usr/bin/env python3
import calendar, os, sqlite3, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
LEDGER_WITHIN_S = 60
CANCELLED = ("cancelled", "canceled")


def ts(iso):
    if not isinstance(iso, str) or not iso:
        return None
    try:
        return calendar.timegm(time.strptime(iso.split(".")[0].rstrip("Z"), "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return None


def read_fires(db_path):
    db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    db.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in db.execute("SELECT * FROM fires ORDER BY id")]
    finally:
        db.close()


def read_table(db_path, table):
    db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    db.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in db.execute("SELECT * FROM %s" % table)]
    except sqlite3.Error:
        return []
    finally:
        db.close()


def measure_lines(fires, ready, wakes, now):
    import measures as M
    q, o, t = M.queue_measures(ready, fires, now), M.occupancy_measures(fires, wakes, [], {}, now), M.token_split(fires, [])
    na = lambda v: "n/a" if v is None else ("%.2f" % v if isinstance(v, float) else str(v))
    out = ["queue depth=%d wait_s=%s stalled_s=%d" % (q["depth"], ",".join("%d" % w for w in q["wait_s"]) or "none", q["stalled_s"]),
           "occupancy=%s quiet_wake_rate=%s no_commit=n/a early_reviews=n/a" % (na(o["occupancy"]), na(o["quiet_wake_rate"])),
           "tokens per merged change: " + " ".join("%s=%s" % (k, na(t[k])) for k, _ in M.TOKEN_FIELDS)]
    for job, m in M.review_measures(fires, now).items():
        out.append("review job %s: runs=%d tokens=%d coworkers=%d peak_chunks=%d" % (job, m["review_runs"], m["review_tokens"], m["coworkers"], m["peak_chunks"]))
    return out


def runner_started_at():
    try:
        with open("/proc/1/stat") as f:
            ticks = int(f.read().rsplit(")", 1)[1].split()[19])
        with open("/proc/stat") as f:
            btime = next(int(l.split()[1]) for l in f if l.startswith("btime"))
        return btime + ticks // os.sysconf("SC_CLK_TCK")
    except (OSError, ValueError, StopIteration, IndexError):
        return None


def _runs(eng, fires, cfg_agents):
    out = {}
    for f in fires:
        rid = f.get("run_id")
        if not rid or rid in out:
            continue
        row = None
        for agent in ([f["coworker"]] if f.get("coworker") else []) + list(cfg_agents):
            row = eng.get_run(agent, rid)
            if row:
                break
        out[rid] = row
    return out


def report(fires, eng, agents, restart_at=None):
    runs = _runs(eng, fires, agents)
    rows = []

    done = [f for f in fires if f.get("status") == "done" and f.get("run_id")]
    if not done:
        rows.append(("R1", "FAIL", "no fire closed 'done' in the ledger (fires: %d)" % len(fires)))
    else:
        f = done[-1]
        row = runs.get(f["run_id"]) or {}
        fin, led = ts(row.get("finishedAt")), ts(f.get("ended_at"))
        gap = None if fin is None or led is None else led - fin
        ok = row.get("status") == "done" and gap is not None and -2 <= gap <= LEDGER_WITHIN_S
        rows.append(("R1", "PASS" if ok else "FAIL", "run %s stage %s run-row=%s ledger=%s seconds run-row-end-to-ledger=%s (limit %d)" % (
            f["run_id"], f.get("stage"), row.get("status"), f.get("status"), gap, LEDGER_WITHIN_S)))

    canc = [f for f in fires if f.get("run_id") and (runs.get(f["run_id"]) or {}).get("status") in CANCELLED]
    if canc:
        f = canc[-1]
        rows.append(("R2", "PASS", "run %s stage %s run-row=%s ledger=%s" % (f["run_id"], f.get("stage"), runs[f["run_id"]].get("status"), f.get("status"))))
    else:
        st = sorted({(runs.get(f["run_id"]) or {}).get("status") or "unknown" for f in fires if f.get("run_id")})
        rows.append(("R2", "FAIL", "no fired run has run-row status cancelled (run-row statuses seen: %s)" % (", ".join(st) or "none")))

    groups = {}
    for f in fires:
        groups.setdefault((f.get("job"), f.get("chunk"), f.get("stage")), []).append(f)
    r3 = None
    for key, g in groups.items():
        if len(g) > 1:
            r3 = (key, g)
    if r3 is None:
        rows.append(("R3", "FAIL", "no stage was fired again (refire count 0 for every job/stage)"))
    else:
        key, g = r3
        first = runs.get(g[0].get("run_id")) or {}
        refires = len(g) - 1
        ok = refires == 1 and first.get("status") == "error" and bool(g[1].get("run_id"))
        rows.append(("R3", "PASS" if ok else "FAIL", "job %s stage %s first run %s run-row=%s, refire count=%d (max 1), fired again as run %s ledger=%s" % (
            key[0], key[2], g[0].get("run_id"), first.get("status"), refires, g[1].get("run_id"), g[-1].get("status"))))

    if restart_at is None:
        rows.append(("R4", "FAIL", "runner start time not readable; cannot tell if the container was recreated"))
    else:
        cont = [f for f in fires if f.get("run_id") and (ts(f.get("intent_at")) or 0) < restart_at <= (ts(f.get("ended_at")) or 0)]
        if cont:
            f = cont[-1]
            rows.append(("R4", "PASS", "job %s run %s fired before the runner start (%s), ended after it, ledger=%s" % (
                f.get("job"), f["run_id"], time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(restart_at)), f.get("status"))))
        else:
            rows.append(("R4", "FAIL", "no run fired before the runner start (%s) and closed after it" % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(restart_at))))

    ids, fired_ids = [], {f["run_id"] for f in fires if f.get("run_id")}
    for a in agents:
        ids += [r.get("id") for r in eng.list_runs(a, limit=200) if r.get("id")]
    foreign = [i for i in ids if i not in fired_ids]
    rows.append(("R6", "PASS" if ids and not foreign else "FAIL",
                 "for a stage with no tools: engine runs=%d, fired-run-ids in ledger=%d, runs not fired as a stage=%s" % (
                     len(ids), len(fired_ids), ",".join(foreign) or "none")))
    return rows


def render(rows):
    return "\n".join("%-3s %-4s %s" % r for r in rows) + "\nR5: checked separately by the owner\n"


def main(argv):
    import engine as E
    import trigger as T
    import runner_loop as R
    try:
        cfg = T.load_config()
        db = argv[argv.index("--db") + 1] if "--db" in argv else R.store_path(cfg)
        fires = read_fires(db)
        agents = sorted({e["agent"] for e in R.load_runtime(cfg, strict=False)["triggers"]})
        sys.stdout.write(render(report(fires, E.Engine(), agents, runner_started_at())))
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        sys.stdout.write("\n".join(measure_lines(fires, read_table(db, "ready_chunks"), read_table(db, "wakes"), now)) + "\n")
    except (E.EngineError, sqlite3.Error, OSError, RuntimeError) as e:
        sys.stdout.write("status failed: %s\n" % type(e).__name__ + ("" if isinstance(e, sqlite3.Error) else str(e) + "\n"))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
