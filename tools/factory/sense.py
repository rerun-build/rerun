import json, os, re, subprocess, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F

PROC = os.environ.get("FACTORY_PROC", "/proc")
TOOLS = os.environ.get("FACTORY_TOOLS_PREFIX", "/data/tools")
spawn = subprocess.Popen
CAP_S = 10
DU_EVERY_S = 600
LOAD_PER_CPU = 3.0
TEXT_LINES = 15
TEXT_WIDTH = 150
STALE_S = 900
KEEPER_MAX = 1024 * 1024
DU_SCRIPT = 'nice -n 19 timeout "$1" du -sxb "$2" > "$3.tmp" && mv "$3.tmp" "$3"'
FOLDER = re.compile(r"\d+-[a-z0-9]{1,12}")
KINDS = ("wt_new", "pr_open", "installs", "tests")
NAMES = {
    "size": ["work_bytes", "work_bytes_age_s"],
    "folders": ["wt_count", "wt_unsaved", "wt_clean", "wt_foreign", "wt_oldest_unsaved", "wt_oldest_unsaved_idle_h"],
    "procs": [k + s for k in KINDS for s in ("_count", "_oldest_s")],
    "tools": ["tools_commit", "tools_installed_at"],
}


def clip(s, n):
    return str(s).replace("\n", " ")[:n]


def read(path, limit=None):
    with open(path, "rb") as f:
        return f.read(limit).decode("utf-8", "replace")


