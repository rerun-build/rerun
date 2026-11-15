WEIGHTS = {"P0": 8, "P1": 4, "P2": 2, "P3": 1}
SKIP = frozenset(("factory", "factory-plan", "factory-done", "factory-blocked", "likely-fixed", "duplicate"))


def names(issue):
    return {label["name"] for label in issue.get("labels", []) if isinstance(label, dict) and "name" in label}


def weight(issue):
    return max((WEIGHTS[n] for n in names(issue) if n in WEIGHTS), default=0)


def unplanned(issues):
    kept = [i for i in issues if weight(i) > 0 and not names(i) & SKIP]
    return sorted(kept, key=lambda i: (-weight(i), i.get("createdAt") or "", i["number"]))
