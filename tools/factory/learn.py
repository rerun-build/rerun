import json
import factory as F

MAX_ITEMS = 3
BRIEF_CUT = 6000


def record(store, job):
    j = store.get_job(job) or {}
    rows = [t for t in store.transitions_of(job) if t["from_state"] != t["to_state"]]
    kept = [{"from": t["from_state"], "to": t["to_state"], "reason": (t["reason"] or "")[:200], "at": t["at"]}
            for t in rows[-40:]]
    cur = store.db.execute("SELECT * FROM fires WHERE job=? AND stage NOT LIKE 'learn%' ORDER BY id", (job,))
    all_fires = [dict(r) for r in cur]
    fires = [{"run": f["run_id"], "stage": f["stage"], "coworker": f["coworker"], "status": f["status"],
              "tokens_in": f["tokens_in"], "tokens_out": f["tokens_out"], "cache_read": f["cache_read"],
              "cache_write": f["cache_write"], "seconds": f["seconds"], "error": (f["error"] or "")[:200]}
             for f in all_fires[-30:]]

    def total(key):
        return sum(f[key] or 0 for f in fires)

    hashes = []
    for r in store.db.execute("SELECT brief FROM failures WHERE job=? AND brief IS NOT NULL ORDER BY id", (job,)):
        if r["brief"] not in hashes:
            hashes.append(r["brief"])
    briefs = []
    for h in hashes:
        kept_text = store.brief_text(h)
        if kept_text:
            briefs.append({"hash": h, "state": kept_text["state"], "text": kept_text["text"][:BRIEF_CUT]})

    return {"job": job, "state": j.get("state"), "pr": j.get("pr"), "review": (j.get("review") or "")[:1500],
            "transitions": kept, "transitions_total": len(rows),
            "rounds": sum(1 for t in kept if t["to"] == "fix_wait"),
            "fires": fires, "fires_total": len(all_fires),
            "not_done": sum(1 for f in fires if f["status"] != "done"),
            "tokens": {"in": total("tokens_in"), "out": total("tokens_out"),
                       "cache_read": total("cache_read"), "cache_write": total("cache_write")},
            "briefs": briefs}


def brief(record, repo, issue, max_items=MAX_ITEMS):
    name = repo.split("/")[-1]
    name = F.FOLDER_NAMES.get(name, name)
    body = json.dumps(record, indent=1, sort_keys=True)
    return "\n".join([
        f"JOB {name}#{issue} LEARN",
        f"The job is closed: https://github.com/{repo}/issues/{issue}",
        "",
        "Answer one question: what did this job have to find out, or get wrong, that one line would have told it?",
        f"Propose at most {max_items} lines. Each target is one brain page slug. One line per concept.",
        "Nothing generic, nothing the code already says, no one-off. A lesson that names an incident carries its date.",
        "Nothing from a key file, a run's raw output or a private address.",
        "",
        "The outcome record:",
        "```json",
        body,
        "```",
        "",
        "Answer with a ```json block holding a list of "
        '{"target", "op", "line", "reason", "evidence"}. op is add or remove; '
        f"evidence is a link to an issue or a pull request of {repo}.",
        "Last line: PROPOSALS: <n>, or, with no block, NO PROPOSALS: <one sentence>.",
    ])
