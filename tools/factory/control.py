import json
import os
import re

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
