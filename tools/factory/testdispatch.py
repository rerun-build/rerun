#!/usr/bin/env python3
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F
import gate as G
from limits import ts

SUITES = ("backend", "frontend", "layout")
PATTERN_RE = re.compile(r"[A-Za-z0-9_./* -]+")
RUN_FIELDS = "databaseId,headSha,createdAt,status,conclusion,url"
FACTORY_CHECK = "Factory tools tests"
TAIL_LINES, TAIL_CHARS = 60, 200
FIND_S, RUN_S, POLL_S = 3 * 120, 25 * 60, 20
PROBE_LABEL = "factory-blocked"


def dispatch(full, branch, suite, pattern):
    if suite not in SUITES or not PATTERN_RE.fullmatch(pattern or ""):
        return False, "suite must be one of %s and pattern only [A-Za-z0-9_./* -]" % ", ".join(SUITES)
    r = F.run([F.GH, "workflow", "run", "one.yml", "-R", full, "--ref", branch, "-f", "suite=" + suite, "-f", "pattern=" + pattern], check=False)
    return (True, None) if r.returncode == 0 else (False, (r.stderr or r.stdout).strip()[-300:])


def gh_list(cmd):
    r = F.run([F.GH] + cmd, check=False)
    if r.returncode:
        raise G.NoAnswer("%s failed: %s" % (" ".join(cmd[:2]), (r.stderr or r.stdout).strip()[-200:]))
    return json.loads(r.stdout or "null")


def find_run(full, branch, head, since):
    rs = gh_list(["run", "list", "-R", full, "-w", "one.yml", "-b", branch, "-e", "workflow_dispatch", "-L", "5", "--json", RUN_FIELDS]) or []
    mine = [x for x in rs if x.get("headSha") == head and ts(x["createdAt"]) >= ts(since)]
    return max(mine, key=lambda x: ts(x["createdAt"])) if mine else None


def view_run(full, run_id):
    return gh_list(["run", "view", str(run_id), "-R", full, "--json", RUN_FIELDS])


def result(run):
    if run.get("status") != "completed":
        return "WAITING"
    return "GREEN" if run.get("conclusion") == "success" else "RED"


def log_tail(full, run_id):
    out = F.run([F.GH, "run", "view", str(run_id), "-R", full, "--log-failed"], check=False).stdout or ""
    return [G.ANSI.sub("", l)[:TAIL_CHARS] for l in out.splitlines()[-TAIL_LINES:]]


def factory_state(full, sha, done_test):
    cs = [c for c in G.head_checks(full, sha) if c["name"] == FACTORY_CHECK]
    if not cs or any(c["status"] != "completed" for c in cs):
        return "WAITING", None
    if any(c["conclusion"] != "success" for c in cs):
        return "RED", next(c["url"] for c in cs if c["conclusion"] != "success")
    seen = [ok for c in cs for k, name, ok, ln in G.results(G.job_log(full, c["url"])) if G.same(name, done_test)]
    return ("GREEN" if seen and all(seen) else "RED"), cs[-1]["url"]


def opt(a, k):
    return a[a.index(k) + 1] if k in a[:-1] else None


def cmd_probe_one(a):
    repo, ref, suite, pattern = (opt(a, k) for k in ("--repo", "--ref", "--suite", "--pattern"))
    if not (repo and ref and suite and pattern):
        print("usage: probe-one --repo R --ref BRANCH --suite backend|frontend|layout --pattern SPEC")
        return 2
    full = F.repo_full(repo)
    head = ((F.api("repos/%s/branches/%s" % (full, ref)) or {}).get("commit") or {}).get("sha")
    if not head:
        print("ONE FAIL - branch %s not found on %s" % (ref, full))
        return 1
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    ok, why = dispatch(full, ref, suite, pattern)
    if not ok:
        print("ONE FAIL - dispatch refused: %s" % why)
        return 1
    end, run = time.time() + FIND_S, None
    while run is None:
        run = find_run(full, ref, head, since)
        if run is None and time.time() >= end:
            print("ONE FAIL - no one.yml run for %s @%s after %d s" % (ref, head[:8], FIND_S))
            return 1
        time.sleep(0 if run else POLL_S)
    end = time.time() + RUN_S
    while result(run) == "WAITING" and time.time() < end:
        time.sleep(POLL_S)
        run = view_run(full, run["databaseId"])
    green = result(run) == "GREEN"
    print("ONE %s %s %s" % ("OK" if green else "FAIL", run["databaseId"], run.get("conclusion") or run.get("status")))
    return 0 if green else 1


