import hashlib
import json
import os
import re
from fractions import Fraction

import authors
import pools

EVERY = 5
TITLE = "Factory control"
BLOCK = re.compile(r"```json\s*(.*?)```", re.S)
BOUNDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "control-bounds.json")


def load_bounds(path=BOUNDS):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def parse(body):
    if not body:
        return None, []
    found = BLOCK.search(body)
    if not found:
        return None, []
    try:
        block = json.loads(found.group(1))
    except ValueError:
        return None, ["the json block does not parse"]
    if not isinstance(block, dict):
        return None, ["the json block is not an object"]
    return block, []


def whole(n):
    return isinstance(n, int) and not isinstance(n, bool)


def validate(block, bounds, base, last):
    settable = bounds.get("settable", [])
    effective = {key: dict(base.get(key, {})) for key in settable}
    errors = []
    for key, value in block.items():
        if key not in settable:
            errors.append(f"{key}: the control block may not set this key")
            continue
        if not isinstance(value, dict):
            errors.append(f"{key}: must be an object")
            continue
        for name, n in value.items():
            bound = bounds.get(key, {}).get(name)
            if bound is None:
                errors.append(f"{key}.{name}: no bound for it")
                previous = (last or {}).get(key, {})
                if name in previous:
                    effective[key][name] = previous[name]
                continue
            if not whole(n) or n < 0 or n > bound:
                errors.append(f"{key}.{name}: {n!r} is not a whole number from 0 to {bound}")
                previous = (last or {}).get(key, {})
                if name in previous:
                    effective[key][name] = previous[name]
                continue
            effective[key][name] = n
    return effective, errors


CHECKS = (("reviewer", ("review", "proof")), ("acceptor", ("acceptance",)))


def names_of(types, kind):
    group = (types or {}).get(kind) or {}
    return [c["name"] for c in group.get("coworkers", [])]


def follow(copies, types, bounds, ratio):
    if not ratio:
        return copies, []
    out = dict(copies)
    lines = []
    builders = [n for n in names_of(types, "coder") if n in out]
    for kind, keys in CHECKS:
        names = [n for n in names_of(types, kind) if n in out]
        if not names:
            continue
        per = sum((Fraction(str(ratio[k])) for k in keys if k in ratio), Fraction(0))
        if per <= 0:
            continue
        build = sum(out[n] for n in builders)
        need = -((-build * per.numerator) // per.denominator)
        have = sum(out[n] for n in names)
        for n in names:
            if have >= need:
                break
            top = max(bounds.get(n, out[n]), out[n])
            step = min(top - out[n], need - have)
            out[n] += step
            have += step
        if have >= need:
            continue
        keep = have * per.denominator // per.numerator
        extra = build - keep
        for n in reversed(builders):
            cut = min(out[n], extra)
            out[n] -= cut
            extra -= cut
        unbounded = [n for n in names if n not in bounds]
        line = (f"copies: builders held at {keep} of {build} asked: the {kind} copies can follow"
                f" only {keep} ({float(per):g} per build copy, at most {have})")
        if unbounded:
            line += f"; no limit in control-bounds.json for {', '.join(unbounded)}"
        lines.append(line)
    return out, lines


class Control:
    def __init__(self, cfg, gh, store, bounds=None):
        self.cfg = cfg
        self.gh = gh
        self.store = store
        self.bounds = bounds if bounds is not None else load_bounds()
        self.base = {}
        for key in self.bounds.get("settable", []):
            if key == "copies":
                self.base[key] = {c["name"]: c["runs"]
                                  for t in pools.types(cfg).values() for c in t["coworkers"]}
            else:
                self.base[key] = {}
        self.effective = {key: dict(value) for key, value in self.base.items()}
        self.seen = False

    def issue(self):
        rows = json.loads(self.gh(["issue", "list", "-R", self.cfg["repo"], "--state", "open",
                                   "--search", "Factory control in:title",
                                   "--json", "number,title,body,author", "--limit", "20"]))
        return next((r for r in rows if r.get("title") == TITLE and (authors.is_rob(r) or "author" not in r)), None)

    def tick(self, beat):
        if self.seen and beat % EVERY:
            return
        try:
            issue = self.issue()
        except Exception:
            return
        self.seen = True
        block, parse_errors = parse(issue.get("body") if issue else None)
        effective, errors = validate(block or {}, self.bounds, self.base, self.effective)
        held = []
        if "copies" in effective:
            effective["copies"], held = follow(effective["copies"], self.cfg.get("types") or {},
                                               self.bounds.get("copies", {}), self.cfg.get("check_ratio"))
        self.record(effective)
        self.effective = effective
        self.apply()
        self.complain(issue, parse_errors + errors, held)

    def record(self, effective):
        for key in sorted(set(effective) | set(self.effective)):
            new = effective.get(key, {})
            old = self.effective.get(key, {})
            for name in sorted(set(new) | set(old)):
                if old.get(name) != new.get(name):
                    self.store.add_event(f"{key}.{name}", old.get(name), new.get(name))

    def apply(self):
        copies = self.effective.get("copies", {})
        for t in self.cfg.get("types", {}).values():
            for c in t.get("coworkers", []):
                if c.get("name") in copies:
                    c["runs"] = copies[c["name"]]

    def complain(self, issue, refused, held):
        if not issue:
            return
        problems = list(refused) + list(held)
        digest = hashlib.sha1("\n".join(problems).encode("utf-8")).hexdigest() if problems else ""
        if digest == self.store.get_all("-").get("control_errors"):
            return
        if problems:
            sections = []
            if refused:
                sections.append("Factory control: these values were refused and the last valid values stay.\n"
                                + "\n".join(f"- {e}" for e in refused))
            if held:
                sections.append("Factory control: builder copies are held so the checker copies can follow.\n"
                                + "\n".join(f"- {e}" for e in held))
            body = "\n\n".join(sections)
            try:
                self.gh(["issue", "comment", str(issue["number"]), "-R", self.cfg["repo"], "--body", body])
            except Exception:
                return
        self.store.set("-", "control_errors", digest)
