#!/usr/bin/env python3
import argparse, calendar, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ghclient
from engine import Engine

DEFAULT_LIMIT_S = 2700
DEFAULT_BOSS_FILE = "/data/shared/team/ACTIVE-DISPATCHES.md"
OWNER = "special-place-ai-heaven"


def ts(iso):
    return calendar.timegm(time.strptime(iso.split(".")[0].rstrip("Z"), "%Y-%m-%dT%H:%M:%S"))


def stalled(runs, now_s, limit_s=DEFAULT_LIMIT_S):
    return [r for r in runs if r.get("status") == "running" and now_s - ts(r["startedAt"]) > limit_s]


def line(run, name, pushed_at, now_s):
    minutes = (now_s - ts(run["startedAt"])) // 60
    return "STALL %s run %s job %s running %d min, branch %s last push %s" % (
        name, run["id"], run.get("jobRef") or "-", minutes, run.get("branch") or "-", pushed_at or "-")


def collect(eng):
    out = []
    for agent in eng.list_agents():
        for run in eng.list_runs(agent["id"], status="running"):
            out.append((run, agent["name"]))
    return out


def last_push(gh, branch):
    if gh is None or not branch:
        return None
    try:
        return gh.commit(gh.branch_sha(branch))["commit"]["committer"]["date"]
    except ghclient.GhError:
        return None


def alarm(eng, gh_for, boss_file, now_s, limit_s=DEFAULT_LIMIT_S):
    try:
        with open(boss_file) as f:
            seen = f.read()
    except FileNotFoundError:
        seen = ""
    pairs = collect(eng)
    names = {r["id"]: n for r, n in pairs}
    posted = []
    for run in stalled([r for r, _ in pairs], now_s, limit_s):
        if " run %s " % run["id"] in seen:
            continue
        job = run.get("jobRef")
        gh = None
        number = None
        if job and "#" in job:
            repo, number = job.split("#", 1)
            gh = gh_for(repo)
        text = line(run, names[run["id"]], last_push(gh, run.get("branch")), now_s)
        if gh is not None:
            gh.req("POST", "/issues/%s/comments" % number, {"body": text})
        with open(boss_file, "a") as f:
            f.write(text + "\n")
        posted.append(text)
    return posted


def live(args):
    def gh_for(repo):
        return ghclient.Client("https://api.github.com", OWNER + "/" + repo)

    for text in alarm(Engine(), gh_for, args.boss_file, time.time(), args.limit_min * 60):
        print(text)
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="stall_alarm.py")
    ap.add_argument("--fixture")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--boss-file", default=DEFAULT_BOSS_FILE)
    ap.add_argument("--limit-min", type=int, default=45)
    try:
        args = ap.parse_args(argv[1:])
    except SystemExit:
        return 2
    if args.live == bool(args.fixture):
        print("usage: stall_alarm.py --fixture PATH | --live", file=sys.stderr)
        return 2
    if args.live:
        return live(args)
    with open(args.fixture) as f:
        d = json.load(f)
    now_s = ts(d["now"])
    for r in stalled(d["runs"], now_s):
        print(line(r, d["agents"].get(r["agentId"], r["agentId"]), d["pushes"].get(r.get("branch")), now_s))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