def size_group():
    state = F.STATE
    os.makedirs(state, exist_ok=True)
    start, txt = os.path.join(state, "sense-du.start"), os.path.join(state, "sense-du.txt")
    now = time.time()
    why = "no measure yet"
    due = not os.path.exists(start) or now - os.path.getmtime(start) > DU_EVERY_S
    if due:
        load = float(read(os.path.join(PROC, "loadavg")).split()[0])
        if load > LOAD_PER_CPU * (os.cpu_count() or 1):
            why = "measure skipped: load above 3 per core"
        else:
            with open(start, "a"):
                os.utime(start, None)
            spawn(["sh", "-c", DU_SCRIPT, "sh", "300", F.WORK, txt], start_new_session=True,
                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            why = "measure started, no result yet"
    try:
        value = int(read(txt).split()[0])
        age = int(now - os.path.getmtime(txt))
    except (OSError, ValueError, IndexError):
        return {"work_bytes": (None, why), "work_bytes_age_s": (None, why)}
    return {"work_bytes": (value, None), "work_bytes_age_s": (age, None)}


def git_bin():
    return F.GIT if os.path.exists(F.GIT) else "git"


def git_out(path, *args):
    return subprocess.run([git_bin(), *args], cwd=path, capture_output=True, text=True, timeout=CAP_S)


def folder_state(path):
    st = git_out(path, "status", "--porcelain")
    if st.returncode != 0 or st.stdout.strip():
        return "unsaved"
    rl = git_out(path, "rev-list", "-1", "HEAD", "--not", "--remotes")
    if rl.returncode != 0 or rl.stdout.strip():
        return "unsaved"
    return "clean"


def folder_touch(path):
    t = os.path.getmtime(path)
    lc = git_out(path, "log", "-1", "--format=%ct")
    try:
        t = max(t, float(lc.stdout.strip()))
    except ValueError:
        pass
    return t


def folders_group():
    counts = {"unsaved": 0, "clean": 0, "foreign": 0}
    total, oldest = 0, None
    for repo, name, path in F.wt_dirs():
        total += 1
        if not FOLDER.fullmatch(name):
            counts["foreign"] += 1
            continue
        v = folder_state(path)
        counts[v] += 1
        if v == "unsaved":
            t = folder_touch(path)
            if oldest is None or t < oldest[0]:
                oldest = (t, "%s/%s" % (repo, name))
    out = {"wt_count": (total, None), "wt_unsaved": (counts["unsaved"], None),
           "wt_clean": (counts["clean"], None), "wt_foreign": (counts["foreign"], None)}
    if oldest is None:
        why = "no folder with unsaved work"
        out["wt_oldest_unsaved"] = (None, why)
        out["wt_oldest_unsaved_idle_h"] = (None, why)
    else:
        out["wt_oldest_unsaved"] = (clip(oldest[1], 64), None)
        out["wt_oldest_unsaved_idle_h"] = (round((time.time() - oldest[0]) / 3600, 1), None)
    return out


def env_value(pid, key):
    prefix = key + "="
    for item in read(os.path.join(PROC, str(pid), "environ")).split("\0"):
        if item.startswith(prefix):
            return item[len(prefix):]
    return None


def base(a):
    return os.path.basename(a)


def kind_of(pid, argv):
    if not argv:
        return None
    for i, a in enumerate(argv):
        if base(a) == "factory.py":
            nxt = argv[i + 1] if i + 1 < len(argv) else None
            cmd = env_value(pid, "FACTORY_CMD")
            if nxt == "new" and cmd == "wt":
                return "wt_new"
            if cmd == "pr-open":
                return "pr_open"
            break
    a0, rest = base(argv[0]), argv[1:]
    if a0 in ("npm", "pnpm", "yarn") and any(a in ("install", "ci", "i", "add") for a in rest):
        return "installs"
    if a0 in ("pip", "pip3") and "install" in rest:
        return "installs"
    if a0 == "uv" and any(a in ("sync", "pip") for a in rest):
        return "installs"
    for i in range(len(argv) - 2):
        if argv[i] == "-m" and argv[i + 1] == "pip" and argv[i + 2] == "install":
            return "installs"
    if any(base(a) in ("vitest", "pytest", "jest") for a in argv[:3]):
        return "tests"
    for i in range(len(argv) - 1):
        if argv[i] == "-m" and argv[i + 1] == "unittest":
            return "tests"
    if a0 == "cargo" and rest[:1] == ["test"]:
        return "tests"
    return None


def scan_procs():
    uptime = float(read(os.path.join(PROC, "uptime")).split()[0])
    clk = os.sysconf("SC_CLK_TCK")
    ages = {k: [] for k in KINDS}
    for pid in os.listdir(PROC):
        if not pid.isdigit():
            continue
        try:
            argv = [a for a in read(os.path.join(PROC, pid, "cmdline")).split("\0") if a]
            kind = kind_of(pid, argv)
            if kind is None:
                continue
            stat = read(os.path.join(PROC, pid, "stat"))
            start = int(stat[stat.rindex(")") + 1:].split()[19])
        except (OSError, ValueError, IndexError):
            continue
        ages[kind].append(int(uptime - start / clk))
    return ages


def procs_group():
    ages = scan_procs()
    out = {}
    for k in KINDS:
        out[k + "_count"] = (len(ages[k]), None)
        out[k + "_oldest_s"] = (max(ages[k]), None) if ages[k] else (None, "none running")
    return out


def tools_group():
    words = read(os.path.join(TOOLS, "factory-installed")).split()
    sha = words[0] if words else ""
    commit = (sha, None) if re.fullmatch(r"[0-9a-f]{7,40}", sha) else (None, "stamp holds no commit")
    when = (clip(words[1], 64), None) if len(words) > 1 else (None, "stamp holds no time")
    return {"tools_commit": commit, "tools_installed_at": when}


GROUPS = {"size": size_group, "folders": folders_group, "procs": procs_group, "tools": tools_group}


def run_group(key, box):
    try:
        box["out"] = GROUPS[key]()
    except BaseException as e:
        box["err"] = type(e).__name__


def readings():
    cap = CAP_S
    boxes, threads = {}, {}
    for key in GROUPS:
        boxes[key] = {}
        threads[key] = threading.Thread(target=run_group, args=(key, boxes[key]), daemon=True)
        threads[key].start()
    end = time.time() + cap
    out = []
    for key in GROUPS:
        threads[key].join(max(0.0, end - time.time()))
        box = boxes[key]
        done = not threads[key].is_alive()
        if done and "out" in box:
            got = box["out"]
            for name in NAMES[key]:
                v, why = got.get(name, (None, "not measured"))
                out.append({"name": name, "value": v, "reason": None if v is not None else clip(why or "no value", 120)})
        else:
            why = box.get("err") if done else "over %s s" % (int(cap) if float(cap).is_integer() else cap)
            for name in NAMES[key]:
                out.append({"name": name, "value": None, "reason": clip(why or "failed", 120)})
    return out


def keeper_path():
    return os.environ.get("FACTORY_KEEPER_COPY") or os.path.join(F.STATE, "keeper", "machine.json")


def own_pairs():
    fn = getattr(F, "readings", None)
    if not callable(fn):
        return []
    try:
        got = fn()
    except Exception:
        return []
    if isinstance(got, dict):
        return list(got.items())
    return [(r["name"], r.get("value")) for r in got if isinstance(r, dict) and "name" in r]


def text():
    path = keeper_path()
    try:
        raw = read(path, KEEPER_MAX + 1)
        if len(raw) > KEEPER_MAX:
            raise ValueError("too large")
        doc = json.loads(raw)
        age = int(time.time() - os.path.getmtime(path))
        made = clip(doc.get("madeAt"), 40)
        pairs = [(r["name"], r.get("value")) for r in doc["readings"] if isinstance(r, dict) and "name" in r]
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return "keeper file: none readable at %s; no reading" % path
    stale = age > STALE_S
    head = "keeper file %s, age %s s" % (made, age) + (": STALE, every value unknown" if stale else "")
    pairs += own_pairs()
    lines, cur = [clip(head, TEXT_WIDTH)], ""
    for name, v in pairs:
        item = clip("%s=%s" % (name, "unknown" if stale else ("null" if v is None else v)), TEXT_WIDTH)
        if cur and len(cur) + 1 + len(item) > TEXT_WIDTH:
            lines.append(cur)
            cur = ""
        cur = item if not cur else cur + " " + item
        if len(lines) >= TEXT_LINES:
            break
    if cur and len(lines) < TEXT_LINES:
        lines.append(cur)
    return "\n".join(lines[:TEXT_LINES])


def main(argv):
    if argv not in ([], ["--text"]):
        print("usage: sense [--text]")
        return 2
    try:
        if argv:
            print(text())
        else:
            made = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            print(json.dumps({"version": 1, "madeAt": made, "readings": readings()}))
    except Exception as e:
        print(json.dumps({"version": 1, "madeAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "readings": [],
                          "error": type(e).__name__}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
