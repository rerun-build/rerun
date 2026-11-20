#!/usr/bin/env python3
import calendar, fnmatch, json, os, re, shlex, signal, subprocess, sys, time, shutil, urllib.request

os.environ["GIT_TERMINAL_PROMPT"] = "0"
GH, GIT = os.environ.get("FACTORY_GH") or "/data/tools/bin/gh", "/data/tools/bin/git"
OWNERS = ("special-place-ai-heaven", "special-place-administrator")
WORK = os.environ.get("FACTORY_WORK", "/data/work")
REPOS, WT, STATE = WORK + "/repos", WORK + "/wt", WORK + "/state"
MIN_FREE_GB = 30
LOAD_PER_CPU = 3.0
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ciwait
import cutshape
MIN_FREE_MEM_GB, MEMINFO = 4, "/proc/meminfo"
WT_IDLE_HOURS = 48
CLONE_SAFE = 1
QUEUE_LIMIT_S, SLICE_S = 30 * 60, 450
PR_HEADS = ["## Done", "## Evidence", "## Not changed", "## Unsure", "## Open", "## Next owner and their done-test"]
ADAPTED_HEAD = re.compile(r"(?m)^## Tests adapted[ \t]*\r?$")
ADAPTABLE = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*\.(test|spec)\.(js|ts|jsx|tsx))$")
WF = r"\.github/(workflows|actions)/|\.github/(CODEOWNERS|dependabot\.yml)$"
ISSUE_HEADS = ["## Goal", "## Done-test", "## Limits", "## Chunks"]
REL_HEADS = ["## What changed", "## How it was tested", "## CI status", "## Migration or config changes", "## Deploy notes"]
PR_TEMPLATE = """## Done
## Evidence
(commands run and their result)
## Not changed
(what a reviewer might expect, left alone on purpose)
## Unsure
## Open
## Next owner and their done-test
"""
ISSUE_TEMPLATE = """## Goal
## Done-test
## Limits
(what not to touch)
## Chunks
- [ ] 1. <result> | owner: <coworker> | done-test: <check> | depends on: -
## Memory hits
(EverOS, read once at plan time; "none" for a normal job)
## Token estimate
"""
REL_TEMPLATE = "\n".join(REL_HEADS) + "\n"


def transient(msg):
    print("TRANSIENT: " + msg)
    sys.exit(3)


def room_check():
    st = shutil.disk_usage(WORK if os.path.isdir(WORK) else "/")
    free = st.free / 2**30
    if free < MIN_FREE_GB:
        transient("disk: %s has %.0f GB free, floor is %d GB%s" % (WORK, free, MIN_FREE_GB, "; under half the floor" if free < MIN_FREE_GB / 2 else ""))
    mem = avail_mem_gb()
    if mem is not None and mem < MIN_FREE_MEM_GB:
        transient("memory: %.1f GB available, floor is %d GB" % (mem, MIN_FREE_MEM_GB))
    if not LOAD_PER_CPU:
        return
    try:
        load, cpus = os.getloadavg()[0], os.cpu_count() or 1
    except OSError:
        return
    if load > LOAD_PER_CPU * cpus:
        transient("load: %.1f on %d cores, ceiling is %.1f" % (load, cpus, LOAD_PER_CPU * cpus))


def die(msg, code=2):
    print("REFUSED: " + msg if code == 2 else msg)
    sys.exit(code)


def run(cmd, cwd="/tmp", check=True, timeout=300):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=timeout)
    if check and r.returncode:
        die("command failed: %s\n%s" % (" ".join(cmd[:6]), (r.stderr or r.stdout).strip()[-600:]), 1)
    return r


def api(path, *args, paginate=False):
    cmd = [GH, "api"] + (["--paginate"] if paginate else []) + [path] + list(args)
    r = run(cmd, check=False)
    if r.returncode:
        return None
    try:
        return json.loads(r.stdout)
    except Exception:
        try:
            return json.loads("[" + r.stdout.replace("][", "],[") + "]")[0] if r.stdout.strip() else None
        except Exception:
            return None

class RosterError(Exception):
    pass


def home():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json"), encoding="utf-8") as f:
        return json.load(f)["repo"]


def base_roster(full):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import roster as R

    def raw(path):
        r = subprocess.run([GH, "api", "-i", "-H", "Accept: application/vnd.github.raw+json", path],
                           capture_output=True, text=True, timeout=300)
        m = re.match(r"HTTP/\S+ (\d{3})", r.stdout or "")
        status = m.group(1) if m else None
        parts = re.split(r"\r?\n\r?\n", r.stdout or "", maxsplit=1)
        if r.returncode == 0 and status == "200" and len(parts) == 2:
            return parts[1]
        if status == "404":
            return None
        raise RosterError("cannot read roster (%s): HTTP %s %s" % (path, status or "?", (r.stderr or "").strip()[-200:]))

    where = "repos/%s/contents/tools/factory/roster.json?ref=" % full
    text = raw(where + "dev")
    if text is None:
        r = subprocess.run([GH, "api", "repos/%s" % full, "--jq", ".default_branch"], capture_output=True, text=True, timeout=300)
        if r.returncode or not r.stdout.strip():
            raise RosterError("cannot read default branch of %s: %s" % (full, (r.stderr or r.stdout).strip()[-200:]))
        text = raw(where + r.stdout.strip())
    if text is None:
        return None
    try:
        return R.load(text)
    except ValueError as e:
        raise RosterError(str(e))



def repo_full(name):
    full = name if "/" in name else OWNERS[0] + "/" + name
    if full.split("/")[0] not in OWNERS:
        die("repo owner not allowed: " + full)
    parts = full.split("/")
    if len(parts) != 2 or any(not re.fullmatch(r"[A-Za-z0-9._-]+", x) or x in (".", "..") for x in parts):
        die("repo name not allowed: " + full)
    return full


FOLDER_NAMES = {"moldwright": "rerun"}


def short(full):
    name = full.split("/")[1]
    return FOLDER_NAMES.get(name, name)


def named(full):
    return home() if short(full) == short(home()) else full


def trim(s, n):
    s = (s or "").replace("\r", "").strip()
    return s if len(s) <= n else s[:n] + "\n[... trimmed, %d more characters]" % (len(s) - n)


def checks(full, sha):
    d = api("repos/%s/commits/%s/check-runs?per_page=100" % (full, sha)) or {}
    out = []
    for c in d.get("check_runs", []):
        out.append({"name": c["name"], "status": c["status"], "conclusion": c.get("conclusion"), "id": c["id"],
                    "url": c.get("html_url", "")})
    return out


def ci_state(cs):
    if not cs:
        return "NONE"
    bad = [c for c in cs if c["status"] == "completed" and c["conclusion"] in ("failure", "timed_out", "cancelled", "action_required", "startup_failure")]
    if any(c["conclusion"] in ("failure", "timed_out", "startup_failure") for c in bad):
        return "RED"
    if any(c["status"] != "completed" for c in cs):
        return "WAITING"
    return "RED" if bad else "GREEN"


def ci_table(cs):
    return "\n".join("  %-40s %-11s %s" % (c["name"][:40], c["status"], c["conclusion"] or "-") for c in sorted(cs, key=lambda c: c["name"])) or "  (no checks)"


