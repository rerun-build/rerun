def _coworkers(items):
    return [dict({"id": c["id"], "name": c["name"], "runs": c.get("runs", 1)}, **({"provider": c["provider"]} if c.get("provider") else {}))
            for c in items]


def types(cfg):
    if "types" in cfg:
        return {t: {"coworkers": _coworkers(v.get("coworkers", [])),
                    "max_jobs": v.get("max_jobs")}
                for t, v in cfg["types"].items()}
    return {
        "coder": {"coworkers": _coworkers(cfg.get("builders", [])),
                  "max_jobs": cfg.get("max_jobs", 8)},
        "reviewer": {"coworkers": _coworkers(cfg.get("reviewers", [])),
                     "max_jobs": None},
    }


def names(cfg):
    return {c["id"]: c["name"] for t in types(cfg).values() for c in t["coworkers"]}


def pick(cfg, worker, busy):
    t = types(cfg).get(worker)
    if t is None:
        return None
    return next((c["id"] for c in t["coworkers"] if c["id"] not in busy), None)


def max_jobs(cfg, worker):
    t = types(cfg).get(worker)
    return None if t is None else t["max_jobs"]


def provider_of(cfg, agent):
    for t in types(cfg).values():
        for c in t.get("coworkers", []):
            if c.get("id") == agent:
                return c.get("provider") or "claude"
    return "claude"


def free_copies(cfg, worker, running, exclude=()):
    t = types(cfg).get(worker)
    if t is None or cfg.get("held"):
        return []
    out = []
    for c in [c for c in t["coworkers"] if c["id"] not in exclude]:
        if cfg.get("held_plan") and (c.get("provider") or "claude") == "claude":
            continue
        taken = {1 if k is None else k for i, k in running if i == c["id"]}
        if len([1 for i, _ in running if i == c["id"]]) >= c["runs"]:
            continue
        out += [(c["id"], n) for n in range(1, c["runs"] + 1) if n not in taken]
    return out


def pick_copy(cfg, worker, running, exclude=()):
    got = free_copies(cfg, worker, running, exclude)
    return got[0] if got else None
