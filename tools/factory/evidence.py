import fnmatch, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F
import gate as G
import ledger as L
from limits import ts

VERDICT_RE = re.compile(r"^\s*PLAN (READY|REJECT)\b", re.M)


def comments(get, full, n):
    return sorted(get("repos/%s/issues/%s/comments?per_page=100" % (full, n), paginate=True), key=lambda c: (ts(c["created_at"]), c["id"]))


def plan(get, full, issue, fired):
    for c in reversed(comments(get, full, issue)):
        if ts(c["created_at"]) <= ts(fired) or "## Chunks" not in (c.get("body") or ""):
            continue
        lines = L.chunk_lines(c["body"])
        if not lines:
            return "NONE", "plan comment %s has no chunk lines" % c.get("html_url", c["id"])
        bad = ["chunk line %d: %s" % (i + 1, "; ".join(L.shape(l))) for i, l in enumerate(lines) if L.shape(l)]
        if bad:
            return "NONE", "plan comment %s: %s" % (c.get("html_url", c["id"]), " | ".join(bad))
        return "OK", {"comment": c["id"], "created_at": c["created_at"], "chunks": [L.chunk(l) for l in lines]}
    return "NONE", "no plan comment with ## Chunks after %s" % fired


def challenge(get, full, issue, plan_comment):
    cs = comments(get, full, issue)
    p = next((c for c in cs if c["id"] == plan_comment), None)
    if p is None:
        return "NONE", "plan comment %s not found" % plan_comment
    after = (ts(p["created_at"]), p["id"])
    for c in cs:
        found = VERDICT_RE.findall(c.get("body") or "")
        if found and (ts(c["created_at"]), c["id"]) > after:
            return found[-1], {"comment": c["id"], "text": c["body"]}
    return "NONE", "no PLAN READY or PLAN REJECT after plan comment %s" % plan_comment


def build(get, full, issue, job_branch, ch, fired):
    branch = "chunk/%s-%s" % (issue, ch["id"])
    refs = get("repos/%s/git/matching-refs/heads/%s" % (full, branch))
    head = next((r["object"]["sha"] for r in refs if r.get("ref") == "refs/heads/" + branch), None)
    if not head:
        return "NONE", "%s was not pushed" % branch
    cmp = get("repos/%s/compare/%s...%s" % (full, job_branch, branch))
    if not any(ts(c["commit"]["committer"]["date"]) > ts(fired) for c in cmp.get("commits", [])):
        return "NONE", "no commit after %s on %s" % (fired, branch)
    files = [f["filename"] for f in cmp.get("files", [])]
    if ch["test"] not in files:
        return "NONE", "test file %s is not in the diff" % ch["test"]
    out = [f for f in files if not any(fnmatch.fnmatch(f, p) for p in ch["paths"])]
    if out:
        return "NONE", "files outside paths: " + ", ".join(out)
    lines = sum(f.get("additions", 0) + f.get("deletions", 0) for f in cmp.get("files", []))
    flags = ["%d changed lines > max-lines %d" % (lines, ch["max_lines"])] if ch.get("max_lines") and lines > ch["max_lines"] else []
    return "OK", {"sha": head, "files": files, "lines": lines, "flags": flags}


def review(get, full, pr, head, name, fired):
    for c in reversed(comments(get, full, pr)):
        m = G.REVIEW_RE.match(c.get("body") or "")
        if m and m.group(2) == head[:8] and m.group(3).upper() == name.upper() and ts(c["created_at"]) > ts(fired):
            return m.group(4), {"comment": c["id"], "url": c.get("html_url")}
    return "NONE", "no %s verdict @%s after %s" % (name.upper(), head[:8], fired)


def ci_at_commit(get, full, branch):
    refs = get("repos/%s/git/matching-refs/heads/%s" % (full, branch))
    sha = next((r["object"]["sha"] for r in refs if r.get("ref") == "refs/heads/" + branch), None)
    if not sha:
        return "NONE", "%s was not pushed" % branch
    cs = get("repos/%s/commits/%s/check-runs?per_page=100" % (full, sha)).get("check_runs", [])
    ci = F.ci_state(cs)
    return ("NONE", "no check-runs at %s" % sha[:8]) if ci == "NONE" else ("OK" if ci == "GREEN" else ci), {"sha": sha, "ci": ci}


def verdict(get, full, pr, name, fired):
    head = get("repos/%s/pulls/%s" % (full, pr))["head"]["sha"]
    v, d = review(get, full, pr, head, name, fired)
    if v != "NONE":
        return v, d
    for c in reversed(comments(get, full, pr)):
        m = G.REVIEW_RE.match(c.get("body") or "")
        if m and m.group(3).upper() == name.upper() and ts(c["created_at"]) > ts(fired):
            return "NONE", "%s verdict names %s, PR head is %s" % (name.upper(), m.group(2), head[:8])
    return v, d


def stage_check(get, f, kv, ready):
    if f["stage"] != "build":
        return "OK", ""
    full = re.sub(r"(\.git)?/*$", "", kv["repo_url"]).split("github.com/")[-1]
    ch = {"id": f["chunk"], "test": kv["test:" + f["chunk"]].split()[-1], "paths": ready["paths"]}
    return build(get, full, f["job"], "job/" + f["job"], ch, f["intent_at"])
