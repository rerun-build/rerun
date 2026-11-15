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
