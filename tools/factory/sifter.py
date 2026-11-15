import re

_PLAN = re.compile(r"^PLAN READY\b")
_DEV = re.compile(r"\bdev [0-9a-f]{7,40}\b", re.I)
_SLIP = re.compile(r"\bdev (?:at )?`?([0-9a-f]{7,40})\b`?", re.I)


def sift(body):
    lines = (body or "").split("\n")
    for k, line in enumerate(lines):
        if not _PLAN.match(line):
            continue
        if _DEV.search(line):
            return body, []
        fixed = _SLIP.sub(r"dev \1", line, count=1)
        if fixed == line:
            return body, []
        lines[k] = fixed
        return "\n".join(lines), ["plan line names dev <sha>"]
    return body, []
