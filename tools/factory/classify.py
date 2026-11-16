import hashlib
import json
import re
from pathlib import Path

RULES = Path(__file__).resolve().parent / "classify_rules.json"

PATH_RE = re.compile(r"(?<![\w/.-])((?:\.github|tools|apps|packages|deploy|docs)/[\w./-]*\w)")
BACKTICK_RE = re.compile(r"`([A-Za-z_][\w.]*)(?:\(\))?`")
CALL_RE = re.compile(r"(?<![\w.])([A-Za-z_][\w.]*)\(")
TITLE_WORD_RE = re.compile(r"[a-z0-9]{3,}")


def load(path=RULES):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def labels(issue):
    names = []
    for label in issue.get("labels") or []:
        names.append(label.get("name") if isinstance(label, dict) else label)
    return [n for n in names if n]


def text(issue):
    return (issue.get("title") or "") + "\n" + (issue.get("body") or "")


def digest(issue):
    return hashlib.sha256(text(issue).encode("utf-8")).hexdigest()[:16]


def untouchable(issue, rules):
    return bool(set(labels(issue)) & set(rules["never_touch"]))


def skipped(issue, rules):
    names = {p["name"] for p in rules["priorities"]}
    return untouchable(issue, rules) or bool(set(labels(issue)) & names)


def paths(body):
    return PATH_RE.findall(body)


def has_word(body, word):
    pattern = re.escape(word)
    if word[:1].isalnum():
        pattern = r"(?<!\w)" + pattern
    if word[-1:].isalnum():
        pattern = pattern + r"(?!\w)"
    return re.search(pattern, body, re.IGNORECASE) is not None


def under(path, prefix):
    return path == prefix or path.startswith(prefix.rstrip("/") + "/")


def area(issue, rules):
    for name in labels(issue):
        if name.startswith("area:"):
            return name[len("area:"):]
    body = text(issue)
    cited = paths(body)
    best, best_count = None, 0
    for entry in rules["areas"]:
        prefix = entry["paths"][0]
        count = sum(1 for p in cited if under(p, prefix))
        if count > best_count:
            best, best_count = entry["name"], count
    if best is not None:
        return best
    for entry in rules["areas"]:
        if any(has_word(body, w) for w in entry["words"]):
            return entry["name"]
    return None


def kind(issue, rules):
    names = labels(issue)
    if "factory-problem" in names:
        return "problem"
    body = text(issue)
    cites = bool(paths(body))
    for entry in rules["kinds"]:
        if any(has_word(body, w) for w in entry["words"]):
            if entry["name"] == "follow-up" and not cites:
                continue
            return entry["name"]
    if cites and len(issue.get("body") or "") <= rules["follow_up_chars"] and "bug" not in names:
        return "follow-up"
    return "bug" if "bug" in names else "feature"


def priority(issue, rules):
    body = text(issue)
    cited = paths(body)
    for entry in rules["priorities"]:
        for path in cited:
            if any(under(path, p) for p in entry["paths"]):
                return entry["name"], "cites " + path
        for word in entry["words"]:
            if has_word(body, word):
                return entry["name"], 'says "' + word + '"'
    return None


def place(issue, rules):
    where = area(issue, rules)
    ranked = priority(issue, rules)
    if where is None or ranked is None:
        return None
    return {
        "area": where,
        "kind": kind(issue, rules),
        "priority": ranked[0],
        "reason": ranked[1],
    }


def functions(body):
    found = []
    for pattern in (BACKTICK_RE, CALL_RE):
        for name in pattern.findall(body):
            if name not in found:
                found.append(name)
    return found


def title_words(issue, rules):
    stop = set(rules["stop_words"])
    return set(TITLE_WORD_RE.findall((issue.get("title") or "").lower())) - stop


def similar(issues, rules):
    found = []
    for i, a in enumerate(issues):
        for b in issues[i + 1:]:
            text_a, text_b = text(a), text(b)
            paths_b = set(paths(text_b))
            funcs_b = set(functions(text_b))
            common_path = next((p for p in paths(text_a) if p in paths_b), None)
            common_func = next((f for f in functions(text_a) if f in funcs_b), None)
            if common_path and common_func:
                why = "both cite " + common_path + " and " + common_func
            else:
                words_a, words_b = title_words(a, rules), title_words(b, rules)
                union = words_a | words_b
                if not union or len(words_a & words_b) / len(union) < rules["similar_title"]:
                    continue
                why = "their titles share most words"
            found.append((a.get("number"), b.get("number"), why))
    return sorted(found)
