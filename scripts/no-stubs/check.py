import re, subprocess, sys

OWN = "scripts/no-stubs/"
KINDS = (
    ("stub", re.compile(r"\bNotImplementedError\b|\btodo!\s*\(|\bunimplemented!\s*\(|['\"]not implemented['\"]", re.I)),
    ("focused test", re.compile(r"\b(?:it|test|describe)\.only\s*\(")),
    ("skipped test", re.compile(r"\b(?:it|test|describe)\.(?:skip|todo)\s*\(|\bx(?:it|describe|test)\s*\(|@unittest\.skip\s*\(|@pytest\.mark\.skip\s*\(")),
)
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)")


def find(diff):
    hits, path, line = [], None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            path = raw[6:] if raw.startswith("+++ b/") else None
            line = 0
            continue
        m = HUNK.match(raw)
        if m:
            line = int(m.group(1))
            continue
        if raw.startswith("-") or path is None:
            continue
        if raw.startswith("+"):
            text = raw[1:]
            if not path.startswith(OWN):
                for kind, rx in KINDS:
                    if rx.search(text):
                        hits.append({"path": path, "line": line or None, "kind": kind, "text": text.strip()[:160]})
                        break
            line += 1 if line else 0
        elif line:
            line += 1
    return hits


def main(base):
    diff = subprocess.run(["git", "diff", "--unified=0", base, "HEAD", "--", ".", ":!*.md"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
    hits = find(diff)
    for h in hits:
        print("%s:%s: %s left in: %s" % (h["path"], h["line"] or "?", h["kind"], h["text"]))
    if hits:
        print("A stub, a skipped test or a focused test was added. Finish the code, or make the skip conditional (skipIf, skipTest at run time).")
        return 1
    print("No stubs or switched-off tests added.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "HEAD^1"))
