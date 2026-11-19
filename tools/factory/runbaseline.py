#!/usr/bin/env python3
import json, os, re, sqlite3, statistics, sys
from collections import Counter
from datetime import datetime, timezone

A = os.environ.get("RUNBASELINE_AGENTS", "/data/agents")
USAGE = "usage: runbaseline.py [--until YYYY-MM-DDTHH:MM:SSZ]"
UNTIL_RE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
TYPES = (
    ("build", ("One job, sent by the dispatcher",)),
    ("review", ("One review, sent by the dispatcher",)),
    ("fix", ("One fix round, sent by the dispatcher", "The senior fix round, sent by the dispatcher")),
    ("proof", ("One proof, sent by the dispatcher",)),
    ("plan", ("One plan, sent by the dispatcher", "One planning job, sent by the dispatcher", "One re-plan, sent by the dispatcher")),
)
PATHS = ("engine", "cli")
CLI_PROVIDERS = ("claude", "codex")
READ_ONLY_TOOLS = frozenset(("fs_read", "fs_list", "fs_search", "shared_read", "shared_list", "shared_search", "memory_recall", "brain_search", "brain_read", "skill_list", "skill_read", "skill_read_file", "team_status", "team_list_schedules", "team_list_triggers", "team_list_runs", "team_get_run", "web_fetch", "web_search"))
BUILD_KEY = re.compile(r"^One job, sent by the dispatcher and not by Boss: (\S+) #(\d+),")
FIX_KEY = re.compile(r"of (\S+) \(job #(\d+)\)")
SPLIT = re.compile(r"&&|\|\||;|\||\n")
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
NAME = re.compile(r"^[A-Za-z0-9._+-]{1,40}$")
SAMPLE = 10


def parse_until(argv):
    if not argv:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if len(argv) != 2 or argv[0] != "--until" or not UNTIL_RE.match(argv[1]):
        return None
    try:
        datetime.strptime(argv[1], "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    return argv[1]


def text_of(content):
    try:
        v = json.loads(content)
    except (TypeError, ValueError):
        return content or ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return "".join(p.get("text") or "" for p in v if isinstance(p, dict) and p.get("type") == "text")
    return ""


def job_type(brief):
    for name, openings in TYPES:
        if brief.startswith(openings):
            return name
    return None


def programs(command):
    out = []
    for seg in SPLIT.split(command):
        words = seg.split()
        while words and ASSIGN.match(words[0]):
            words.pop(0)
        if not words:
            continue
        w = words[0].lstrip("({")
        if not w or w == "cd":
            continue
        b = os.path.basename(w)
        out.append(b if NAME.match(b) else "other")
    return out


def calls_of(con, rid):
    n, ro, prog = 0, 0, Counter()
    for name, args in con.execute("select tool_name, input_json from tool_calls where run_id=?", (rid,)):
        name = (name or "")[len("mcp__rerun__"):] if (name or "").startswith("mcp__rerun__") else (name or "")
        n += 1
        if name in READ_ONLY_TOOLS:
            ro += 1
        if name == "shell_exec":
            try:
                cmd = json.loads(args).get("command")
            except (TypeError, ValueError, AttributeError):
                cmd = None
            if isinstance(cmd, str):
                prog.update(programs(cmd))
    return n, ro, prog


def read_agent(db, until):
    con = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=5)
    try:
        runs, unclassified = [], 0
        q = "select id, session_id, status, provider, model, started_at, finished_at, step_count, input_tokens, cached_input_tokens, cost_micros from runs where status != 'running' and finished_at is not null"
        for rid, sid, st, prov, model, t0, t1, steps, inp, cached, cost in con.execute(q).fetchall():
            if t1[:19] > until[:19]:
                continue
            m = con.execute("select content_json from messages where session_id=? and role='user' and created_at>=? order by created_at limit 1", (sid, t0 or "")).fetchone()
            brief = text_of(m[0]).lstrip() if m else ""
            kind = job_type(brief)
            if kind is None:
                if "sent by the dispatcher" in brief:
                    unclassified += 1
                continue
            key = None
            if kind == "build":
                k = BUILD_KEY.match(brief)
                key = k.groups() if k else None
            elif kind == "fix":
                k = FIX_KEY.search(brief)
                key = k.groups() if k else None
            n, ro, prog = calls_of(con, rid)
            runs.append(dict(id=rid, status=st, kind=kind, path="cli" if prov in CLI_PROVIDERS else "engine", start=t0 or "", steps=steps, inp=inp, cached=cached, cost=cost, key=key, calls=n, ro=ro, prog=prog))
        return runs, unclassified
    finally:
        con.close()


