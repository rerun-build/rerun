import re

SIZES = ("small", "medium", "large")
TIERS = ("low", "medium", "high")
SIZE_LINE = re.compile(r"^\s*\*\*size\*\*\s*:\s*(\S+)\s*$", re.IGNORECASE | re.MULTILINE)


def size_of(body):
    if not body:
        return "medium"
    found = SIZE_LINE.findall(body)
    if not found:
        return "medium"
    if len(found) > 1:
        raise ValueError("two Size lines")
    size = found[0].lower()
    if size not in SIZES:
        raise ValueError("unknown size: " + found[0])
    return size


def tier_for(station, size, table):
    if not table:
        return None
    if station not in table:
        raise ValueError("station without a tier: " + str(station))
    entry = table[station]
    if isinstance(entry, dict):
        if size not in entry:
            raise ValueError("no tier for size: " + str(size))
        entry = entry[size]
    if entry not in TIERS:
        raise ValueError("unknown tier: " + str(entry))
    return entry


EFFORTS = ("low", "medium", "high")


def model_for(station, tier, table):
    if not table or tier is None:
        return None
    if station not in table:
        raise ValueError("station without a model: " + str(station))
    if tier not in table[station]:
        raise ValueError("no model for tier: " + str(tier))
    entry = table[station][tier]
    if not isinstance(entry, dict) or not entry.get("model") or not isinstance(entry["model"], str):
        raise ValueError("empty model for tier: " + str(tier))
    if entry.get("thinkingLevel") not in EFFORTS:
        raise ValueError("unknown effort: " + str(entry.get("thinkingLevel")))
    return {"model": entry["model"], "thinkingLevel": entry["thinkingLevel"]}
