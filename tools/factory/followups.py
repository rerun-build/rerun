import hashlib, re

NOTE = re.compile(r"^\s*(?:[-*]\s*)?(?:follow-?up|non-?blocking)\s*:\s*(\S.*?)\s*$", re.I)
MARK = re.compile(r"<!-- followup:(\S+) -->")


def notes(verdict, job):
    out = []
    for line in (verdict or "").splitlines():
        m = NOTE.match(line)
        if m:
            text = m.group(1)
            key = "%s-%s" % (job, hashlib.sha1(text.lower().encode()).hexdigest()[:10])
            out.append((key, text[:80], "%s\n\nFrom the review of %s.\n\n<!-- followup:%s -->" % (text, job, key)))
    return out


def known(bodies):
    return {k for b in bodies for k in MARK.findall(b or "")}


def create(client, found, existing=()):
    seen, opened = set(existing), []
    for key, title, body in found:
        if key not in seen:
            client.create_issue(title, body)
            seen.add(key)
            opened.append(key)
    return opened