def pct(a, b):
    return "%.1f%%" % (a * 100.0 / b)


def mean(vals):
    vals = [v for v in vals if v is not None]
    return str(round(statistics.mean(vals))) if vals else "-"


def row(kind, path, sample, fixes):
    if not sample:
        return "| %s | %s | 0 |%s" % (kind, path, " - |" * 10)
    passed = 0
    for r in sample:
        ok = r["status"] == "done"
        if ok and kind == "build" and r["key"] and any(f["key"] == r["key"] and f["start"] > r["start"] for f in fixes):
            ok = False
        passed += ok
    steps = [r["steps"] for r in sample if r["steps"] is not None]
    both = [r for r in sample if r["inp"] is not None and r["cached"] is not None]
    share = pct(sum(r["cached"] for r in both), sum(r["inp"] for r in both)) if both and sum(r["inp"] for r in both) else "-"
    costs = [r["cost"] for r in sample if r["cost"] is not None]
    cost = "$%.4f" % (statistics.mean(costs) / 1e6) if costs else "-"
    calls = sum(r["calls"] for r in sample)
    ro = sum(r["ro"] for r in sample)
    prog = Counter()
    for r in sample:
        prog.update(r["prog"])
    top = ", ".join("%s %d" % (k, v) for k, v in sorted(prog.items(), key=lambda kv: (-kv[1], kv[0]))[:3]) or "-"
    cells = [kind, path, str(len(sample)), pct(passed, len(sample)), mean(steps), str(round(statistics.median(steps))) if steps else "-",
             mean([r["inp"] for r in sample]), mean([r["cached"] for r in sample]), share, cost, str(calls),
             "%d (%s)" % (ro, pct(ro, calls)) if calls else "0 (-)", top]
    return "| " + " | ".join(cells) + " |"


def main(argv):
    until = parse_until(argv)
    if until is None:
        print(USAGE)
        return 2
    if not os.path.isdir(A):
        print("no agents folder: %s" % A)
        return 2
    runs, unclassified, skipped = [], 0, []
    for d in sorted(os.listdir(A)):
        db, cf = "%s/%s/data/system.db" % (A, d), "%s/%s/config.json" % (A, d)
        if not (os.path.isfile(db) and os.path.isfile(cf)) or d == "foreman":
            continue
        try:
            got, u = read_agent(db, until)
        except Exception as e:
            skipped.append((d, str(e)[:60]))
            continue
        runs += got
        unclassified += u
    fixes = [r for r in runs if r["kind"] == "fix" and r["key"]]
    out = ["# Code mode baseline", "",
           "As of %s: the 10 most recent finished runs per job type and path, read from %s/*/data/system.db." % (until, A),
           "Path engine: the engine loop, which programmatic tool calling can reach. Path cli: the Claude or Codex CLI, which it cannot.",
           "Pass: the run finished (status done); a build also needs no later fix round on its job.", "",
           "| job type | path | runs | pass | steps mean | steps median | input mean | cache reads mean | cache share | cost mean | tool calls | read-only calls | top programs |",
           "|---" * 13 + "|"]
    samples = []
    for kind, _ in TYPES:
        for path in PATHS:
            sample = sorted((r for r in runs if r["kind"] == kind and r["path"] == path), key=lambda r: (r["start"], r["id"]), reverse=True)[:SAMPLE]
            samples.append((kind, path, sample))
            out.append(row(kind, path, sample, fixes))
    engine = [r for _, path, s in samples if path == "engine" for r in s]
    if len(engine) < SAMPLE:
        verdict = "Verdict: not enough engine-loop runs to judge (%d of 10)." % len(engine)
    else:
        calls = sum(r["calls"] for r in engine)
        share = sum(r["ro"] for r in engine) * 100.0 / calls if calls else 0.0
        verdict = "Verdict: stage 2 %s: read-only built-in calls are %.1f%% of %d engine-loop tool calls in the sampled runs (threshold 10%%)." % ("pays" if share >= 10.0 else "does not pay", share, calls)
    out += ["", verdict, "Unclassified dispatcher runs: %d" % unclassified, "", "## Runs"]
    out += ["- %s %s: %s" % (kind, path, " ".join(r["id"] for r in s)) for kind, path, s in samples if s]
    if skipped:
        out += ["", "## Skipped"] + ["- %s: %s" % s for s in skipped]
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
