import json
import re

SECTIONS = ("Change", "Test through", "Done-test")
TICKED = re.compile(r"`([^`\n]+)`")
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\(\))?$")
CALL = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{2,})\(")
PATHISH = re.compile(r"(?<![\w/.-])((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)")
HEADING = re.compile(r"^\s*\*\*([^*]+)\*\*")
RUN = re.compile(r"(?ms)^\*\*Run\*\*.*?```[a-z]*\n(.*?)```")
MAX_FILES = 300
COMMON = frozenset(("self", "None", "True", "False", "test", "tests", "json", "main", "run", "dev", "the"))


def sections(body):
    out, name = {}, None
    for line in (body or "").replace("\r\n", "\n").split("\n"):
        m = HEADING.match(line)
        if m:
            name = m.group(1).strip().rstrip(":")
            out.setdefault(name, [])
            rest = line[m.end():].strip(" :")
            if rest:
                out[name].append(rest)
            continue
        if name:
            out[name].append(line)
    return out


def names(body):
    found = set()
    parts = sections(body)
    for name in SECTIONS:
        for line in parts.get(name, []):
            for span in TICKED.findall(line):
                span = span.strip()
                if IDENT.match(span):
                    found.add(span.rstrip("()").split(".")[-1])
            found.update(CALL.findall(line))
    return {n for n in found if len(n) >= 3 and n not in COMMON}


def fact_paths(body, paths, test):
    facts = set(paths or [])
    if test:
        facts.add(test)
    parts = sections(body)
    for name in SECTIONS:
        for line in parts.get(name, []):
            facts.update(PATHISH.findall(line))
    m = RUN.search((body or "").replace("\r\n", "\n"))
    if m:
        facts.update(PATHISH.findall(m.group(1)))
    return facts


def query(facts):
    wanted = json.dumps({path: True for path in sorted(facts)})
    return ("%s as $want | {count: (.files | length), files: [.files[] | select($want[.filename] or $want[.previous_filename // \"\"])"
            " | {filename, previous_filename, status, patch}]}" % wanted)


def hits(compare, facts, wanted):
    if (compare.get("count") or 0) >= MAX_FILES:
        return ["dev changed %d or more files since the plan, too many to read one by one" % MAX_FILES]
    out = []
    pattern = re.compile(r"\b(%s)\b" % "|".join(re.escape(w) for w in sorted(wanted))) if wanted else None
    for f in compare.get("files") or []:
        name, before = f.get("filename"), f.get("previous_filename")
        if name not in facts and before not in facts:
            continue
        if f.get("status") in ("removed", "renamed"):
            out.append("%s was %s on dev" % (before or name, f.get("status")))
            continue
        patch = f.get("patch")
        if patch is None:
            out.append("%s changed on dev and its diff is too large to read" % name)
            continue
        changed = "\n".join(line[1:] for line in patch.splitlines() if line[:1] in "+-" and not line.startswith(("+++", "---")))
        touched = sorted(set(pattern.findall(changed))) if pattern else []
        if touched:
            out.append("%s changed on dev where it names %s" % (name, ", ".join(touched[:5])))
    return out
