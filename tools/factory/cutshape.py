import re

WORKERS = ("coder", "reviewer", "researcher", "designer")
_DEP = re.compile(r"^\s*\*\*Depends on(?:\*\*\s*:|\s*:\s*\*\*)(.*)$", re.I)
_PART = re.compile(r"^\s*\*\*Part of(?:\*\*\s*:|\s*:\s*\*\*)(.*)$", re.I)
_WORKER = re.compile(r"^\s*\*\*Worker(?:\*\*\s*:|\s*:\s*\*\*)(.*)$", re.I)
_TEST = re.compile(r"^\s*\*\*Test file(?:\*\*\s*:|\s*:\s*\*\*)(.*)$", re.I)
_FILES = re.compile(r"^\s*\*\*Files\*\*")
_BULLET = re.compile(r"^\s*[-*+]\s+(.*)$")
_TICK = re.compile(r"`([^`]*)`")
_NUM = re.compile(r"#(\d+)")
_PLAN = re.compile(r"^PLAN READY\b(.*)$")
_DEV = re.compile(r"\bdev ([0-9a-f]{7,40})\b", re.I)


def _bad_path(p):
    if not p or p.startswith("/") or p.startswith("\\") or re.match(r"^[A-Za-z]:", p):
        return True
    return ".." in re.split(r"[/\\]", p)


def parse(issue):
    number = issue["number"]
    lines = (issue.get("body") or "").splitlines()
    errors = []
    deps = []

    dep_lines = [m.group(1) for m in (_DEP.match(l) for l in lines) if m]
    if len(dep_lines) != 1:
        errors.append("dependency line: expected exactly one '**Depends on**: #a, #b' or 'none' line, found %d" % len(dep_lines))
    else:
        rest = dep_lines[0]
        nums = [int(n) for n in _NUM.findall(rest)]
        if nums:
            deps = sorted(set(nums) - {number})
        elif not re.search(r"\bnone\b", rest, re.I):
            errors.append("dependency line: carries neither an issue number nor 'none' on that line")

    parent = None
    pl = [m.group(1) for m in (_PART.match(l) for l in lines) if m]
    if len(pl) > 1:
        errors.append("part of line: more than one **Part of** line")
    elif pl:
        pn = _NUM.search(pl[0])
        if pn and int(pn.group(1)) != number:
            parent = int(pn.group(1))

    worker = "coder"
    wl = [m.group(1).strip() for m in (_WORKER.match(l) for l in lines) if m]
    if len(wl) > 1:
        errors.append("worker: more than one Worker line")
    elif wl:
        w = wl[0].strip("` ").lower()
        if w in WORKERS:
            worker = w
        else:
            errors.append("worker: '%s' is not one of %s" % (wl[0], ", ".join(WORKERS)))

    paths = []
    start = next((i for i, l in enumerate(lines) if _FILES.match(l)), None)
    if start is None:
        errors.append("files: no **Files** heading")
    else:
        for l in lines[start + 1:]:
            if l.startswith("**"):
                break
            b = _BULLET.match(l)
            if not b:
                continue
            ticks = _TICK.findall(b.group(1))
            if len(ticks) != 1:
                errors.append("files: bullet needs exactly one path in backticks: %s" % l.strip())
            elif _bad_path(ticks[0].strip()):
                errors.append("files: unreadable path '%s'" % ticks[0])
            else:
                paths.append(ticks[0].strip())
        if not paths and not any(e.startswith("files:") for e in errors):
            errors.append("files: at least one path is needed")

    test = None
    tl = [m.group(1) for m in (_TEST.match(l) for l in lines) if m]
    if len(tl) > 1:
        errors.append("test file: more than one Test file line")
    elif tl:
        t = _TICK.findall(tl[0])
        if len(t) != 1:
            errors.append("test file: needs exactly one path in backticks on the line")
        else:
            test = t[0].strip()
            if test not in paths:
                errors.append("test file: '%s' is not one of the Files paths" % test)

    dev = None
    plan = next((m for m in (_PLAN.match(ln) for ln in lines) if m), None)
    if plan:
        found = _DEV.search(plan.group(1))
        if found:
            dev = found.group(1).lower()
        else:
            errors.append("plan line: the PLAN READY line must name the dev commit as 'dev <sha>' (7 to 40 hex)")

    return {"number": number, "deps": deps, "worker": worker, "paths": paths, "test": test, "parent": parent, "dev": dev, "errors": errors}


def cycles(parsed):
    items = parsed if isinstance(parsed, list) else [parsed]
    graph = {p["number"]: [d for d in p["deps"]] for p in items}
    graph = {n: [d for d in ds if d in graph] for n, ds in graph.items()}
    found = []

    def walk(start, node, path):
        for nxt in graph[node]:
            if nxt == start:
                found.append(list(path))
            elif nxt > start and nxt not in path:
                walk(start, nxt, path + [nxt])

    for s in sorted(graph):
        walk(s, s, [s])
    return found


def check(issues):
    parsed = [parse(i) for i in issues]
    out = {p["number"]: list(p["errors"]) for p in parsed}
    for cyc in cycles(parsed):
        text = "in a cycle: " + " -> ".join("#%d" % n for n in cyc + [cyc[0]])
        for n in cyc:
            out[n].append(text)
    return out


def comment(errors):
    lines = ["The factory delegator cannot read this issue, so it is not started:"]
    lines += ["- %s" % e for e in errors]
    lines.append("Fix the issue text; the label stays and the next beat reads it again.")
    return "\n".join(lines)
