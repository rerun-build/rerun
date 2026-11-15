import hashlib
import json
import os
import re

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
                                   "--json", "number,title,body", "--limit", "20"]))
        return next((r for r in rows if r.get("title") == TITLE), None)

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
        self.record(effective)
        self.effective = effective
        self.apply()
        self.complain(issue, parse_errors + errors)

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

    def complain(self, issue, errors):
        if not issue:
            return
        digest = hashlib.sha1("\n".join(errors).encode("utf-8")).hexdigest() if errors else ""
        if digest == self.store.get_all("-").get("control_errors"):
            return
        if errors:
            body = ("Factory control: these values were refused and the last valid values stay.\n"
                    + "\n".join(f"- {e}" for e in errors))
            try:
                self.gh(["issue", "comment", str(issue["number"]), "-R", self.cfg["repo"], "--body", body])
            except Exception:
                return
        self.store.set("-", "control_errors", digest)
