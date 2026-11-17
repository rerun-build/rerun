import fnmatch
import re

import cutshape

SECTION = re.compile(r"^\*\*([A-Za-z -]+)\*\*")
SUBJECT_LINE = re.compile(r"^[-*] `[^`]*`")
TICKED = re.compile(r"`([^`]*)`")
POSITION = re.compile(r":\d+(?:-\d+)?$")
EXTENSION = re.compile(r"\.[A-Za-z0-9]+$")
ISSUE_NUMBER = re.compile(r"#\d+")
NEW_WORD = re.compile(r"\bnew\b", re.I)
CD = re.compile(r"^cd\s+(\S+)\s*&&\s*(.*)$")
TEST_NAME = re.compile(r"^(test_[^/]*\.py|[^/]*\.(test|spec)\.(js|ts|jsx|tsx))$")
RUN_TOOLS = ("unittest", "vitest", "pnpm")


def parts(body):
    sections, run = {}, []
    name, state = None, None
    for raw in (body or "").splitlines():
        line = raw.strip()
        if state == "fenced":
            if line.startswith("```"):
                state = None
            elif line:
                run.append(line)
            continue
        if state == "armed":
            if line.startswith("```"):
                state = "fenced"
                continue
            if line:
                state = None
        heading = SECTION.match(line)
        if heading:
            name = heading.group(1).strip().lower()
            state = "armed" if name == "run" else None
            if name != "run":
                sections.setdefault(name, [])
            else:
                name = None
            continue
        if name is not None and line:
            sections[name].append(line)
    return sections, run


def subject(line):
    if not SUBJECT_LINE.match(line):
        return None
    text = POSITION.sub("", TICKED.search(line).group(1))
    if " " in text or "*" in text:
        return None
    return text


def in_list(name, paths):
    return any(p == name or p.endswith("/" + name) for p in paths)


def tokens(line):
    m = CD.match(line)
    rest = m.group(2) if m else line
    return [t.strip("\"'`") for t in rest.split() if t.strip("\"'`")]


def prefix(line):
    m = CD.match(line)
    if not m or m.group(1) == ".":
        return ""
    return m.group(1) + "/"


def change_subjects(sections):
    out = []
    for line in sections.get("change", []) + sections.get("corrections", []):
        s = subject(line)
        if s and EXTENSION.search(s):
            out.append((s, line))
    return out


def test_names(sections, run):
    out = []
    for line in sections.get("done-test", []):
        s = subject(line)
        if s and not ISSUE_NUMBER.search(line) and TEST_NAME.match(s.rpartition("/")[2]):
            out.append(("done-test", s))
    for line in run:
        for tok in tokens(line):
            if "*" not in tok and TEST_NAME.match(tok.rpartition("/")[2]):
                out.append(("run", prefix(line) + tok))
    return out


def own_test_names(path):
    head, _, base = path.rpartition("/")
    lead = head + "/" if head else ""
    if base.endswith(".py"):
        return [lead + "test_" + base[:-3] + ".py"]
    for ext in (".tsx", ".ts"):
        if base.endswith(ext):
            name = base[: -len(ext)]
            return [lead + name + ".test.ts", lead + name + ".test.tsx"]
    return []


def run_names(own, run):
    base = own.rpartition("/")[2]
    for line in run:
        for tok in tokens(line):
            if "*" in tok:
                if fnmatch.fnmatchcase(base, tok.rpartition("/")[2]):
                    return True
            elif tok == base or tok.endswith("/" + base):
                return True
    return False


def faults(issue, tree=None, missing=(), own_tests=False):
    sections, run = parts(issue.get("body"))
    files = cutshape.parse(issue)["paths"]
    found = []

    def add(text):
        if text not in found:
            found.append(text)

    if tree is not None:
        for s, line in change_subjects(sections):
            if in_list(s, files):
                continue
            if s in tree:
                add("change: %s is on dev and is not in Files" % s)
            elif "/" in s and not in_list(s, tree) and NEW_WORD.search(line):
                add("change: %s is called new and is not in Files" % s)
        for origin, path in test_names(sections, run):
            if not in_list(path, files) and not in_list(path, tree):
                add("%s: test file %s is not on dev and is not in Files" % (origin, path))

    for lines in sections.values():
        for line in lines:
            spans = TICKED.findall(line)
            if line.startswith("cd "):
                spans = [line] + spans
            for span in spans:
                if span.startswith("cd ") and any(t in span for t in RUN_TOOLS) and span not in run:
                    add("run: this line is outside the Run block, so the factory does not run it: %s" % span)

    for n in missing:
        add("depends on: #%d does not exist" % n)

    if own_tests and tree is not None:
        for path in files:
            for test in own_test_names(path):
                if in_list(test, tree) and not in_list(test, files) and not run_names(test, run):
                    add("files: %s has its own test %s on dev, which is neither in Files nor in a Run line" % (path, test))
    return found


def needs(issue):
    sections, run = parts(issue.get("body"))
    files = cutshape.parse(issue)["paths"]
    if any(not in_list(s, files) for s, _ in change_subjects(sections)):
        return True
    return any(not in_list(path, files) for _, path in test_names(sections, run))


def tree(gh, repo):
    try:
        return {line for line in gh(["api", "repos/%s/git/trees/dev?recursive=1" % repo, "--jq", ".tree[].path"]).splitlines() if line}
    except Exception:
        return None


def comment(found):
    lines = ["The factory dispatcher does not take this issue: the plan check found faults."]
    lines += ["- %s" % f for f in found]
    lines.append("Fix the issue text; the label stays and the next beat reads it again.")
    return "\n".join(lines)
