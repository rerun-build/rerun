import difflib
import re

KINDS = ("REMOVE", "CHANGE", "ADD", "DECIDE", "OWNER")
SEVERITIES = ("blocking", "major", "minor")
HEAVY = ("blocking", "major")
CHOICES = ("DECIDE", "OWNER")
OWNER_CATEGORIES = {
    "deploy": "deploying or updating a live system",
    "money": "spending money or taking a paid plan",
    "delete": "deleting data that nothing can bring back",
    "outward": "anything sent outside in Rob's name",
    "secrets": "logins, keys and credentials",
    "rules": "the rules the agents follow",
    "product": "what the product is or who it is for",
}
FIELDS = ("QUOTE", "PROBLEM", "EVIDENCE", "FIX", "OPTION", "CATEGORY")
MIN_QUOTE = 12
MAX_NOTES = 30
MAX_DIFF = 6000

HEAD = re.compile(r"^NOTE\s+(\d+)\s+([A-Za-z]+)\s+([A-Za-z]+)\s*$")
FIELD = re.compile(r"^(%s):\s?(.*)$" % "|".join(FIELDS))
LAST = re.compile(r"^(REVIEW|FIXED|FRESH|CORRECTED|PLAN|CUT|BLOCKED):")
SPACE = re.compile(r"\s+")

FORMAT = """Write each point as one note block:
```
NOTE <n> <REMOVE|CHANGE|ADD|DECIDE|OWNER> <blocking|major|minor>
QUOTE: <words copied exactly from the plan, 12 characters or more; one QUOTE line per place>
PROBLEM: <what is wrong, as a fact you checked>
EVIDENCE: <the file and function, or the command and what it printed>
FIX: <what the plan must say instead>
```
ADD quotes the heading or the line where the missing part belongs. DECIDE is a choice that neither the code, the issue, an earlier decision nor the goal page settles: give two to four `OPTION:` lines, the one you recommend first, each with its reason. OWNER is a DECIDE whose choice is one of these and nothing else: %s. Add `CATEGORY: <that word>` to it. A note whose quote is not in the plan word for word is thrown away.""" % ", ".join(
    "%s (%s)" % (k, v) for k, v in OWNER_CATEGORIES.items())


MENTION = re.compile(r"@(?=[A-Za-z0-9])")


def quiet(text):
    return MENTION.sub("", text or "")


def norm(text):
    return SPACE.sub(" ", (text or "").replace("`", "")).strip()


def parse(text):
    notes, dropped, cur = [], [], None
    for line in (text or "").replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        head = HEAD.match(stripped)
        if head:
            cur = {"n": int(head.group(1)), "kind": head.group(2).upper(), "severity": head.group(3).lower(),
                   "QUOTE": [], "OPTION": [], "PROBLEM": "", "EVIDENCE": "", "FIX": "", "CATEGORY": "", "_last": None}
            notes.append(cur)
            continue
        if cur is None:
            continue
        if LAST.match(stripped):
            cur = None
            continue
        field = FIELD.match(stripped)
        if field:
            key, value = field.group(1), field.group(2).strip()
            if key in ("QUOTE", "OPTION"):
                cur[key].append(value)
            else:
                cur[key] = value
            cur["_last"] = key
        elif stripped and cur["_last"] in ("PROBLEM", "EVIDENCE", "FIX"):
            cur[cur["_last"]] += " " + stripped
    kept = []
    for note in notes[:MAX_NOTES]:
        note.pop("_last", None)
        why = shape_fault(note)
        if why:
            dropped.append((note["n"], why))
        else:
            kept.append(note)
    dropped += [(note["n"], "more than %d notes" % MAX_NOTES) for note in notes[MAX_NOTES:]]
    return kept, dropped


def shape_fault(note):
    if note["kind"] not in KINDS:
        return "unknown kind %s" % note["kind"]
    if note["severity"] not in SEVERITIES:
        return "unknown severity %s" % note["severity"]
    if not note["QUOTE"]:
        return "no QUOTE line"
    if note["kind"] in CHOICES and len(note["OPTION"]) < 2:
        return "a choice with fewer than two OPTION lines"
    if note["kind"] not in CHOICES and not note["FIX"]:
        return "no FIX line"
    return None


def anchor(notes, plan):
    body = norm(plan)
    kept, dropped = [], []
    for note in notes:
        quotes = [q for q in note["QUOTE"] if len(norm(q)) >= MIN_QUOTE and norm(q) in body]
        if not quotes:
            dropped.append((note["n"], "its quote is not in the plan"))
            continue
        note = dict(note, QUOTE=quotes)
        if note["kind"] == "OWNER" and note["CATEGORY"].strip().lower() not in OWNER_CATEGORIES:
            note = dict(note, kind="DECIDE")
        kept.append(note)
    return kept, dropped


def read(text, plan):
    shaped, dropped = parse(text)
    kept, unanchored = anchor(shaped, plan)
    return kept, dropped + unanchored


def heavy(notes):
    return [n for n in notes if n["kind"] != "OWNER" and n["severity"] in HEAVY]


def owner(notes):
    return [n for n in notes if n["kind"] == "OWNER"]


def render(note):
    lines = ["NOTE %d %s %s" % (note["n"], note["kind"], note["severity"])]
    lines += ["QUOTE: %s" % q for q in note["QUOTE"]]
    for key in ("PROBLEM", "EVIDENCE", "FIX", "CATEGORY"):
        if note.get(key):
            lines.append("%s: %s" % (key, note[key]))
    lines += ["OPTION: %s" % o for o in note["OPTION"]]
    return "\n".join(lines)


def render_all(notes):
    return "\n\n".join(render(n) for n in notes)


def comment(notes, dropped, round_no, mode):
    head = "## Review of the plan, round %d%s" % (round_no, " (dry run: nothing was sent back)" if mode == "dry" else "")
    if not notes:
        lines = [head, "", "No points: the plan goes to the cut."]
    else:
        lines = [head, "", "```", render_all(notes), "```"]
    if dropped:
        lines += ["", "Thrown away: " + "; ".join("note %d (%s)" % d for d in dropped)]
    return quiet("\n".join(lines))


def diff(old, new):
    if not old or old == new:
        return ""
    text = "\n".join(difflib.unified_diff(old.splitlines(), new.splitlines(), "plan before", "plan now", lineterm="", n=1))
    if len(text) > MAX_DIFF:
        return "The plan was rewritten beyond a short diff: read it whole."
    return text