def cmd_packet(a):
    if len(a) < 2:
        die("usage: packet <repo> <issue-or-PR number> [--full]")
    full, n, big = repo_full(a[0]), a[1].lstrip("#"), "--full" in a
    it = api("repos/%s/issues/%s" % (full, n))
    if not it:
        die("not found: %s#%s" % (full, n), 1)
    is_pr = "pull_request" in it
    print("# %s %s#%s: %s" % ("PR" if is_pr else "ISSUE", full, n, it["title"]))
    print("state: %s | labels: %s | author: %s | updated: %s" % (it["state"], ",".join(l["name"] for l in it["labels"]) or "-", it["user"]["login"], it["updated_at"]))
    print(it["html_url"])
    refs = sorted(set(re.findall(r"#(\d+)", it.get("body") or "")) - {n})
    if is_pr:
        pr = api("repos/%s/pulls/%s" % (full, n))
        print("base: %s <- head: %s @ %s | draft: %s | merged: %s | mergeable: %s | +%d -%d in %d files" % (
            pr["base"]["ref"], pr["head"]["ref"], pr["head"]["sha"][:8], pr["draft"], pr["merged"], pr.get("mergeable_state"),
            pr["additions"], pr["deletions"], pr["changed_files"]))
    print("linked: %s" % (", ".join("#" + r for r in refs) or "-"))
    print("\n## Body\n" + trim(it.get("body"), 6000 if big else 3000))
    if is_pr:
        cs = checks(full, pr["head"]["sha"])
        print("\n## CI: %s\n%s" % (ci_state(cs), ci_table(cs)))
        files = api("repos/%s/pulls/%s/files?per_page=100" % (full, n)) or []
        print("\n## Files")
        for f in files:
            print("  %-9s +%-4d -%-4d %s" % (f["status"], f["additions"], f["deletions"], f["filename"]))
        d = run([GH, "pr", "diff", n, "-R", full], check=False).stdout
        lines = d.splitlines()
        lim = 1500 if big else 400
        print("\n## Diff (%d lines%s)" % (len(lines), "" if len(lines) <= lim else ", first %d shown; --full shows 1500" % lim))
        print("\n".join(l[:300] for l in lines[:lim]))
    else:
        tl = api("repos/%s/issues/%s/timeline?per_page=100" % (full, n)) or []
        prs = sorted({str(e["source"]["issue"]["number"]) for e in tl if e.get("event") == "cross-referenced" and e.get("source", {}).get("issue", {}).get("pull_request")})
        print("\n## PRs that mention it: %s" % (", ".join("#" + p for p in prs) or "-"))
    cm = api("repos/%s/issues/%s/comments?per_page=100" % (full, n)) or []
    if is_pr:
        for r in api("repos/%s/pulls/%s/reviews?per_page=100" % (full, n)) or []:
            if r.get("body"):
                cm.append({"user": r["user"], "created_at": r.get("submitted_at") or "", "body": "[review %s] %s" % (r["state"], r["body"])})
    cm.sort(key=lambda c: c["created_at"])
    print("\n## Last comments (%d of %d)" % (min(5, len(cm)), len(cm)))
    for c in cm[-5:]:
        print("- %s %s: %s" % (c["created_at"], c["user"]["login"], trim(c["body"], 600).replace("\n", "\n  ")))


def du_gb(p):
    r = run(["du", "-sk", p], check=False)
    try:
        return int(r.stdout.split()[0]) / 1048576
    except Exception:
        return 0.0


def wt_dirs():
    out = []
    if os.path.isdir(WT):
        for r in sorted(os.listdir(WT)):
            if not os.path.isdir(os.path.join(WT, r)):
                continue
            for d in sorted(os.listdir(os.path.join(WT, r))):
                if os.path.isdir(os.path.join(WT, r, d)):
                    out.append((r, d, os.path.join(WT, r, d)))
    return out


def wt_strays():
    out = []
    if os.path.isdir(WT):
        for r in os.listdir(WT):
            p = os.path.join(WT, r)
            if not os.path.isdir(p):
                out.append(p)
                continue
            out.extend(os.path.join(p, d) for d in os.listdir(p) if not os.path.isdir(os.path.join(p, d)))
    return sorted(out)


def marker(repo, branch):
    return os.path.join(STATE, "green__%s__%s" % (repo, branch.replace("/", "_")))


def reg_path(repo, d):
    return os.path.join(STATE, "wt__%s__%s.json" % (repo, d))


