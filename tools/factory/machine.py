import calendar
import json
import math
import os
import re
import stat
import time

ENV = "FACTORY_KEEPER_FILE"
MAX_BYTES = 512 * 1024
STALE_S = 900
MAX_READINGS = 200
MAX_HOUSEKEEPING = 10
MAX_BLOCK_BYTES = 24 * 1024
STALE = "keeper file older than 15 minutes"
TOKEN = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}")
MADE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$")
NOT_ASCII = re.compile(r"[^ -~]")
OVER = "keeper file over %d bytes" % MAX_BYTES
SILENT = "keeper silent"
HOW = "The keeper timer on the host writes /var/lib/rerun-keeper/machine.json every 5 minutes (deploy/vps/keeper.sh); see it with: systemctl list-timers rerun-keeper.timer"


def path():
    return os.environ.get(ENV) or None


def bad(reason):
    return {"fileMadeAt": None, "fileAgeS": None, "fresh": False, "engine": "unknown", "skippedTicks": 0,
            "readings": [{"name": "keeper_file", "value": None, "reason": reason, "source": "keeper"}], "housekeeping": []}


def read(now, p):
    try:
        return load(now, p)
    except Exception as e:
        return bad("keeper file unreadable: %s" % type(e).__name__)


def text(s, n):
    return NOT_ASCII.sub("?", s)[:n]


def whole(v):
    return isinstance(v, int) and not isinstance(v, bool)


