import json, re

import escapes
import planning
import states

CAP = 30
FIXES = 5
TRIES = 3
LIMIT = "1000"
PAUSED = "factory-paused"
GAPS = re.compile(r"^Gaps of #(\d+):")
PART_OF = re.compile(r"Part of\W*#(\d+)\b")
HEADING = re.compile(r"(?m)^\s*(?:#{1,6}\s+|\d+\.\s+\*\*|\*\*)(?!Part of\b|Repairs\b)([^*\n]+)")
END_LABEL = {"merged": "factory-done", "superseded": "factory-done", "unsolvable": "factory-unsolvable"}
LISTS = ("plan_label_no_plan", "ready_label_ended_job", "parked_but_moving", "duplicate_gaps", "ended_unlabelled")


def read(gh, repo):
    return json.loads(gh(["issue", "list", "-R", repo, "--state", "open", "--limit", LIMIT, "--json", "number,labels,title,body"]))


def names(i):
    return {x["name"] for x in i.get("labels") or []}


def check(issues, data, rows):
    jobs, kv = data["jobs"], data["kv"]
    moving = {r["issue"] for r in rows if r.get("station") != "job" and (r.get("handover") or {}).get("status") == "taken"}
    out = {k: [] for k in LISTS}
    waiting = 0
    gaps = {}
    for i in sorted(issues, key=lambda i: i["number"]):
        n, have = i["number"], names(i)
        j = jobs.get(str(n))
        plan = (kv.get("plan:%d" % n) or {}).get("state")
        if planning.LABEL in have and (plan is None or plan in planning.ENDED + ("unsent",)):
            out["plan_label_no_plan"].append(n)
        if PAUSED in have and str(n) in moving:
            out["parked_but_moving"].append(n)
        if planning.READY in have and j is None and PAUSED not in have:
            waiting += 1
        if j is not None and j["state"] in states.END and json.loads(j.get("data") or "{}").get("relabelled"):
            want = END_LABEL.get(j["state"], "factory-blocked")
            if planning.READY in have and want in have:
                out["ready_label_ended_job"].append(n)
            if want not in have and planning.READY not in have and PAUSED not in have and (plan is None or plan in ("blocked", "lost")):
                out["ended_unlabelled"].append({"issue": n, "want": want})
        m = GAPS.match(i.get("title") or "")
        if m:
            gaps.setdefault(int(m.group(1)), []).append(n)
    out["duplicate_gaps"] = [{"parent": p, "keep": ns[-1], "older": ns[:-1]} for p, ns in sorted(gaps.items()) if len(ns) > 1]
    out["ready_waiting"] = waiting
    out["more"] = {k: max(0, len(out[k]) - CAP) for k in LISTS}
    for k in LISTS:
        out[k] = out[k][:CAP]
    return out


def fix(gh, repo, store, drift):
    done = []
    for n in drift.get("plan_label_no_plan") or []:
        if len(done) >= FIXES:
            break
        job = "labelfix:%d" % n
        rec = store.get_all(job)
        tries = int(rec.get("tries") or 0)
        if rec.get("plan") or tries >= TRIES:
            continue
        store.set(job, "tries", tries + 1)
        try:
            gh(["issue", "edit", str(n), "-R", repo, "--remove-label", planning.LABEL])
        except Exception as e:  # noqa: BLE001
            done.append({"issue": n, "did": "could not remove %s: %s" % (planning.LABEL, type(e).__name__)})
            continue
        store.set(job, "plan", "1")
        done.append({"issue": n, "did": "removed " + planning.LABEL})
    return done


IDLE_PLAN = ("blocked", "lost")
DONE_ACCEPT = ("accepted", "closed")


GAPS_TITLE = re.compile(r"^Gaps of #(\d+)\b")


def open_parents(issues):
    parents = set()
    for i in issues or ():
        m = GAPS_TITLE.match(i.get("title") or "")
        if m:
            parents.add(int(m.group(1)))
        for m in PART_OF.finditer(i.get("body") or ""):
            parents.add(int(m.group(1)))
    return parents


def busy(n, data, children=()):
    if children and not isinstance(children, (set, frozenset)):
        children = open_parents(children)
    j = data["jobs"].get(str(n))
    plan = (data["kv"].get("plan:%d" % n) or {}).get("state")
    accept = (data["kv"].get("accept:%d" % n) or {}).get("state")
    recheck = (data["kv"].get("recheck:%d" % n) or {}).get("state")
    classify = data["kv"].get("classify:%d" % n) or {}
    return ((j is not None and j["state"] not in states.END) or (plan is not None and plan not in IDLE_PLAN)
            or (accept is not None and accept not in DONE_ACCEPT) or recheck in ("sending", "running")
            or classify.get("state") == "running" or bool(classify.get("run")) or n in children)


def body(gh, repo, n):
    return json.loads(gh(["issue", "view", str(n), "-R", repo, "--json", "body"])).get("body") or ""


def gap_headings(text):
    return [" ".join(m.group(1).strip().rstrip(":").lower().split()) for m in HEADING.finditer(text or "")]

def covered(gh, repo, dup, n):
    kept = body(gh, repo, dup["keep"])
    if not re.search(r"Part of\W*#%d\b" % dup["parent"], kept):
        return "#%d does not say it is part of #%d" % (dup["keep"], dup["parent"])
    old = body(gh, repo, n)
    old_repairs = escapes.repairs(old)
    if not old_repairs:
        return "it has no **Repairs** numbers to compare"
    extra = set(old_repairs) - set(escapes.repairs(kept))
    if extra:
        return "it lists repairs %s that #%d does not" % (", ".join("#%d" % x for x in sorted(extra)), dup["keep"])
    old_heads, kept_heads = gap_headings(old), gap_headings(kept)
    if old_heads != kept_heads:
        return "its gap headings differ from #%d" % dup["keep"]
    return None


def close_gaps(gh, repo, store, drift, data, issues=None):
    out, used = [], 0
    children = open_parents(issues)
    for dup in drift.get("duplicate_gaps") or []:
        for n in dup["older"]:
            job = "gapclose:%d" % n
            rec = store.get_all(job)
            tries = int(rec.get("tries") or 0)
            if rec.get("closed") or rec.get("kept") or tries >= TRIES:
                continue
            if busy(n, data, children):
                if rec.get("seen"):
                    store.set(job, "seen", "")
                continue
            if used >= FIXES:
                continue
            used += 1
            try:
                why = covered(gh, repo, dup, n)
            except Exception as e:  # noqa: BLE001
                store.set(job, "tries", tries + 1)
                out.append({"issue": n, "keep": dup["keep"], "did": "could not read: %s" % type(e).__name__})
                continue
            if why:
                store.set(job, "kept", "1")
                out.append({"issue": n, "keep": dup["keep"], "did": "left open: " + why})
                continue
            if rec.get("seen") != str(dup["keep"]):
                store.set(job, "seen", dup["keep"])
                out.append({"issue": n, "keep": dup["keep"], "did": "would close"})
                continue
            store.set(job, "tries", tries + 1)
            try:
                gh(["issue", "close", str(n), "-R", repo, "--reason", "not planned", "--comment",
                    "Closed by the factory as a duplicate: #%d is the newest open gap issue of #%d and lists every repair this one lists." % (dup["keep"], dup["parent"])])
            except Exception as e:  # noqa: BLE001
                out.append({"issue": n, "keep": dup["keep"], "did": "could not close: %s" % type(e).__name__})
                continue
            store.set(job, "closed", "1")
            out.append({"issue": n, "keep": dup["keep"], "did": "closed"})
    return out
