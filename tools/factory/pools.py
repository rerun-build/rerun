def _coworkers(items):
    return [{"id": c["id"], "name": c["name"], "runs": c.get("runs", 1)} for c in items]


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


def pick_copy(cfg, worker, running):
    t = types(cfg).get(worker)
    if t is None:
        return None
    for c in t["coworkers"]:
        taken = {1 if k is None else k for i, k in running if i == c["id"]}
        if len([1 for i, _ in running if i == c["id"]]) >= c["runs"]:
            continue
        copy = next((n for n in range(1, c["runs"] + 1) if n not in taken), None)
        if copy is not None:
            return c["id"], copy
    return None