def reg_read(repo, d):
    try:
        with open(reg_path(repo, d)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def age_h(rec):
    try:
        return (time.time() - calendar.timegm(time.strptime(rec["created"], "%Y-%m-%dT%H:%M:%SZ"))) / 3600
    except (KeyError, TypeError, ValueError):
        return None


def avail_mem_gb():
    try:
        with open(MEMINFO) as f:
            for l in f:
                if l.startswith("MemAvailable:"):
                    return int(l.split()[1]) / 1048576
    except OSError:
        pass
    return None


PLAN_RE = re.compile(r"^\s*(PLAN READY|SMALL FIX)\b", re.M)


def plan_check(full, issue):
    it = api("repos/%s/issues/%s" % (full, issue))
    cm = api("repos/%s/issues/%s/comments?per_page=100" % (full, issue))
    if not isinstance(it, dict) or not isinstance(cm, list):
        die("cannot read %s#%s on GitHub, so its plan cannot be checked. No worktree made." % (full, issue))
    if not any(PLAN_RE.search(t or "") for t in [it.get("body")] + [c.get("body") for c in cm]):
        die("%s#%s has no plan marker. A builder starts only after the plan is on the issue and was challenged by someone who did not "
            "write it; the challenger then posts a line starting `PLAN READY`. A small known fix needs a line starting `SMALL FIX` "
            "with one sentence why. Tell @boss; no worktree made." % (full, issue))


def ensure_clone(full):
    p = os.path.join(REPOS, short(full))
    if not os.path.isdir(os.path.join(p, ".git")):
        run([GIT, "clone", "--quiet", "https://github.com/%s.git" % full, p], timeout=600)
    run([GIT, "fetch", "--quiet", "--prune", "origin"], cwd=p, timeout=300)
    follow_base(p)
    return p


def remote_has(p, br):
    return run([GIT, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + br], cwd=p, check=False).returncode == 0


def follow_base(p):
    if remote_has(p, "dev"):
        base = "dev"
    else:
        head = run([GIT, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd=p, check=False).stdout.strip()
        if head.startswith("origin/"):
            head = head[len("origin/"):]
        if head and remote_has(p, head):
            base = head
        elif remote_has(p, "main"):
            base = "main"
        else:
            return
    dirty = run([GIT, "status", "--porcelain", "--untracked-files=no"], cwd=p, check=False).stdout.strip()
    if dirty:
        cur = run([GIT, "rev-parse", "--short", "HEAD"], cwd=p, check=False).stdout.strip()
        print("shared checkout %s has local changes; left at %s" % (p, cur), file=sys.stderr)
        return
    run([GIT, "checkout", "--quiet", "--detach", "origin/" + base], cwd=p, check=False)


class Unprovable(Exception):
    pass


def is_clone(path):
    return os.path.isdir(os.path.join(path, ".git"))


def on_remote(p, sha):
    r = run([GIT, "for-each-ref", "--contains", sha, "refs/remotes/origin"], cwd=p, check=False)
    if r.returncode:
        raise Unprovable(sha)
    return bool(r.stdout.strip())


SWEEP_FETCH = None


def unsaved(p, path, branch):
    if SWEEP_FETCH is not None and p in SWEEP_FETCH:
        if not SWEEP_FETCH[p]:
            return None
    elif run([GIT, "fetch", "--quiet", "--prune", "origin"], cwd=p, check=False).returncode:
        return None
    tips = {run([GIT, "rev-parse", "--verify", "--quiet", ref], cwd=c, check=False).stdout.strip()
            for c, ref in ((path, "HEAD"), (p, "refs/heads/" + branch)) if os.path.isdir(c)} - {""}
    try:
        return [sha for sha in sorted(tips) if not on_remote(p, sha)]
    except Unprovable:
        return None


def wt_save(p, path, branch):
    if os.path.isdir(path) and run([GIT, "status", "--porcelain"], cwd=path).stdout.strip():
        die("%s has uncommitted changes. Commit and push them, or remove them yourself, then `wt done` again. Nothing deleted." % path)
    left = unsaved(p, path, branch)
    if left is None:
        die("cannot fetch origin, so cannot prove the commits of %s are saved. Nothing deleted." % branch)
    for sha in left:
        rb = "rescue/%s-%s" % (branch, sha[:8])
        run([GIT, "push", "--quiet", "origin", "%s:refs/heads/%s" % (sha, rb)], cwd=p, check=False)
        try:
            saved = on_remote(p, sha)
        except Unprovable:
            saved = False
        if not saved:
            die("%s has commits on no remote branch (%s) and the push to %s failed. Nothing deleted." % (branch, sha[:8], rb))
        print("RESCUED unpushed commits of %s to origin/%s" % (branch, rb))


def unlink_links(d):
    for e in os.scandir(d):
        if e.is_symlink() or getattr(os.path, "isjunction", lambda _: False)(e.path):
            try:
                os.unlink(e.path)
            except OSError:
                os.rmdir(e.path)
        elif e.is_dir():
            unlink_links(e.path)


def cmd_wt(a):
    if a and a[0] == "mode":
        import clones
        return clones.cmd_mode(a)
    if a and a[0] in ("janitor", "doctor", "restore"):
        import janitor
        return janitor.main(a)
    if not a or a[0] not in ("new", "done", "list", "sweep"):
        die("usage: wt new <repo> <issue> <chunk> [--base BRANCH] [--owner NAME] | wt done <repo> <issue> <chunk> | wt list | wt sweep [--apply]")
    if a[0] == "sweep":
        return wt_sweep("--apply" in a)
    if a[0] == "list":
        act = 0
        for r, d, p in wt_dirs():
            br = run([GIT, "rev-parse", "--abbrev-ref", "HEAD"], cwd=p, check=False).stdout.strip()
            g = os.path.exists(marker(r, br))
            act += 0 if g else 1
            rec = reg_read(r, d)
            h = age_h(rec)
            print("%s/%s  branch %s  %.2f GB  owner %s  age %s  %s" % (r, d, br, du_gb(p), rec.get("owner", "unknown"),
                                                                     "?" if h is None else "%dh" % h, "CI green, waits for merge" if g else "ACTIVE builder"))
        for p in wt_strays():
            print("stray, not a worktree: " + p)
        st = shutil.disk_usage(WORK if os.path.isdir(WORK) else "/")
        print("active builders: %d | %d job folders, %.1f GB | free %.0f GB (floor %d)" % (act, len(wt_dirs()), du_gb(WORK), st.free / 2**30, MIN_FREE_GB))
        return
    if len(a) < 4:
        die("usage: wt %s <repo> <issue> <chunk>" % a[0])
    full, issue, chunk = repo_full(a[1]), a[2].lstrip("#"), a[3]
    if not (issue.isdigit() and re.fullmatch(r"[a-z0-9]{1,12}", chunk)):
        die("issue must be a number and chunk a short id like 1 or 2b")
    repo = short(full)
    path = os.path.join(WT, repo, "%s-%s" % (issue, chunk))
    branch = "chunk/%s-%s" % (issue, chunk)
    if a[0] == "done":
        p = os.path.join(REPOS, repo)
        if is_clone(path):
            die("%s is a job clone, not a worktree of the shared clone. The janitor removes it. Nothing deleted." % path)
        wt_save(p, path, branch)
        if os.path.isdir(path):
            unlink_links(path)
            run([GIT, "worktree", "remove", "--force", path], cwd=p)
        run([GIT, "worktree", "prune"], cwd=p, check=False)
        run([GIT, "branch", "-D", branch], cwd=p, check=False)
        for f in (marker(repo, branch), reg_path(repo, "%s-%s" % (issue, chunk))):
            try:
                os.remove(f)
            except OSError:
                pass
        print("removed worktree %s and local branch %s" % (path, branch))
        return
    return wt_new_clone(a, full, issue, chunk)


def wt_new_clone(a, full, issue, chunk):
    import clones
    job = "%s-%s-%s" % (short(full), issue, chunk)
    try:
        wt_new_clone_steps(a, full, issue, chunk)
    except SystemExit as e:
        if e.code in (None, 0):
            clones.record("ok", job)
        raise
    except Exception:
        line = clones.record("fault", job)
        if line:
            print(line)
        raise
    else:
        clones.record("ok", job)


def wt_new_clone_steps(a, full, issue, chunk):
    import clones
    room_check()
    plan_check(full, issue)
    info = api("repos/%s" % full)
    if not isinstance(info, dict) or "default_branch" not in info:
        clones.transient("cannot read %s on GitHub" % full)
    base = a[a.index("--base") + 1] if "--base" in a else None
    owner = a[a.index("--owner") + 1] if "--owner" in a else os.environ.get("FACTORY_OWNER") or "unknown"
    return clones.new(full, issue, chunk, base, owner, info["default_branch"])


INSTALLS = (("pnpm-lock.yaml", ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"]),
            ("package-lock.json", ["npm", "ci", "--prefer-offline"]),
            ("yarn.lock", ["yarn", "install", "--frozen-lockfile"]),
            ("uv.lock", ["uv", "sync", "--frozen"]))
CI_ONLY = ("Cargo.lock",)


def install_deps(path, runner=None):
    cmd = next((c for name, c in INSTALLS if os.path.isfile(os.path.join(path, name))), None)
    if cmd is None:
        only = [name for name in CI_ONLY if os.path.isfile(os.path.join(path, name))]
        print("nothing installed here: %s" % ("%s is built by the checks only" % only[0] if only else
                                                 "none of %s is here" % ", ".join(name for name, _ in INSTALLS)))
        return
    t0 = time.time()
    try:
        r = runner(cmd, path, 300) if runner else run(cmd, cwd=path, check=False, timeout=300)
        err = None if r.returncode == 0 else ((r.stderr or r.stdout or "").strip().splitlines() or ["exit %d" % r.returncode])[0]
    except (OSError, subprocess.SubprocessError) as e:
        err = (str(e).splitlines() or [type(e).__name__])[0]
    if err is None:
        print("dependencies installed in %d s" % (time.time() - t0))
    else:
        print("dependencies NOT installed: %s" % err[:200])
    return err


def pr_lookup(full, branch):
    try:
        r = run([GH, "pr", "list", "-R", full, "--head", branch, "--state", "all", "--limit", "20", "--json", "number,state,headRefOid"], check=False)
        return None if r.returncode else json.loads(r.stdout or "[]")
    except (ValueError, OSError):
        return None


def sweep_verdict(full, r, d, path):
    if not os.path.isdir(os.path.join(REPOS, r)):
        return "KEEP", "no shared clone %s, cannot prove anything" % os.path.join(REPOS, r), []
    if is_clone(path):
        return "KEEP", "a job clone, not a worktree of the shared clone", []
    if not re.fullmatch(r"\d+-[a-z0-9]{1,12}", d):
        return "KEEP", "not made by `wt new`", []
    branch = "chunk/" + d
    head = run([GIT, "rev-parse", "--abbrev-ref", "HEAD"], cwd=path, check=False).stdout.strip()
    if head != branch:
        return "KEEP", "on branch %s, not %s" % (head, branch), []
    dirty = bool(run([GIT, "status", "--porcelain"], cwd=path, check=False).stdout.strip())
    left, prs = unsaved(os.path.join(REPOS, r), path, branch), pr_lookup(full, branch)
    if left is None or prs is None:
        return "KEEP", "cannot reach origin or GitHub, so cannot prove anything", []
    if any(x.get("state", "").upper() == "OPEN" for x in prs):
        return "KEEP", "PR #%s open" % ", #".join(str(x["number"]) for x in prs if x.get("state", "").upper() == "OPEN"), prs
    sha = run([GIT, "rev-parse", "HEAD"], cwd=path).stdout.strip()
    def settled(x):
        st = x.get("state", "").upper()
        if x.get("headRefOid") == sha and st in ("MERGED", "CLOSED"):
            return True
        return st == "MERGED" and bool(x.get("headRefOid")) and run([GIT, "merge-base", "--is-ancestor", sha, x["headRefOid"]], cwd=path, check=False).returncode == 0
    done = next((x for x in prs if settled(x)), None)
    if done and not left and not dirty:
        return "REMOVE", "PR #%s %s, nothing unpushed" % (done["number"], done["state"].lower()), prs
    h = age_h(reg_read(r, d))
    last = max(int(run([GIT, "log", "-1", "--format=%ct", "HEAD"], cwd=path).stdout.strip() or 0), 0 if h is None else time.time() - h * 3600)
    idle = (time.time() - last) / 3600
    work = ", ".join(x for x in ("%d unpushed commit tip(s)" % len(left) if left else "", "uncommitted changes" if dirty else "") if x)
    if work and idle >= WT_IDLE_HOURS:
        return "RESCUE", "idle %dh, %s, no open PR" % (idle, work), prs
    return "KEEP", "active: idle %dh, %s" % (idle, work or "no merged or closed PR"), prs


def wt_sweep(apply, only=None, quiet=False):
    global SWEEP_FETCH
    n, kept = {"KEEP": 0, "REMOVE": 0, "RESCUE": 0}, []
    dirs = wt_dirs()
    SWEEP_FETCH = {}
    try:
        for r in sorted({r for r, _, _ in dirs}):
            p = os.path.join(REPOS, r)
            if not os.path.isdir(p):
                continue
            SWEEP_FETCH[p] = run([GIT, "fetch", "--quiet", "--prune", "origin"], cwd=p, check=False).returncode == 0
        return _sweep_each(dirs, apply, only, quiet, n, kept)
    finally:
        SWEEP_FETCH = None


def _sweep_each(dirs, apply, only, quiet, n, kept):
    for r, d, path in dirs:
        full = reg_read(r, d).get("repo") or repo_full(r)
        verdict, why, prs = sweep_verdict(full, r, d, path)
        n[verdict] += 1
        line = "%-6s %s/%s  %s" % (verdict, r, d, why)
        if verdict == "KEEP":
            kept.append(line)
        if not (quiet and verdict == "KEEP"):
            print(line)
        if not apply or verdict == "KEEP" or (only and verdict != only):
            continue
        try:
            cmd_wt(["done", full] + d.split("-", 1))
        except SystemExit:
            print("KEPT %s/%s: `wt done` refused (see above), nothing deleted." % (r, d))
            continue
        nums = {str(x["number"]) for x in prs if x.get("state", "").upper() != "OPEN"}
        for sd, pat in ((STATE, r"ciwait__%s__(\d+)__[0-9a-f]+\.json"), (os.path.join(STATE, "gate"), r"%s-(\d+)-[0-9a-f]+\.json")):
            for f in sorted(os.listdir(sd)) if os.path.isdir(sd) else []:
                m = re.fullmatch(pat % re.escape(r), f)
                if m and m.group(1) in nums:
                    os.remove(os.path.join(sd, f))
                    print("deleted stale state %s" % f)
    summary = "sweep: %d KEEP, %d REMOVE, %d RESCUE | %s" % (n["KEEP"], n["REMOVE"], n["RESCUE"],
                                                          "applied" if apply else "dry run, nothing changed. `wt sweep --apply` acts on REMOVE and RESCUE")
    if not quiet:
        print(summary)
    return summary, kept


def wt_context():
    cwd = os.getcwd()
    if not cwd.startswith(WT + "/"):
        die("run this inside a worktree under %s (cd there in the same shell call)" % WT)
    top = run([GIT, "rev-parse", "--show-toplevel"], cwd=cwd).stdout.strip()
    branch = run([GIT, "rev-parse", "--abbrev-ref", "HEAD"], cwd=top).stdout.strip()
    base = run([GIT, "config", "branch.%s.factorybase" % branch], cwd=top, check=False).stdout.strip()
    m = re.fullmatch(r"chunk/(\d+)-([a-z0-9]+)", branch)
    if not m or not base:
        die("this worktree was not made by `wt new` (branch %s)" % branch)
    url = run([GIT, "remote", "get-url", "origin"], cwd=top).stdout.strip()
    if "github.com/" not in url:
        die("origin of this clone is %s, not a GitHub URL. Nothing pushed; tell @boss." % url)
    full = repo_full(re.sub(r"\.git$", "", url.split("github.com/")[1]))
    return top, full, branch, base, m.group(1), m.group(2)


TOKEN_SHAPE = re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}")
TOKEN_BYTES = re.compile(TOKEN_SHAPE.pattern.encode())


def token_shapes(top, base):
    rows = [r.split(" ", 1) for r in run([GIT, "rev-list", "--objects", "HEAD", "--not", "origin/%s" % base], cwd=top).stdout.splitlines()]
    names = {r[0]: r[1] for r in rows if len(r) == 2 and r[1]}
    r = subprocess.run([GIT, "cat-file", "--batch"], input="".join(s + "\n" for s in names).encode(), capture_output=True, cwd=top, timeout=300)
    out, found, at, read = r.stdout, [], 0, 0
    while at < len(out) and not r.returncode:
        end = out.find(b"\n", at)
        head = out[at:end].decode("ascii", "replace").split() if end >= 0 else []
        if len(head) != 3 or not head[2].isdigit() or end + 1 + int(head[2]) >= len(out):
            break
        sha, kind, size = head
        read += 1
        new = set(TOKEN_BYTES.findall(out[end + 1:end + 1 + int(size)])) if kind == "blob" else set()
        at = end + 2 + int(size)
        if new:
            held = subprocess.run([GIT, "cat-file", "blob", "origin/%s:%s" % (base, names[sha])], capture_output=True, cwd=top, timeout=300).stdout
            if new - set(TOKEN_BYTES.findall(held)):
                found.append(names[sha])
    if r.returncode or read != len(names):
        die("the new files could not be read for the token check (git cat-file exit %s, %d of %d read). Nothing pushed. Try again." % (r.returncode, read, len(names)))
    if TOKEN_SHAPE.search(run([GIT, "log", "--format=%B", "origin/%s..HEAD" % base], cwd=top).stdout):
        found.append("a commit message")
    conf = run([GIT, "config", "--local", "--list"], cwd=top, check=False).stdout
    if TOKEN_SHAPE.search(conf) or "@github.com" in run([GIT, "remote", "-v"], cwd=top, check=False).stdout:
        found.append(".git/config")
    return sorted(set(found))


def clone_ready(top, full, branch, base):
    import mirror
    if not os.path.isfile(os.path.join(top, ".git", "factory-ready")):
        i, c = branch.split("/", 1)[1].split("-", 1)
        die("this clone was not finished. Run `wt new %s %s %s` again first; it finishes the steps and changes nothing else." % (short(full), i, c))
    url = run([GIT, "remote", "get-url", "origin"], cwd=top).stdout.strip()
    if url != mirror.url(full):
        die("origin of this clone is %s, not %s. Nothing pushed; tell @boss." % (url, mirror.url(full)))
    mark = os.path.join(top, ".git", "factory-merging")
    if os.path.exists(mark):
        run([GIT, "merge", "--abort"], cwd=top, check=False)
        os.remove(mark)
        print("cleared an automatic merge of %s that was cut off earlier" % base)


def merge_base_in(top, branch, base):
    if run([GIT, "merge-base", "--is-ancestor", "origin/" + base, "HEAD"], cwd=top, check=False).returncode == 0:
        return
    mark = os.path.join(top, ".git", "factory-merging")
    open(mark, "w").close()
    r = run([GIT, "merge", "--no-commit", "--no-ff", "origin/" + base], cwd=top, check=False)
    if r.returncode:
        files = run([GIT, "diff", "--name-only", "--diff-filter=U"], cwd=top, check=False).stdout.split()
        run([GIT, "merge", "--abort"], cwd=top, check=False)
        os.remove(mark)
        die("CONFLICT: %s moved and conflicts with this branch in %s. Merge origin/%s yourself, commit, then run pr-open again." % (base, ", ".join(files) or "?", base))
    r = run([GIT, "commit", "--quiet", "--no-edit", "-m", "Merge origin/%s into %s" % (base, branch)], cwd=top, check=False)
    if r.returncode:
        run([GIT, "merge", "--abort"], cwd=top, check=False)
        os.remove(mark)
        die("the automatic merge of origin/%s could not be committed: %s. Nothing pushed." % (base, (r.stderr or r.stdout).strip()[-300:]))
    os.remove(mark)
    print("MERGED origin/%s into %s first: the branch was behind" % (base, branch))


def has_heads(text, heads):
    return [h for h in heads if h not in text]


PREFLIGHT_LINE_S = 900


NOT_HERE = re.compile(r"^bash: (?:line \d+: )?(.+): command not found$", re.M)


def not_here(line, out):
    try:
        words = shlex.split(line)
    except ValueError:
        return False
    return any(name in words for name in NOT_HERE.findall(out))


def preflight_lines(top, body):
    import redgreen
    lines = redgreen.run_lines(body)
    wf = os.path.join(top, ".github", "workflows", "red-green.yml")
    prepare = re.findall(r'--prepare "([^"]+)"', open(wf).read()) if lines and os.path.isfile(wf) else []
    for k, line in enumerate(prepare + lines):
        try:
            r = subprocess.run(["bash", "-c", line], cwd=top, capture_output=True, text=True, errors="replace", timeout=PREFLIGHT_LINE_S)
            code, out = r.returncode, r.stdout + r.stderr
        except subprocess.TimeoutExpired:
            code, out = 124, "timed out after %d s" % PREFLIGHT_LINE_S
        if k < len(prepare):
            if code:
                print("the prepare step `%s` of red-green.yml did not run here (exit %d): %s" % (line, code, " ".join(out.split())[-300:]))
        elif code == 127 and not_here(line, out):
            print("not run on this server: " + line)
        elif code:
            die("the Run line `%s` fails here (exit %d), nothing is pushed. Its last lines:\n%s" % (line, code, "\n".join(out.splitlines()[-20:])))
        else:
            print("Run line passed: " + line)


def preflight_lint(top, changed):
    if not any(f.startswith("tools/factory/") and f.endswith(".py") for f in changed):
        return
    wf = os.path.join(top, ".github", "workflows", "factory-tools.yml")
    pin = re.search(r"ruff==([0-9][0-9.]*)", open(wf).read()) if os.path.isfile(wf) else None
    uvx = os.environ.get("FACTORY_UVX") or "/data/tools/bin/uvx"
    if not pin:
        print("lint not run: no ruff==<version> in .github/workflows/factory-tools.yml")
        return
    if not shutil.which(uvx):
        print("lint not run: %s is not on this server" % uvx)
        return
    try:
        r = run([uvx, "ruff==" + pin.group(1), "check", "tools/factory"], cwd=top, check=False, timeout=PREFLIGHT_LINE_S)
        code, out = r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        code, out = 124, "timed out after %d s" % PREFLIGHT_LINE_S
    if code == 1:
        die("ruff==%s check tools/factory finds this (exit %d), nothing is pushed. Its last lines:\n%s" % (pin.group(1), code, "\n".join(out.splitlines()[-40:])))
    if code:
        print("lint not run: ruff==%s did not run here (exit %d): %s" % (pin.group(1), code, (out.strip().splitlines() or [""])[-1][:200]))
        return
    print("lint passed: ruff==%s check tools/factory" % pin.group(1))


def cmd_pr_open(a):
    if "--template" in a:
        print(PR_TEMPLATE)
        return
    top, full, branch, base, issue, chunk = wt_context()
    clone = is_clone(top)
    if clone:
        clone_ready(top, full, branch, base)
    if run([GIT, "status", "--porcelain"], cwd=top).stdout.strip():
        die("uncommitted changes. Commit everything for this chunk first (one push per chunk).")
    run([GIT, "fetch", "--quiet", "origin", base], cwd=top)
    ahead = run([GIT, "rev-list", "--count", "origin/%s..HEAD" % base], cwd=top).stdout.strip()
    if ahead == "0":
        die("no commits ahead of origin/%s" % base)
    if clone:
        merge_base_in(top, branch, base)
    changed = run([GIT, "diff", "--name-only", "--no-renames", "origin/%s...HEAD" % base], cwd=top).stdout.split()
    if any(re.match(WF, f) for f in changed):
        die("this chunk changes workflow files (.github/workflows or actions). They are Rob's. Return BLOCKED to @boss.")
    msgs = run([GIT, "log", "--format=%B", "origin/%s..HEAD" % base], cwd=top).stdout
    if re.search(r"co-authored-by|generated with", msgs, re.I):
        die("a commit message has an AI trailer. Amend it before the push (nothing is pushed yet).")
    shapes = token_shapes(top, base)
    if shapes:
        die("the shape of a GitHub token is in %s. Nothing pushed. Take it out (a test builds its fake token from parts)." % ", ".join(shapes))
    got = api("repos/%s/issues/%s" % (full, issue))
    if got is None:
        die("could not read issue #%s to check the change against its **Files**. Try again." % issue)
    plan = (got.get("body") or "") if isinstance(got, dict) else ""
    if isinstance(got, dict) and "number" in got:
        paths = cutshape.parse(got)["paths"]
        if paths:
            out = [f for f in changed if not any(f == p or f.startswith(p.rstrip("/") + "/") or fnmatch.fnmatchcase(f, p) for p in paths)]
            if out:
                if "--fix" not in a and "--body-file" in a:
                    note = open(a[a.index("--body-file") + 1]).read()
                else:
                    open_prs = json.loads(run([GH, "pr", "list", "-R", full, "--head", branch, "--state", "open", "--json", "body"]).stdout or "[]")
                    note = (open_prs[0].get("body") or "") if open_prs else ""
                section = ADAPTED_HEAD.split(note, 1)
                listed = set(re.findall(r"(?m)^- `([^`]+)`: \S", section[1].split("\n## ", 1)[0])) if len(section) > 1 else set()
                out = [f for f in out if not (f in listed and ADAPTABLE.search(f) and os.path.isfile(os.path.join(top, f))
                                              and run([GIT, "cat-file", "-t", "origin/%s:%s" % (base, f)], cwd=top, check=False).stdout.strip() == "blob")]
            if out:
                die("files outside the **Files** of issue #%s: %s. Take them out of the change, or end with BLOCKED: plan: <why>. "
                    "An existing test that the change the issue specifies makes wrong may change when the handoff note lists it "
                    "under `## Tests adapted` as \"- `path`: why\"." % (issue, ", ".join(out)))
    ex = json.loads(run([GH, "pr", "list", "-R", full, "--head", branch, "--state", "open", "--json", "number,url,headRefOid"]).stdout or "[]")
    if ex:
        if "--fix" not in a:
            die("PR already open: %s. To push a fix for red CI use `pr-open --fix`." % ex[0]["url"])
        head = ex[0].get("headRefOid") or ""
        runs = api("repos/%s/actions/runs?head_sha=%s&per_page=100" % (full, head))
        if not isinstance(runs, dict):
            print("could not read the workflow runs of the head %s; the one-run-per-head check is skipped." % head[:7])
        pending = ciwait.unfinished((runs.get("workflow_runs") or []) if isinstance(runs, dict) else [])
        if pending:
            die("a workflow run of the pull request's head %s is not finished (%s). One CI run per head: wait for it with `ci-wait %s %s`, then push once."
                % (head[:7], ciwait.pending_text(pending), short(full), ex[0]["number"]))
        preflight_lines(top, plan)
        preflight_lint(top, changed)
        try:
            os.remove(marker(short(full), branch))
        except OSError:
            pass
        run([GIT, "push", "--quiet", "origin", branch], cwd=top)
        print("PUSHED fix to %s\nPR %s\nNext: `ci-wait %s %s`" % (branch, ex[0]["url"], short(full), ex[0]["number"]))
        return
    if "--title" not in a or "--body-file" not in a:
        die("usage: pr-open --title 'T' --body-file FILE   (template: pr-open --template)")
    title, bf = a[a.index("--title") + 1], a[a.index("--body-file") + 1]
    body = open(bf).read()
    miss = has_heads(body, PR_HEADS)
    if miss:
        die("the handoff note lacks: %s. Template: pr-open --template" % ", ".join(miss))
    preflight_lines(top, plan)
    preflight_lint(top, changed)
    body = "Job: %s#%s, chunk %s\n\n%s" % (named(full), issue, chunk, body)
    if not re.search(r"(?mi)^Closes #%s\s*$" % issue, body):
        body += "\n\nCloses #%s\n" % issue
    tmp = os.path.join(STATE, "prbody-%d.md" % os.getpid())
    open(tmp, "w").write(body)
    run([GIT, "push", "--quiet", "-u", "origin", branch], cwd=top)
    cmd = [GH, "pr", "create", "-R", full, "--base", base, "--head", branch, "--title", title, "--body-file", tmp]
    delays = [60, 120, 240]
    while True:
        r = run(cmd, check=False)
        if not r.returncode:
            break
        text = (r.stderr or r.stdout).strip()
        slow = "submitted too quickly" in text or "secondary rate limit" in text
        if slow and delays:
            time.sleep(delays.pop(0))
            continue
        os.remove(tmp)
        suffix = " (tried 4 times over 7 minutes)" if slow else ""
        die("command failed: %s\n%s%s" % (" ".join(cmd[:6]), text[-600:], suffix), 1)
    os.remove(tmp)
    url = r.stdout.strip().splitlines()[-1]
    print("PR %s\nbase %s <- %s | %s commits | %d files\nNext: `ci-wait %s %s`. Fix a red result yourself; hand over only when green." % (url, base, branch, ahead, len(changed), short(full), url.rsplit("/", 1)[-1]))


def cmd_ci_wait(a):
    if len(a) < 2:
        die("usage: ci-wait <repo> <PR> [--once]")
    full, n = repo_full(a[0]), a[1].lstrip("#")
    pr = api("repos/%s/pulls/%s" % (full, n))
    if not pr:
        die("PR not found", 1)
    sha, branch = pr["head"]["sha"], pr["head"]["ref"]
    sf = os.path.join(STATE, "ciwait__%s__%s__%s.json" % (short(full), n, sha[:12]))
    try:
        first = json.load(open(sf))["first"]
    except Exception:
        first = time.time()
        json.dump({"first": first}, open(sf, "w"))
    end = time.time() + (0 if "--once" in a else SLICE_S)
    while True:
        cs = checks(full, sha)
        s = ci_state(cs)
        waited = time.time() - first
        if s in ("GREEN", "RED") or time.time() >= end or waited >= QUEUE_LIMIT_S:
            break
        time.sleep(20)
    print("CI %s | %s#%s @ %s | waited %d min in total" % (s, full, n, sha[:8], waited // 60))
    print(ci_table(cs))
    if s == "GREEN":
        open(marker(short(full), branch), "w").write(sha)
        print("NEXT: return the PR link to @boss. Do not merge.")
    elif s == "RED":
        for c in [c for c in cs if c["conclusion"] in ("failure", "timed_out", "startup_failure")][:2]:
            lg = run([GH, "api", "repos/%s/actions/jobs/%s/logs" % (full, c["id"])], check=False).stdout.splitlines()
            print("\n--- %s: last 60 log lines\n%s" % (c["name"], "\n".join(l[:240] for l in lg[-60:]) or "(no log; open %s)" % c["url"]))
        print("\nNEXT: fix it in your worktree, commit, `pr-open --fix`, then `ci-wait` again. Two red results on the same chunk: return BLOCKED to @boss.")
    elif waited >= QUEUE_LIMIT_S:
        print("STOP: 30 minutes without a result. Rob's runners are probably off. Return BLOCKED to @boss with this table. Do NOT push or re-run to wake it.")
    elif s == "NONE":
        print("NO CHECKS have started for this commit yet. Call `ci-wait` again (30-minute limit, %d min used). Do not push again." % (waited // 60))
    else:
        print("WAITING (queued is waiting, not failed). Call `ci-wait` again (30-minute limit, %d min used). Do not push again." % (waited // 60))


RULES = [
    ("STOP", r"^\.github/(workflows|actions)/|^\.github/(CODEOWNERS|dependabot\.yml)$", "workflow or GitHub settings file: Rob only"),
    ("BRUCE", r"auth|oidc|keycloak|login|session|token|secret|password|crypto|permission|guard|role|cors|csrf|sanitize|upload", "auth, secrets or trust boundary"),
    ("BRUCE", r"(^|/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.(toml|lock)|requirements[^/]*\.txt|pyproject\.toml|Dockerfile[^/]*|docker-compose[^/]*\.yml)$", "dependencies or image"),
    ("CODD", r"migration|schema|\.sql$|\.entity\.ts$|prisma|typeorm|seed", "schema, migration or data"),
    ("GRACE", r"openapi|swagger|\.controller\.ts$|\.dto\.ts$|\.proto$|/api/|contract", "API contract"),
    ("DIETER", r"\.(scss|css|html|svg)$|theme|design-tokens", "visible UI"),
    ("FRED", r"^frontend/.*\.(ts|tsx|html|scss|css)$", "frontend behaviour: browser check of the touched flow"),
]
SAFE = r"\.(md|txt)$|(^|/)(docs?|specs?|tasks|\.planning)/|\.spec\.ts$|\.test\.[jt]sx?$|(^|/)tests?/|__tests__"


def cmd_risk(a):
    if len(a) < 2:
        die("usage: risk <repo> <PR> [--no-jev]")
    full, n = repo_full(a[0]), a[1].lstrip("#")
    pr = api("repos/%s/pulls/%s" % (full, n))
    files = api("repos/%s/pulls/%s/files?per_page=100" % (full, n)) or []
    need, plain = {}, []
    claims_ok, claim_lines = True, []
    for f in files:
        fn, hit = f["filename"], False
        test_only = re.search(r"\.spec\.ts$|\.test\.[jt]sx?$|(^|/)tests?/|__tests__|\.md$", fn)
        for who, pat, why in RULES:
            if re.search(pat, fn, re.I) and not (test_only and who not in ("STOP",)):
                need.setdefault(who, [why, []])[1].append(fn)
                hit = True
        if not hit and not re.search(SAFE, fn, re.I):
            plain.append(fn)
    try:
        ro = base_roster(full)
    except RosterError as e:
        die("risk: " + str(e), 1)
    if ro is None and short(full) != short(home()):
        import roster as R
        need.setdefault(R.GATE_SENSITIVE, ["this project has no roster: every change needs the second reviewer", []])[1].extend(f["filename"] for f in files)
    if ro:
        import roster as R
        need = {k: v for k, v in need.items() if k == "STOP"}
        plain = []
        order = [x["name"] for x in ro["areas"]] + ["default"]
        sens = {x["name"] for x in ro["areas"] + [ro["default"]] if x["sensitive"]}
        by_who = {}
        for f in files:
            fn = f["filename"]
            for area in R.areas(ro, [fn]):
                for who in [R.owner(ro, area)] + ([R.GATE_SENSITIVE] if area in sens else []):
                    got = by_who.setdefault(who, [set(), []])
                    got[0].add(area)
                    if fn not in got[1]:
                        got[1].append(fn)
        for who, (areas_of_who, files_of_who) in by_who.items():
            need[who] = ["roster owner (area %s)" % ", ".join(x for x in order if x in areas_of_who), files_of_who]
        import gate as G
        m = re.search(r"Job: [\w./-]+#(\d+)", (pr or {}).get("body") or "")
        if not m:
            m = re.fullmatch(r"chunk/(\d+)-\w+", ((pr or {}).get("head") or {}).get("ref", ""))
        jobn = m.group(1) if m else None
        try:
            others = G.open_claims(full, n, jobn)
        except G.NoAnswer as e:
            die("risk: cannot list open work: " + str(e), 1)
        s8 = ((pr or {}).get("head") or {}).get("sha", "")[:8]
        verdict = {}
        for cm in sorted(api("repos/%s/issues/%s/comments?per_page=100" % (full, n), paginate=True) or [], key=lambda c: c["created_at"]):
            body = cm.get("body") or ""
            mm = G.REVIEW_RE.match(body)
            if mm and mm.group(2) == s8:
                verdict[mm.group(3).upper()] = (mm.group(4), "", body[mm.end():])
        names = [f["filename"] for f in files]
        claims_ok, claim_lines = R.claims_check([(x, r, R.owner(ro, x)) for x, refs in R.overlaps(ro, names, others).items() for r in refs], verdict)
    tops = {f["filename"].split("/")[0] for f in files}
    lines = sum(f["additions"] + f["deletions"] for f in files)
    if len(files) > 25 or lines > 1200:
        need.setdefault("ADA", ["large change (%d files, %d lines): structure check" % (len(files), lines), []])
    print("RISK %s#%s: %d files, %d lines, top folders: %s" % (full, n, len(files), lines, ", ".join(sorted(tops))))
    if "STOP" in need:
        print("STOP: touches %s. Workflow files are Rob's. Return BLOCKED to Rob." % ", ".join(need["STOP"][1][:5]))
    jev_note = ""
    if plain and not need and "--no-jev" not in a and (lines > 150 or len(plain) > 6):
        jev_note = jev_risk(pr["title"], [f["filename"] for f in files], need)
    extra = [w for w in need if w not in ("STOP", "LINUS")]
    for w in extra:
        print("EXTRA REVIEWER %s: %s%s" % (w, need[w][0], (" (" + ", ".join(need[w][1][:4]) + (" ..." if len(need[w][1]) > 4 else "") + ")") if need[w][1] else ""))
    if not extra and "STOP" not in need:
        print("EXTRA REVIEWERS: none. LINUS alone.")
    if jev_note:
        print(jev_note)
    for line in claim_lines:
        print(line)
    if not claims_ok:
        sys.exit(1)


def jev_risk(title, files, need):
    key = None
    try:
        for l in open("@@JEV_KEYFILE@@"):
            if l.startswith("TYPESAFE_API_KEY="):
                key = l.split("=", 1)[1].strip().strip("\"'")
    except Exception:
        pass
    if not key:
        return "Jev: not asked (no key)."
    crit = {"true": "Yes, this change plausibly does that", "false": "No, nothing in the title or file names suggests it"}
    qs = {"BRUCE": "Does the change in `change` touch authentication, permissions, secrets, input from outside or dependencies?",
          "CODD": "Does the change in `change` alter a database schema, a migration or stored data?",
          "GRACE": "Does the change in `change` alter an API that another program or the frontend calls?",
          "FRED": "Does the change in `change` alter what a user sees or does in the browser?"}
    body = json.dumps({"model": "jev-latest", "state": {"change": {"title": title, "files": files[:60]}},
                       "questions": {k: {"type": "noul", "instructions": v, "criteria": crit} for k, v in qs.items()}}).encode()
    try:
        req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", data=body, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": "rerun-factory-risk/0.1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.load(r)
        res = {k: round(out["answers"][k]["noul"], 2) for k in qs}
        for k, v in res.items():
            if v >= 0.7:
                need.setdefault(k, ["Jev says likely (%.2f), file names alone were unclear" % v, []])
        return "Jev (unclear case, file names and title only, %s input tokens): %s" % (out.get("usage", {}).get("input_tokens", "?"), res)
    except Exception as e:
        return "Jev: call failed (%s); decided on the path table alone." % str(e)[:80]


def cmd_merge_dev(a):
    if os.environ.get("FACTORY_DISPATCHER") != "1":
        die("merge-dev is restricted to the factory dispatcher.")
    if len(a) < 2:
        die("usage: merge-dev <repo> <PR> [--note 'one-line verdict, posted on the PR']")
    full, n = repo_full(a[0]), a[1].lstrip("#")
    pr = api("repos/%s/pulls/%s" % (full, n))
    info = api("repos/%s" % full)
    if not pr:
        die("PR not found", 1)
    base, head = pr["base"]["ref"], pr["head"]["ref"]
    if base in ("main", "master", info["default_branch"]) and base != "dev":
        die("base is %s. Merging into main is Rob's step. Give your verdict to @boss instead." % base)
    if not (base == "dev" or base.startswith("job/")):
        die("base %s is neither dev nor a job branch" % base)
    if pr.get("merged"):
        print("MERGED earlier as %s: %s#%s into %s, nothing to do" % ((pr.get("merge_commit_sha") or "?")[:8], full, n, base))
        return
    if pr["state"] != "open" or pr["draft"]:
        die("PR is %s%s" % (pr["state"], " (draft)" if pr["draft"] else ""))
    files = api("repos/%s/pulls/%s/files?per_page=100" % (full, n)) or []
    if any(re.match(WF, f["filename"]) for f in files):
        die("PR changes workflow files. Rob only.")
    cs = checks(full, pr["head"]["sha"])
    s = ci_state(cs)
    if s != "GREEN":
        die("CI is %s on %s, not GREEN. Reviewers never wait on CI: return BLOCKED to @boss.\n%s" % (s, pr["head"]["sha"][:8], ci_table(cs)))
    g = run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "gate.py"), full, n], check=False)
    if g.returncode:
        die("gate did not pass at %s (exit %s), not merging.\n%s" % (pr["head"]["sha"][:8], g.returncode, (g.stdout or g.stderr).strip()[-600:]), 1)
    if "--note" in a:
        run([GH, "pr", "comment", n, "-R", full, "--body", "Review ACCEPT @%s: %s" % (pr["head"]["sha"][:8], a[a.index("--note") + 1][:60000])], check=False)
    r = run([GH, "pr", "merge", n, "-R", full, "--merge", "--match-head-commit", pr["head"]["sha"]], check=False)
    if r.returncode:
        die("merge failed: %s" % (r.stderr or r.stdout).strip()[-400:], 1)
    run([GH, "api", "-X", "DELETE", "repos/%s/git/refs/heads/%s" % (full, head)], check=False)
    m = api("repos/%s/pulls/%s" % (full, n))
    print("MERGED %s#%s into %s as %s | head %s | remote branch %s deleted" % (full, n, base, (m.get("merge_commit_sha") or "?")[:8], pr["head"]["sha"][:8], head))
    mm = re.fullmatch(r"chunk/(\d+)-([a-z0-9]+)", head)
    if mm and os.path.isdir(os.path.join(WT, short(full), "%s-%s" % mm.groups())):
        print("folder %s/%s-%s stays; the janitor removes it" % (short(full), mm.group(1), mm.group(2)))


def cmd_job_open(a):
    if "--template" in a:
        print(ISSUE_TEMPLATE)
        return
    if len(a) < 1 or "--title" not in a or "--body-file" not in a:
        die("usage: job-open <repo> --title 'T' --body-file FILE   (template: job-open --template)")
    full = repo_full(a[0])
    body = open(a[a.index("--body-file") + 1]).read()
    miss = has_heads(body, ISSUE_HEADS)
    if miss:
        die("the work order lacks: %s. Template: job-open --template" % ", ".join(miss))
    r = run([GH, "issue", "create", "-R", full, "--title", a[a.index("--title") + 1], "--body-file", a[a.index("--body-file") + 1]])
    url = r.stdout.strip().splitlines()[-1]
    print("JOB %s\nStart every dispatch for it with: JOB %s#%s" % (url, short(full), url.rsplit("/", 1)[-1]))


def cmd_release_pr(a):
    if "--template" in a:
        print(REL_TEMPLATE)
        return
    if len(a) < 2 or "--title" not in a or "--body-file" not in a:
        die("usage: release-pr <repo> <head branch: dev or job/N> --title 'T' --body-file FILE   (template: release-pr --template)")
    full, head = repo_full(a[0]), a[1]
    if not (head == "dev" or head.startswith("job/")):
        die("head must be dev or a job branch")
    info = api("repos/%s" % full)
    body = open(a[a.index("--body-file") + 1]).read()
    miss = has_heads(body, REL_HEADS)
    if miss:
        die("the release note lacks: %s. Template: release-pr --template" % ", ".join(miss))
    merged = json.loads(run([GH, "pr", "list", "-R", full, "--base", head, "--state", "merged", "--limit", "50", "--json", "number,title,mergedAt"]).stdout or "[]")
    if head.startswith("job/"):
        body = "Closes #%s\n\n%s" % (head.split("/")[1], body)
    body += "\n## Chunks merged into `%s`\n" % head + ("\n".join("- #%d %s" % (p["number"], p["title"]) for p in merged[:30]) or "- (none found)") + "\n"
    tmp = os.path.join(STATE, "relbody-%d.md" % os.getpid())
    open(tmp, "w").write(body)
    r = run([GH, "pr", "create", "-R", full, "--base", info["default_branch"], "--head", head, "--title", a[a.index("--title") + 1], "--body-file", tmp])
    os.remove(tmp)
    print("RELEASE PR %s\ninto %s, merging is Rob's step. After Rob says \"merged\", @boss saves the EverOS release entry." % (r.stdout.strip().splitlines()[-1], info["default_branch"]))


def cmd_repo_check(a):
    if not a:
        die("usage: repo-check <repo>")
    full = repo_full(a[0])
    info = api("repos/%s" % full)
    if not info:
        die("repo not found or no access", 1)
    d = info["default_branch"]
    dev = api("repos/%s/branches/dev" % full) is not None
    print("REPO %s | default %s | dev branch: %s | private: %s" % (full, d, "yes" if dev else "no (use job/<issue>)", info["private"]))
    for f in ("AGENTS.md", "CLAUDE.md"):
        print("%s: %s" % (f, "yes" if api("repos/%s/contents/%s" % (full, f)) else "no"))
    wfs = api("repos/%s/contents/.github/workflows" % full) or []
    pr_wf = 0
    for w in wfs:
        r = run([GH, "api", "repos/%s/contents/.github/workflows/%s" % (full, w["name"]), "-H", "Accept: application/vnd.github.raw"], check=False).stdout
        head = r.split("\njobs:")[0]
        on_pr = bool(re.search(r"pull_request", head))
        tests = bool(re.search(r"\b(test|jest|vitest|pytest|cargo test|nextest|playwright)\b", r, re.I))
        pr_wf += 1 if (on_pr and tests) else 0
        bl = re.search(r"pull_request:\s*\n\s+branches:\s*(.+)", head)
        print("workflow %-28s on PRs: %-3s runs tests: %-3s %s" % (w["name"], "yes" if on_pr else "no", "yes" if tests else "no", ("PR base filter: " + bl.group(1)) if bl else ""))
    print("CI THAT RUNS TESTS ON PRs: %s" % ("YES" if pr_wf else "NO. Tell Rob before building here."))
    prs = api("repos/%s/pulls?state=all&per_page=1" % full) or []
    if prs:
        cs = checks(full, prs[0]["head"]["sha"])
        print("latest PR #%d (%s): CI %s\n%s" % (prs[0]["number"], prs[0]["state"], ci_state(cs), ci_table(cs)))
    rs = api("repos/%s/rulesets" % full) or []
    print("rulesets: %s" % (", ".join("%s (%s)" % (r["name"], r["enforcement"]) for r in rs) or "none"))


CMDS = {"packet": cmd_packet, "wt": cmd_wt, "pr-open": cmd_pr_open, "ci-wait": cmd_ci_wait, "risk": cmd_risk,
        "merge-dev": cmd_merge_dev, "job-open": cmd_job_open, "release-pr": cmd_release_pr, "repo-check": cmd_repo_check}

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    name = os.environ.get("FACTORY_CMD") or (sys.argv[1] if len(sys.argv) > 1 else "")
    args = sys.argv[1:] if os.environ.get("FACTORY_CMD") else sys.argv[2:]
    if name not in CMDS:
        die("commands: " + ", ".join(CMDS))
    os.makedirs(STATE, exist_ok=True)
    CMDS[name](args)
