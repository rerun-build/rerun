import datetime, json, re

import classify
import followups

MIN_GROUP = 3
DAY_MAX = 2
BODY_MAX = 60000
HOUR = 3600
DAY = 86400
WEEK = 7 * DAY
RUN_KEY = "inboxsort_at"
MINTED_KEY = "inbox_minted"
FLOW_KEY = "issue_flow"
ALARM = "backlog growing"
DEFAULT_PRIORITY = "P3"
MARK = followups.MARK
NOTE = re.compile(r"(?m)^(.*)\n\nFrom the review of (\S+)\.\n\n<!-- followup:(\S+) -->")
HANDLED = re.compile(r"(?m)^(?:Minted #\d+ from \d+ notes|Covered elsewhere): (.+)$")
PARENT = re.compile(r"(?i)\bpart of(?=\W*#\d)")
HEX = re.compile(r"\b(?=[0-9a-f]*[0-9])[0-9a-f]{7,}\b")


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[0-9]+", "0", HEX.sub("h", str(text or "").lower()))).strip()


def notes(comments):
    return [{"key": m.group(3), "text": m.group(1), "job": m.group(2)} for c in comments for m in NOTE.finditer(c or "")]


def handled(comments):
    return {k for c in comments for m in HANDLED.finditer(c or "") for k in m.group(1).split(", ")}


def fresh(found, issues):
    texts = [(i.get("title") or "") + "\n" + (i.get("body") or "") for i in issues]
    keys, seen = followups.known(texts), set()
    known = "\n".join(norm(t) for t in texts)
    out = []
    for n in found:
        sentence = norm(n["text"])
        if n["key"] in keys or sentence in seen or (sentence and sentence in known):
            continue
        keys.add(n["key"])
        seen.add(sentence)
        out.append(n)
    return out


def groups(found, rules):
    out = {}
    for n in found:
        where = classify.area({"title": n["text"][:80], "body": n["text"]}, rules)
        if where is not None:
            out.setdefault(where, []).append(n)
    return out


def minted(kept, now):
    return [m for m in json.loads(kept.get(MINTED_KEY) or "[]") if now - m[1] < WEEK]


def pick(grouped, made, now):
    room = DAY_MAX - sum(1 for _, t in made if now - t < DAY)
    big = sorted((g for g in grouped.items() if len(g[1]) >= MIN_GROUP), key=lambda g: (-len(g[1]), g[0]))
    return big[:max(0, room)]


def fence(text):
    return "```\n%s\n```" % PARENT.sub("part-of", text).replace("```", "'''")


def body(group):
    parts = ["### From %s\n\n%s" % (n["job"], fence(n["text"])) for n in group]
    return "\n\n".join(parts) + "\n\n" + "\n".join("<!-- followup:%s -->" % n["key"] for n in group)


def fit(group):
    kept = list(group)
    while len(kept) > MIN_GROUP and len(body(kept)) > BODY_MAX:
        kept.pop()
    return kept


def labels(where, rules):
    area = next((a["label"] for a in rules["areas"] if a["name"] == where), None)
    return ([area] if area else []) + [DEFAULT_PRIORITY]


def mint(d, inbox, now):
    comments = [c.get("body") or "" for c in json.loads(d.gh(["issue", "view", inbox, "-R", d.repo, "--json", "comments"]))["comments"]]
    done = handled(comments)
    found = [n for n in notes(comments) if n["key"] not in done]
    if not found:
        return []
    issues = [i for i in json.loads(d.gh(["issue", "list", "-R", d.repo, "--state", "open", "--json", "number,title,body",
                                          "--limit", "1000"]) or "[]") if str(i.get("number")) != inbox]
    rules = classify.load()
    made, out = minted(d.store.get_all("-"), now), []
    kept = fresh(found, issues)
    covered = sorted({n["key"] for n in found} - {n["key"] for n in kept})
    if covered:
        d.gh(["issue", "comment", inbox, "-R", d.repo, "--body", "Covered elsewhere: " + ", ".join(covered)])
    for where, group in pick(groups(kept, rules), made, now):
        group = fit(group)
        title = "Follow-ups for %s: %d notes from the inbox" % (where, len(group))
        text = body(group)
        args = ["issue", "create", "-R", d.repo, "--title", title, "--body", text]
        for name in labels(where, rules):
            args += ["--label", name]
        n = int(re.search(r"/issues/(\d+)", d.gh(args)).group(1))
        made.append([n, now])
        d.store.set("-", MINTED_KEY, json.dumps(made))
        keys = [x["key"] for x in group]
        d.gh(["issue", "comment", inbox, "-R", d.repo, "--body", "Minted #%d from %d notes: %s" % (n, len(group), ", ".join(keys))])
        out.append((n, keys))
    return out


def total(d, query):
    return int(d.gh(["api", "-X", "GET", "search/issues", "-f", "q=repo:%s is:issue %s" % (d.repo, query), "--jq", ".total_count"]).strip())


def count(d, now):
    return {"opened_day": total(d, "created:>=" + iso(now - DAY)), "closed_day": total(d, "closed:>=" + iso(now - DAY)),
            "opened_week": total(d, "created:>=" + iso(now - WEEK)), "closed_week": total(d, "closed:>=" + iso(now - WEEK))}


def alarm(kept):
    try:
        f = json.loads(kept.get(FLOW_KEY) or "{}")
        if f["opened_day"] > f["closed_day"]:
            return {ALARM: "opened %d, closed %d in the last 24 hours; opened %d, closed %d in the last 7 days" % (
                f["opened_day"], f["closed_day"], f.get("opened_week", 0), f.get("closed_week", 0))}
    except Exception:
        pass
    return {}


def beat(d, log):
    try:
        kept, now = d.store.get_all("-"), d.now()
        if kept.get(RUN_KEY) is not None and now - float(kept[RUN_KEY]) < HOUR:
            return
        d.store.set("-", RUN_KEY, now)
        f = count(d, now)
        d.store.set("-", FLOW_KEY, json.dumps(f))
        log("inbox", "issues opened %d, closed %d in 24 hours; opened %d, closed %d in 7 days" % (
            f["opened_day"], f["closed_day"], f["opened_week"], f["closed_week"]))
        if kept.get("inbox") and f["opened_day"] <= f["closed_day"]:
            for n, keys in mint(d, str(kept["inbox"]), now):
                log(n, "minted from %d inbox notes: %s" % (len(keys), ", ".join(keys)))
    except Exception as e:
        log("inbox", "inbox sort: %s" % (str(e)[:200] or type(e).__name__))