def gh_write(*args):
    r = F.run([F.GH, "api"] + list(args), check=False)
    if r.returncode:
        return False, None, (r.stderr or r.stdout).strip()[-200:]
    try:
        return True, json.loads(r.stdout) if r.stdout.strip() else None, None
    except ValueError:
        return True, None, None


def cmd_probe_merge(a):
    repo, issue = opt(a, "--repo"), opt(a, "--issue")
    if not repo or not issue:
        print("usage: probe-merge --repo R --issue N (no default: name an issue of that repo)")
        return 2
    full = F.repo_full(repo)
    it, dev = F.api("repos/%s/issues/%s" % (full, issue)), F.api("repos/%s/commits/dev" % full)
    if not it or not dev or not dev.get("parents"):
        print("MERGE FAIL read: cannot read %s#%s or dev~1" % (full, issue))
        return 1
    if PROBE_LABEL in [l["name"] for l in it.get("labels", [])]:
        print("MERGE FAIL label %s is already on %s#%s, the probe would remove it; use --issue" % (PROBE_LABEL, full, issue))
        return 1
    ref = "factory-probe/%d" % time.time()
    ok, _, err = gh_write("-X", "POST", "repos/%s/git/refs" % full, "-f", "ref=refs/heads/" + ref, "-f", "sha=" + dev["parents"][0]["sha"])
    if not ok:
        print("MERGE FAIL create scratch ref: %s" % err)
        return 1
    step, ok = "", True
    try:
        steps = [("merge dev into the scratch ref", ("-X", "POST", "repos/%s/merges" % full, "-f", "base=" + ref, "-f", "head=dev", "-f", "commit_message=factory probe-merge")),
                 ("add label", ("-X", "POST", "repos/%s/issues/%s/labels" % (full, issue), "-f", "labels[]=" + PROBE_LABEL)),
                 ("remove label", ("-X", "DELETE", "repos/%s/issues/%s/labels/%s" % (full, issue, PROBE_LABEL))),
                 ("post comment", ("-X", "POST", "repos/%s/issues/%s/comments" % (full, issue), "-f", "body=factory probe-merge: scratch comment, safe to ignore"))]
        for step, args in steps:
            ok, out, err = gh_write(*args)
            if not ok:
                break
        if ok:
            step = "patch comment"
            ok, _, err = gh_write("-X", "PATCH", "repos/%s/issues/comments/%s" % (full, (out or {}).get("id")), "-f", "body=factory probe-merge: scratch comment, edited by the probe")
    finally:
        gone, _, derr = gh_write("-X", "DELETE", "repos/%s/git/refs/heads/%s" % (full, ref))
    if not ok:
        print("MERGE FAIL %s: %s" % (step, err))
    elif not gone:
        print("MERGE FAIL delete scratch ref %s: %s" % (ref, derr))
    else:
        print("MERGE OK")
    return 0 if ok and gone else 1


CMDS = {"probe-one": cmd_probe_one, "probe-merge": cmd_probe_merge}


def main(argv):
    if not argv or argv[0] not in CMDS:
        print("commands: " + ", ".join(CMDS))
        return 2
    try:
        return CMDS[argv[0]](argv[1:])
    except G.NoAnswer as e:
        print("FAIL could not answer: %s" % e)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