def made(v):
    if not isinstance(v, str) or len(v) > 40 or not MADE.fullmatch(v):
        return None
    try:
        time.strptime(v[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None
    return v


def reading(e, source):
    if not isinstance(e, dict) or not isinstance(e.get("name"), str) or TOKEN.search(e["name"]):
        return None
    v, why = e.get("value"), None
    if isinstance(v, bool):
        v = int(v)
    elif isinstance(v, float):
        if not math.isfinite(v):
            v, why = None, "not a finite number"
    elif isinstance(v, str):
        if TOKEN.search(v):
            v, why = None, "value looks like a token"
        else:
            v = text(v, 64)
    elif v is not None and not isinstance(v, int):
        v, why = None, "not a number or a string"
    if why is None and isinstance(e.get("reason"), str):
        why = "reason looks like a token" if TOKEN.search(e["reason"]) else text(e["reason"], 120)
    if v is None and why is None:
        why = "no reason given"
    return {"name": text(e["name"], 64), "value": v, "reason": why, "source": source}


def readings(doc):
    out = []
    factory = doc.get("factory")
    for rows, source in ((doc.get("readings"), "keeper"),
                         (factory.get("readings") if isinstance(factory, dict) else None, "factory")):
        for e in rows if isinstance(rows, list) else []:
            r = reading(e, source)
            if r is not None:
                out.append(r)
    return out[:MAX_READINGS]


def housekeeping(doc):
    rows = doc.get("housekeeping")
    out = [{"cmd": text(e["cmd"], 40), "rc": e["rc"], "s": e["s"]} for e in (rows if isinstance(rows, list) else [])
           if isinstance(e, dict) and isinstance(e.get("cmd"), str) and whole(e.get("rc")) and whole(e.get("s")) and e["s"] >= 0]
    return out[:MAX_HOUSEKEEPING]


def fit(block):
    rows = block["readings"]
    size = len(json.dumps(dict(block, readings=[])))
    keep = 0
    for r in rows:
        size += len(json.dumps(r)) + 2
        if size > MAX_BLOCK_BYTES:
            break
        keep += 1
    block["readings"] = rows[:keep]
    return block


def load(now, p):
    try:
        fd = os.open(p, os.O_RDONLY | os.O_NONBLOCK)
    except FileNotFoundError:
        return bad("keeper file missing")
    try:
        f = os.fdopen(fd, "rb")
    except Exception:
        os.close(fd)
        raise
    with f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode):
            return bad("keeper file is not a regular file")
        if st.st_size > MAX_BYTES:
            return bad(OVER)
        raw = f.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        return bad(OVER)
    try:
        doc = json.loads(raw.decode("utf-8"))
    except ValueError:
        return bad("keeper file is not JSON")
    if not isinstance(doc, dict):
        return bad("keeper file is not an object")
    age = max(0, int(now - st.st_mtime))
    skipped = doc.get("skippedTicks")
    block = {"fileMadeAt": made(doc.get("madeAt")), "fileAgeS": age, "fresh": age <= STALE_S,
             "engine": doc.get("engine") if doc.get("engine") in ("running", "down") else "unknown",
             "skippedTicks": skipped if whole(skipped) and skipped >= 0 else 0,
             "readings": readings(doc), "housekeeping": housekeeping(doc)}
    if not block["fresh"]:
        for r in block["readings"]:
            r["value"], r["reason"] = None, STALE
        block.update(engine="unknown", skippedTicks=0, housekeeping=[])
    return fit(block)


def alarm(m):
    if not isinstance(m, dict) or m["fresh"]:
        return {}
    if m["fileAgeS"] is None:
        return {SILENT: "no keeper file: %s. %s" % (m["readings"][0]["reason"], HOW)}
    return {SILENT: "keeper file made %s, older than %d s: every keeper value shows as unknown. %s" % (
        m["fileMadeAt"] or "at an unknown time", STALE_S, HOW)}


OWN_EVERY_S = 600
OWN_NAMES = ("tools_dev_commit", "dispatcher_commit", "api_remaining", "api_reset_at", "runs_queued", "runs_running",
             "queue_wait_oldest_s", "image_commit", "image_build")


def epoch(s):
    return calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def api(gh, path, memo):
    if path not in memo:
        memo[path] = json.loads(gh(["api", path]) or "null")
    return memo[path]


def own(gh, repo, now, code_sha):
    memo = {}

    def get(path):
        return api(gh, path, memo)

    def queued():
        return get("repos/%s/actions/runs?status=queued&per_page=100" % repo)

    def image_commit():
        apps = get("repos/%s/commits?sha=dev&path=apps&per_page=1" % repo)[0]
        pkgs = get("repos/%s/commits?sha=dev&path=packages&per_page=1" % repo)[0]
        return max((apps, pkgs), key=lambda c: epoch(c["commit"]["committer"]["date"]))["sha"]

    def image_build():
        runs = [r for r in get("repos/%s/actions/runs?head_sha=%s&per_page=100" % (repo, image_commit()))["workflow_runs"]
                if r.get("name") == "Images"]
        if not runs:
            return "none"
        r = max(runs, key=lambda x: epoch(x["created_at"]))
        if r.get("status") != "completed":
            return "running"
        return "green" if r.get("conclusion") == "success" else "red"

    def oldest():
        rows = queued()["workflow_runs"]
        return max(0, int(now - min(epoch(r["created_at"]) for r in rows))) if rows else 0

    def core():
        return get("rate_limit")["resources"]["core"]

    takers = {
        "tools_dev_commit": lambda: get("repos/%s/commits?sha=dev&path=tools/factory&per_page=1" % repo)[0]["sha"],
        "dispatcher_commit": lambda: code_sha,
        "api_remaining": lambda: int(core()["remaining"]),
        "api_reset_at": lambda: iso(int(core()["reset"])),
        "runs_queued": lambda: int(queued()["total_count"]),
        "runs_running": lambda: int(get("repos/%s/actions/runs?status=in_progress&per_page=1" % repo)["total_count"]),
        "queue_wait_oldest_s": oldest,
        "image_commit": image_commit,
        "image_build": image_build,
    }
    out = []
    for name in OWN_NAMES:
        try:
            e = {"name": name, "value": takers[name](), "reason": None}
        except Exception as x:
            e = {"name": name, "value": None, "reason": type(x).__name__}
        out.append(reading(e, "dispatcher"))
    return out


class Own:
    def __init__(self):
        self.rows, self.at = None, None

    def get(self, gh, repo, now, code_sha):
        if self.rows is None or now - self.at >= OWN_EVERY_S:
            self.rows, self.at = own(gh, repo, now, code_sha), now
        return self.rows
