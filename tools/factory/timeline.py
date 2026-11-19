import argparse, calendar, json, os, sqlite3, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acceptance
import cutshape
import flow
import states

END = states.END
CRIT = states.PROBLEM
LONG_WAIT = 10 * 60
DAY = 24 * 3600
FMT = "%Y-%m-%dT%H:%M:%SZ"
PHRASES = {
    "unsent": "to be sent again",
    "no_acceptor": "waits for an acceptor who built none of its jobs",
    "gaps": "found gaps; the parent stays open",
    "accepted": "accepted; the parent is closed",
    "closed": "the parent was closed outside the factory",
}


def parse(s):
    return calendar.timegm(time.strptime(s, FMT))


def read_rows(path):
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    db.row_factory = sqlite3.Row
    try:
        jobs = [dict(r) for r in db.execute("SELECT * FROM jobs")]
        trs = [dict(r) for r in db.execute("SELECT * FROM transitions ORDER BY id")]
        holds = []
        for r in db.execute("SELECT k, v FROM kv WHERE job='-' AND k LIKE 'hold:%' ORDER BY k"):
            try:
                until = json.loads(r["v"])["until"]
            except (ValueError, KeyError, TypeError):
                continue
            holds.append({"kind": r["k"][len("hold:"):], "until": until})
        fires = {r["job"]: r["coworker"] for r in db.execute("SELECT job, coworker FROM fires ORDER BY id")}
        accepts = {}
        for r in db.execute("SELECT job, k, v FROM kv WHERE job LIKE 'accept:%'"):
            try:
                parent = int(r["job"][len("accept:"):])
            except ValueError:
                continue
            accepts.setdefault(parent, {})[r["k"]] = r["v"]
        accept = {}
        for r in db.execute("SELECT job, v FROM kv WHERE k='state' AND job LIKE 'accept:%'"):
            try:
                accept[int(r["job"].split(":")[1])] = r["v"]
            except ValueError:
                continue
        tokens = {job: int(n) for job, n in db.execute(
            "SELECT job, COALESCE(SUM(tokens_in + tokens_out), 0) FROM fires GROUP BY job")}
    finally:
        db.close()
    return {"jobs": jobs, "transitions": trs, "holds": holds, "fires": fires, "accepts": accepts,
            "accept": accept, "tokens": tokens}


def _key(job):
    return (0, int(job), job) if job.isdigit() else (1, 0, job)


def _by_job(rows):
    out = {}
    for t in rows["transitions"]:
        out.setdefault(t["job"], []).append(t)
    return out


