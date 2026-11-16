import re

FORMS = ({"prefix": "VERDICT: ", "rest": "sentence"},)

FENCE = "~~~~"


def _line(text, key):
    m = re.search(r"^\*\*%s\*\*:[ \t]*(.*)$" % key, text, re.M)
    return m.group(1).strip() if m else None


def _block(text, key):
    m = re.search(r"^\*\*%s\*\*[ \t]*\n%s[ \t]*\n(.*?)(?:\n)?^%s[ \t]*$" % (key, FENCE, FENCE), text, re.M | re.S)
    return m.group(1) if m else None


def parse(issue):
    if isinstance(issue, dict):
        number, text = issue.get("number"), issue.get("body") or ""
    else:
        number, text = None, issue or ""
    errors = []
    out = {"number": number}
    for key, name in (("Coworker", "coworker"), ("Cause", "cause"), ("Reason", "reason")):
        value = _line(text, key)
        if not value:
            errors.append("the line **%s**: is missing" % key)
        out[name] = value or ""
    old = _block(text, "Old text")
    new = _block(text, "New text")
    if old is None:
        errors.append("the **Old text** block is missing")
    if new is None:
        errors.append("the **New text** block is missing")
    elif not new.strip():
        errors.append("the new text is empty")
    out["old"] = old or ""
    out["new"] = new or ""
    out["errors"] = errors
    return out


def apply(soul, old, new):
    if not old:
        return soul.rstrip("\n") + "\n\n" + new + "\n"
    n = soul.count(old)
    if n != 1:
        raise ValueError("the old text occurs %d times in the coworker's instructions; it must occur once" % n)
    return soul.replace(old, new, 1)


def body(coworker, cause, reason, old, new):
    return (
        "**Coworker**: %s\n**Cause**: %s\n**Reason**: %s\n\n"
        "**Old text**\n%s\n%s\n%s\n\n**New text**\n%s\n%s\n%s\n"
        % (coworker, cause, reason, FENCE, old, FENCE, FENCE, new, FENCE)
    )


def revert_body(number, parsed, fact):
    reason = "Reverts #%s: it did not lower its group (%s)." % (number, fact)
    return body(parsed["coworker"], parsed["cause"], reason, parsed["new"], parsed["old"])


def review_brief(repo, n, parsed):
    return "\n".join([
        "Review an instructions change: https://github.com/%s/issues/%s" % (repo, n),
        "Coworker: %s" % parsed["coworker"],
        "Cause: %s" % parsed["cause"],
        "Reason: %s" % parsed["reason"],
        "",
        "Old text:",
        FENCE,
        parsed["old"],
        FENCE,
        "",
        "New text:",
        FENCE,
        parsed["new"],
        FENCE,
        "",
        "Accept only when all of these hold:",
        "- the new text removes the cause named and is the smallest change that does",
        "- it contradicts no rule of the team and widens no permission",
        "- it holds no secret, address or name of a key file",
        "- it does not tell the coworker to pass a check it should fail",
        "",
        "End with one last line, exactly VERDICT: ACCEPT or VERDICT: REJECT: <one sentence>",
    ])


def verdict(out):
    prefix = FORMS[0]["prefix"]
    for line in reversed((out or "").splitlines()):
        line = line.strip()
        if line.startswith(prefix):
            rest = line[len(prefix):].strip()
            if rest == "ACCEPT":
                return "accept", line
            if rest.startswith("REJECT"):
                return "reject", line
            return None, "last VERDICT line is neither ACCEPT nor REJECT"
    return None, "no VERDICT line"
