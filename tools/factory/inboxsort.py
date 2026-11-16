import datetime, json, re

import classify
import followups

MIN_GROUP = 3
DAY_MAX = 2
HOUR = 3600
DAY = 86400
WEEK = 7 * DAY
RUN_KEY = "inboxsort_at"
MINTED_KEY = "inbox_minted"
FLOW_KEY = "issue_flow"
ALARM = "backlog growing"
PROBLEM_LABEL = "factory-problem"
DEFAULT_PRIORITY = "P3"
MARK = followups.MARK
NOTE = re.compile(r"(?m)^(.*)\n\nFrom the review of (\S+)\.\n\n<!-- followup:(\S+) -->")
HANDLED = re.compile(r"(?m)^Minted #\d+ from \d+ notes: (.+)$")
HEX = re.compile(r"\b(?=[0-9a-f]*[0-9])[0-9a-f]{7,}\b")


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day(t):
    return iso(t)[:10]


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
    room = DAY_MAX - sum(1 for _, t in made if day(t) == day(now))
    big = sorted((g for g in grouped.items() if len(g[1]) >= MIN_GROUP), key=lambda g: (-len(g[1]), g[0]))
    return big[:max(0, room)]


def body(group):
    parts = ["### From %s: %s\n\n%s" % (n["job"], n["text"][:80], n["text"]) for n in group]
    return "\n\n".join(parts) + "\n\n" + "\n".join("<!-- followup:%s -->" % n["key"] for n in group)


def labels(where, title, text, rules):
    area = next((a["label"] for a in rules["areas"] if a["name"] == where), None)
    ranked = classify.priority({"title": title, "body": text}, rules)
    return ([area] if area else []) + [ranked[0] if ranked else DEFAULT_PRIORITY]


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
    for where, group in pick(groups(fresh(found, issues), rules), made, now):
        title = "Follow-ups for %s: %d notes from the inbox" % (where, len(group))
        text = body(group)
        args = ["issue", "create", "-R", d.repo, "--title", title, "--body", text]
        for name in labels(where, title, text, rules):
            args += ["--label", name]
        n = int(re.search(r"/issues/(\d+)", d.gh(args)).group(1))
        made.append([n, now])
        d.store.set("-", MINTED_KEY, json.dumps(made))
        keys = [x["key"] for x in group]
        d.gh(["issue", "comment", inbox, "-R", d.repo, "--body", "Minted #%d from %d notes: %s" % (n, len(group), ", ".join(keys))])
        out.append((n, keys))
    return out


def listed(d, query):
    return json.loads(d.gh(["issue", "list", "-R", d.repo, "--state", "all", "--search", query,
                            "--json", "number,labels", "--limit", "1000"]) or "[]")


def count(d, now):
    ours = {m[0] for m in minted(d.store.get_all("-"), now) if now - m[1] < DAY}
    opened = listed(d, "created:>=" + iso(now - DAY))
    mine = sum(1 for i in opened if i["number"] in ours or PROBLEM_LABEL in classify.labels(i))
    return {"opened_day": len(opened), "closed_day": len(listed(d, "closed:>=" + iso(now - DAY))),
            "opened_week": len(listed(d, "created:>=" + iso(now - WEEK))),
            "closed_week": len(listed(d, "closed:>=" + iso(now - WEEK))), "mine_day": mine}


def alarm(kept):
    f = json.loads(kept.get(FLOW_KEY) or "{}")
    if f.get("opened_day", 0) > f.get("closed_day", 0) and f.get("mine_day", 0) > 0:
        return {ALARM: "opened %d, closed %d in the last 24 hours; the dispatcher opened %d of them" % (
            f["opened_day"], f["closed_day"], f["mine_day"])}
    return {}


def beat(d, log):
    kept, now = d.store.get_all("-"), d.now()
    if kept.get(RUN_KEY) is not None and now - float(kept[RUN_KEY]) < HOUR:
        return
    d.store.set("-", RUN_KEY, now)
    try:
        if kept.get("inbox"):
            for n, keys in mint(d, str(kept["inbox"]), now):
                log(n, "minted from %d inbox notes: %s" % (len(keys), ", ".join(keys)))
    except Exception as e:
        log("inbox", "inbox sort: %s" % (str(e)[:200] or type(e).__name__))
    try:
        f = count(d, now)
        d.store.set("-", FLOW_KEY, json.dumps(f))
        log("inbox", "issues opened %d, closed %d in 24 hours; opened %d, closed %d in 7 days" % (
            f["opened_day"], f["closed_day"], f["opened_week"], f["closed_week"]))
    except Exception as e:
        log("inbox", "issue count: %s" % (str(e)[:200] or type(e).__name__))