def status_lines(rows, now):
    trs = _by_job(rows)
    live, done = [], []
    held = []
    for h in rows.get("holds") or []:
        u = h.get("until")
        if isinstance(u, (int, float)) and not isinstance(u, bool) and u > now:
            held.append("sending held: %s until %s UTC" % (h["kind"], _hm(u)))
    for j in sorted(rows["jobs"], key=lambda j: _key(j["job"])):
        mine = trs.get(j["job"], [])
        last = mine[-1] if mine else None
        end = parse(last["at"]) if last else parse(j["updated_at"])
        if j["state"] in END:
            if now - end <= DAY:
                done.append("#%s %s: %s" % (j["job"], j["state"], (last or {}).get("reason") or "no reason"))
            continue
        start = end
        for t in reversed(mine):
            if t["to_state"] != j["state"]:
                break
            start = parse(t["at"])
        data = json.loads(j["data"] or "{}")
        pr = "pr #%s" % j["pr"] if j["pr"] else "pr -"
        w = data.get("waiting") or []
        waits = "waits on %s for %d min" % (", ".join("#%s" % n for n in w), max(0, now - end) // 60) if w else "no waits"
        reason = " | reason: %s" % data["wait_reason"] if data.get("wait_reason") else ""
        who = ""
        cw = (rows.get("fires") or {}).get(j["job"])
        if j["state"] in states.RUNNING and cw:
            who = " | run on %s, copy %s" % (cw, data.get("copy") or 1)
        live.append("#%s %s for %d min | %s | %s%s%s" % (j["job"], j["state"], max(0, now - start) // 60, pr, waits, reason, who))
    return held + feature_lines(rows, now) + live + done


def _acceptance_phrase(rec, kids, started, now):
    state = rec.get("state")
    if state is None:
        pending = sorted(int(j["job"]) for j in kids if j["state"] not in acceptance.DONE)
        if pending:
            return "waits on %s" % ", ".join("#%d" % n for n in pending)
        return "not sent yet"
    if state == "running":
        return "running on %s for %d min" % (rec.get("name") or "?", (now - started) // 60)
    if state == "left":
        return "left after %s sends" % (rec.get("sends") or "?")
    return PHRASES.get(state, state)


def feature_lines(rows, now):
    groups = {}
    for j in rows["jobs"]:
        if not j["job"].isdigit():
            continue
        data = json.loads(j["data"] or "{}")
        parent = cutshape.parse({"number": int(j["job"]), "body": data.get("body") or ""})["parent"]
        if parent:
            groups.setdefault(parent, []).append(j)
    lines = []
    for parent in sorted(groups):
        kids = sorted(groups[parent], key=lambda j: int(j["job"]))
        rec = (rows.get("accepts") or {}).get(parent, {})
        state = rec.get("state")
        try:
            started = float(rec.get("started"))
        except (TypeError, ValueError):
            started = 0
        if state in ("accepted", "closed", "gaps", "left") and now - started > DAY:
            continue
        newest = max(parse(j["updated_at"]) for j in kids)
        if state is None and all(j["state"] in END for j in kids) and now - newest > DAY:
            continue
        done = sum(1 for j in kids if j["state"] in acceptance.DONE)
        lines.append("feature #%d: %d of %d jobs done | acceptance %s" % (
            parent, done, len(kids), _acceptance_phrase(rec, kids, started, now)))
    return lines


def _state_start(mine, state, fallback):
    start = parse(mine[-1]["at"]) if mine else fallback
    for t in reversed(mine):
        if t["to_state"] != state:
            break
        start = parse(t["at"])
    return start


def map_lines(rows, now):
    trs = _by_job(rows)
    state_of = {j["job"]: j["state"] for j in rows["jobs"]}
    groups = {}
    for j in rows["jobs"]:
        if j["state"] in END:
            continue
        data = json.loads(j["data"] or "{}")
        number = int(j["job"]) if j["job"].isdigit() else 0
        parent = cutshape.parse({"number": number, "body": data.get("body") or ""})["parent"] or 0
        mine = trs.get(j["job"], [])
        first = parse(mine[0]["at"]) if mine else parse(j["updated_at"])
        start = _state_start(mine, j["state"], parse(j["updated_at"]))
        groups.setdefault(parent, []).append((first, j, data, start))
    if not groups:
        return ["dependency map of open work: none"]
    lines = ["dependency map of open work, by first start (UTC):"]
    for parent in sorted(groups, key=lambda p: (p == 0, p)):
        lines.append("  no feature:" if parent == 0 else "  feature #%s:" % parent)
        for first, j, data, start in sorted(groups[parent], key=lambda g: (g[0], _key(g[1]["job"]))):
            line = "    %s #%s %s for %d min" % (
                time.strftime("%m-%d %H:%M", time.gmtime(first)), j["job"], j["state"], max(0, now - start) // 60)
            edges = data.get("waiting") or []
            if edges:
                line += " <- " + ", ".join("#%s %s" % (d, state_of.get(str(d), "not a factory job")) for d in edges)
            if j["state"] in states.SLOW_WAIT and now - start > LONG_WAIT:
                line += " | stuck"
            lines.append(line)
    return lines


def job_dicts(rows):
    return [dict(json.loads(r["data"] or "{}"), issue=r["job"], state=r["state"], updated_at=r["updated_at"])
            for r in rows["jobs"]]


def _runs(mine):
    runs = []
    for t in mine:
        if not runs or runs[-1][0] != t["to_state"]:
            runs.append([t["to_state"], parse(t["at"])])
    return runs


def _wait_samples(trs, by_issue, now):
    samples = {}
    for job, mine in trs.items():
        worker = by_issue.get(job, {}).get("worker")
        runs = _runs(mine)
        for (state, start), (_, nxt) in zip(runs, runs[1:]):
            if state in states.WAIT_STATES and now - DAY <= nxt <= now:
                samples.setdefault((flow.station_type(state, worker), state), []).append(nxt - start)
    return samples


def _mean_wait(sample):
    if not sample:
        return "-"
    return "%d min" % (sum(sample) // len(sample) // 60)


def _tokens_per_merged(issues, tokens):
    if not issues:
        return "-"
    return str(sum(tokens.get(i, 0) for i in issues) // len(issues))


def numbers_lines(rows, now):
    jobs = job_dicts(rows)
    by_issue = {j["issue"]: j for j in jobs}
    trs = _by_job(rows)
    accept = rows.get("accept") or {}
    tokens = rows.get("tokens") or {}
    samples = _wait_samples(trs, by_issue, now)
    merged_at = {}
    for job, mine in trs.items():
        ins = [parse(t["at"]) for t in mine if t["to_state"] == "merged"]
        if ins:
            merged_at[job] = ins[-1]
    counts = flow.by_type(jobs)
    lines = ["numbers by type, last 24 h:"]
    for kind in flow.TYPES:
        c = counts[kind]
        reviewer = kind == "reviewer"
        stages = [s for s in states.WAIT_STATES if (flow.station_type(s, "coder") == "reviewer") == reviewer]
        waits = ", ".join("%s %s" % (s, _mean_wait(samples.get((kind, s), []))) for s in stages)
        line = "  %s: ready %d, running %d, waiting %d | mean wait: %s" % (kind, c["ready"], c["running"], c["waiting"], waits)
        if not reviewer:
            done = [j["issue"] for j in jobs
                    if flow.station_type("merged", j.get("worker")) == kind
                    and j["issue"] in merged_at and now - DAY <= merged_at[j["issue"]] <= now]
            line += " | merged per hour %.2f | tokens per merged %s" % (len(done) / 24, _tokens_per_merged(done, tokens))
        lines.append(line)
    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    features = flow.by_feature(jobs, accept, today)
    lines.append("numbers by feature, whole wave:")
    if not features:
        lines.append("  none")
    for f in features:
        merged = [j["issue"] for j in jobs if flow.parent_of(j) == f["parent"] and j["state"] == "merged"]
        lines.append("  #%d: %d of %d done, convergence %s, tokens per merged %s" % (
            f["parent"], f["done"], f["total"], f["convergence"], _tokens_per_merged(merged, tokens)))
    return lines


def _hm(t):
    return time.strftime("%H:%M", time.gmtime(t))


def gantt(rows, now, since):
    out = ["```mermaid", "gantt", "    title Factory jobs, times in UTC", "    dateFormat HH:mm",
           "    axisFormat %H:%M"]
    trs = _by_job(rows)
    for job in sorted(trs, key=_key):
        runs = []
        for t in trs[job]:
            if not runs or runs[-1][0] != t["to_state"]:
                runs.append([t["to_state"], parse(t["at"])])
        bars = []
        for i, (state, start) in enumerate(runs):
            left = i + 1 < len(runs)
            end = runs[i + 1][1] if left else now
            if end < since:
                continue
            tags = []
            if state in CRIT or (state in states.SLOW_WAIT and end - start > LONG_WAIT):
                tags.append("crit")
            if left:
                tags.append("done")
            bars.append("    %s %s :%s" % (job, state, "".join(x + ", " for x in tags) + "%s, %s" % (_hm(max(start, since)), _hm(end))))
        if bars:
            out += ["    section %s" % job] + bars
    out.append("```")
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="timeline.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="sudo docker compose -f deploy/vps/factory-dispatcher.yml exec -T factory-dispatcher python3 -I /state/src/tools/factory/timeline.py status")
    p.add_argument("cmd", choices=("status", "gantt"))
    p.add_argument("--db", default="/state/ledger.db")
    p.add_argument("--since")
    a = p.parse_args(argv)
    if not os.path.exists(a.db):
        print("no ledger at %s" % a.db, file=sys.stderr)
        return 2
    now = int(time.time())
    rows = read_rows(a.db)
    if a.cmd == "status":
        print("\n".join(status_lines(rows, now) + [""] + numbers_lines(rows, now) + [""] + map_lines(rows, now)))
    else:
        print(gantt(rows, now, parse(a.since) if a.since else now - DAY))
    return 0


if __name__ == "__main__":
    sys.exit(main())
