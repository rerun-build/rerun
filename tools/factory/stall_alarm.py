#!/usr/bin/env python3
import calendar, json, sys, time

DEFAULT_LIMIT_S = 2700


def ts(iso):
    return calendar.timegm(time.strptime(iso.split(".")[0].rstrip("Z"), "%Y-%m-%dT%H:%M:%S"))


def stalled(runs, now_s, limit_s=DEFAULT_LIMIT_S):
    return [r for r in runs if r.get("status") == "running" and now_s - ts(r["startedAt"]) > limit_s]


def line(run, name, pushed_at, now_s):
    minutes = (now_s - ts(run["startedAt"])) // 60
    return "STALL %s run %s job %s running %d min, branch %s last push %s" % (
        name, run["id"], run.get("jobRef") or "-", minutes, run.get("branch") or "-", pushed_at or "-")


def main(argv):
    if len(argv) != 3 or argv[1] != "--fixture":
        print("usage: stall_alarm.py --fixture PATH", file=sys.stderr)
        return 2
    with open(argv[2]) as f:
        d = json.load(f)
    now_s = ts(d["now"])
    for r in stalled(d["runs"], now_s):
        print(line(r, d["agents"].get(r["agentId"], r["agentId"]), d["pushes"].get(r.get("branch")), now_s))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
