import re

HEADINGS = {"change": "change", "corrections": "change", "done-test": "done", "run": "run"}
ASK_LINE = re.compile(r"^ASK (\d+): (MET \S+:\d+ \S.*|NOT MET \S.*)$")
PROOF_LINE = re.compile(r"^PROOF: (PASS|FAIL) (?:@|at )([0-9a-f]{7,40})(?:: (.*))?$")


def plain(body):
    return str(body or "").replace("\r\n", "\n")


def asks(body):
    out, kind, fenced, done = [], None, False, False
    for line in plain(body).split("\n"):
        m = re.match(r"^\*\*([A-Za-z-]+)\*\*", line)
        if m and not fenced:
            kind = HEADINGS.get(m.group(1).lower())
            done = False
            if kind == "done":
                out.append("Done-test")
            continue
        if kind == "change" and re.match(r"^[-*] \S", line):
            out.append(line[2:].strip())
        elif kind == "run":
            if line.startswith("```"):
                fenced = not fenced
                done = done or not fenced
            elif fenced and line.strip() and not done:
                out.append(line.strip())
    return out


def judge(out, count, head):
    lines = [l.strip() for l in plain(out).split("\n") if l.strip()]
    last = next((l for l in reversed(lines) if l.startswith("PROOF:")), None)
    m = PROOF_LINE.match(last) if last else None
    if not m and last and re.match(r"PROOF: (PASS|FAIL)\b", last):
        return "none", "proof names no commit, the head is %s" % head[:7]
    if not m:
        return "none", "no PROOF line"
    if m.group(2)[:7] != head[:7]:
        return "none", "proof names %s, the head is %s" % (m.group(2)[:7], head[:7])
    got = {}
    for l in lines:
        a = ASK_LINE.match(l)
        if a:
            got[int(a.group(1))] = a.group(2).startswith("MET ")
    if m.group(1) == "FAIL":
        return "fail", (m.group(3) or "no ask numbers")[:200]
    if sorted(got) != list(range(1, count + 1)):
        return "fail", "PASS names %d of the %d asks" % (len(got), count)
    missed = [str(n) for n in sorted(got) if not got[n]]
    if missed:
        return "fail", "PASS with asks not met: " + ", ".join(missed)
    return "pass", None
