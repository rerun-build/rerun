import contextlib, fcntl, json, os, shutil, sys, time

import factory as F
import mirror as M

CEILING = 40
FETCH_TRIES, BACKOFF_S = 3, 2
READY, CREATED = "factory-ready", "factory-created"


def step(name):
    return name


def transient(msg):
    print("TRANSIENT: " + msg)
    sys.exit(3)


def jobs_dir():
    return os.path.join(F.STATE, "jobs")


def tmp_root():
    return os.path.join(F.WORK, "tmp")


def job_name(repo, issue, chunk):
    return "%s-%s-%s" % (repo, issue, chunk)


def owner_path(name):
    return os.path.join(jobs_dir(), name + ".owner")


def read_owner(name):
    try:
        with open(owner_path(name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def try_lease(repo, d):
    os.makedirs(jobs_dir(), exist_ok=True)
    lk = open(os.path.join(jobs_dir(), "%s-%s.lock" % (repo, d)), "a")
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lk.close()
        return None
    return lk


@contextlib.contextmanager
def lease(repo, issue, chunk):
    name = job_name(repo, issue, chunk)
    os.makedirs(jobs_dir(), exist_ok=True)
    lk = open(os.path.join(jobs_dir(), name + ".lock"), "a")
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lk.close()
        o = read_owner(name)
        transient("job %s is owned by run %s since %s; nothing changed" % (name, o.get("run", "unknown"), o.get("since", "unknown")))
    M.HELD.append(lk.fileno())
    try:
        M.write(owner_path(name), json.dumps({"run": os.environ.get("FACTORY_RUN") or "unknown", "pid": os.getpid(),
                                              "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
        yield
    finally:
        M.HELD.remove(lk.fileno())
        lk.close()


def must(r, what):
    if r.returncode:
        raise RuntimeError("%s: %s" % (what, (r.stderr or r.stdout or "").strip()[-400:]))
    return r.stdout.strip()


def heads(cwd, remote):
    r = M.git(["ls-remote", "--heads", remote], cwd=cwd, timeout=60)
    if r.returncode:
        return None
    return {l.split("\t")[1][len("refs/heads/"):] for l in r.stdout.splitlines() if "\t" in l}


def fetch_base(path, base):
    for i in range(FETCH_TRIES):
        r = M.git(["fetch", "--quiet", "origin", "+refs/heads/%s:refs/remotes/origin/%s" % (base, base)], cwd=path)
        if r.returncode == 0:
            return True
        time.sleep(BACKOFF_S * (i + 1))
    return False


def identity(path):
    if all(M.git(["config", k], cwd=path).stdout.strip() for k in ("user.name", "user.email")):
        return
    who = F.api("user")
    login = who.get("login") if isinstance(who, dict) else None
    if not login:
        transient("cannot read the account of the token on GitHub, so %s has no name to commit under" % path)
    must(M.git(["config", "user.name", login], cwd=path), "git config user.name")
    must(M.git(["config", "user.email", "%s@users.noreply.github.com" % login], cwd=path), "git config user.email")


def prepare(path, branch, base):
    must(M.git(["config", "branch.%s.factorybase" % branch, base], cwd=path), "git config")
    identity(path)
    ex = os.path.join(path, ".git", "info", "exclude")
    os.makedirs(os.path.dirname(ex), exist_ok=True)
    seen = False
    if os.path.isfile(ex):
        with open(ex) as f:
            seen = ".symforge" in f.read()
    if not seen:
        with open(ex, "a") as f:
            f.write("\n.symforge/\n.symforge-knowledge.toml\n")
    stamp = os.path.join(path, ".git", CREATED)
    if not os.path.exists(stamp):
        M.write(stamp, str(int(time.time())))


def make(full, repo, d, branch, base, default, start=None):
    tmp = os.path.join(tmp_root(), "%s-%s" % (repo, d))
    os.makedirs(tmp_root(), exist_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    m = M.path(repo)
    src = m if mode() == "clone" and os.path.isdir(m) and M.git(["for-each-ref", "--count=1", "refs/heads"], cwd=m).stdout.strip() else M.url(full)
    r = M.git(["clone", "--quiet", "--no-checkout", src, tmp], timeout=900)
    if r.returncode and src == m:
        shutil.rmtree(tmp, ignore_errors=True)
        src = M.url(full)
        r = M.git(["clone", "--quiet", "--no-checkout", src, tmp], timeout=900)
    if r.returncode:
        transient("cannot clone %s: %s" % (full, (r.stderr or "").strip()[-300:]))
    step("cloned")
    must(M.git(["remote", "set-url", "origin", M.url(full)], cwd=tmp), "git remote set-url")
    step("origin")
    have = heads(tmp, "origin")
    base = base or ("dev" if have is None or "dev" in have else "job/" + d.split("-")[0])
    if have is not None and base not in have:
        if base != "job/" + d.split("-")[0]:
            F.die("base branch %s does not exist on origin" % base)
        if fetch_base(tmp, default):
            must(M.git(["push", "--quiet", "origin", "refs/remotes/origin/%s:refs/heads/%s" % (default, base)], cwd=tmp), "git push job branch")
            print("created job branch %s from %s" % (base, default))
    if not fetch_base(tmp, base):
        if src != m:
            transient("cannot fetch %s from GitHub after %d tries" % (base, FETCH_TRIES))
        r = M.git(["rev-parse", "--verify", "refs/remotes/origin/" + base], cwd=tmp)
        if r.returncode:
            transient("cannot fetch %s from GitHub after %d tries and the mirror lacks it" % (base, FETCH_TRIES))
        sha = r.stdout.strip()
        print("base from the mirror at %s: the GitHub fetch failed %d times" % (sha[:8], FETCH_TRIES))
    if start and not fetch_base(tmp, start):
        transient("cannot fetch %s from GitHub after %d tries" % (start, FETCH_TRIES))
    step("fetched")
    must(M.git(["checkout", "--quiet", "-b", branch, "origin/" + (start or base)], cwd=tmp), "git checkout")
    step("branched")
    prepare(tmp, branch, base)
    return tmp, base


def new(full, issue, chunk, base, owner, default, start=None):
    repo, d = F.short(full), "%s-%s" % (issue, chunk)
    final, branch = os.path.join(F.WT, repo, d), "chunk/%s-%s" % (issue, chunk)
    if not os.path.isdir(final) and len(F.wt_dirs()) >= CEILING:
        F.die("the ceiling of %d job folders under %s is reached. Nothing made; tell @boss." % (CEILING, F.WT))
    with lease(repo, issue, chunk):
        if os.path.isdir(final) and not F.is_clone(final):
            print("EXISTS %s (an old worktree, branch %s). Work there." % (final, branch))
            return
        if not os.path.isdir(final):
            tmp, base = make(full, repo, d, branch, base, default, start)
            os.makedirs(os.path.dirname(final), exist_ok=True)
            os.rename(tmp, final)
            step("renamed")
        else:
            must(M.git(["remote", "set-url", "origin", M.url(full)], cwd=final), "git remote set-url")
            base = M.git(["config", "branch.%s.factorybase" % branch], cwd=final).stdout.strip() or base or "dev"
            if os.path.exists(os.path.join(final, ".git", READY)):
                print("EXISTS %s (branch %s). Work there." % (final, branch))
                return
            if M.git(["rev-parse", "--verify", "--quiet", "refs/heads/" + branch], cwd=final).returncode:
                must(M.git(["checkout", "--quiet", "-b", branch, "origin/" + base], cwd=final), "git checkout")
            prepare(final, branch, base)
        M.write(F.reg_path(repo, d), json.dumps({"repo": full, "issue": issue, "chunk": chunk, "branch": branch, "base": base,
                                                 "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "owner": owner,
                                                 "run": os.environ.get("FACTORY_RUN") or "unknown", "checkout": "clone"}))
        step("installing")
        err = F.install_deps(final, M.run)
        if err:
            transient("dependencies not installed in %s (%s); run the same `wt new` again" % (final, err[:200]))
        step("installed")
        url = M.git(["remote", "get-url", "origin"], cwd=final).stdout.strip()
        if url != M.url(full):
            raise RuntimeError("origin of %s is %s, not %s" % (final, url, M.url(full)))
        M.write(os.path.join(final, ".git", READY), str(int(time.time())))
        step("ready")
    notes = [f for f in ("AGENTS.md", "CLAUDE.md") if os.path.isfile(os.path.join(final, f))]
    print("WORKTREE %s\nbranch %s (from origin/%s, fresh)\nrepo %s | job issue #%s | chunk %s | checkout clone" % (final, branch, base, full, issue, chunk))
    print("build and test notes: %s" % (", ".join(notes) or "none in repo"))
    print("Next: edit here, quick checks only (lint, type check, named test files), commit, then `pr-open`.")


MODES = ("worktree", "clone")
WATCH_JOBS, FAULTS_BACK = 5, 3


def mode_path():
    return os.path.join(F.STATE, "checkout.json")


def events_path():
    return os.path.join(F.STATE, "checkout-events.log")


def mode_record():
    try:
        with open(mode_path()) as f:
            rec = json.load(f)
        return rec if rec.get("checkout") in MODES else {"checkout": "worktree"}
    except (OSError, ValueError, AttributeError):
        return {"checkout": "worktree"}


def mode():
    return mode_record()["checkout"]


def set_mode(value, why, watch=0):
    os.makedirs(F.STATE, exist_ok=True)
    M.write(mode_path(), json.dumps({"checkout": value, "why": why, "watch_from": events_count() if watch else None, "watch": watch,
                                     "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))


def events():
    try:
        with open(events_path()) as f:
            return [l.split() for l in f if l.strip()]
    except OSError:
        return []


def events_count():
    return len(events())


def record(kind, job):
    os.makedirs(F.STATE, exist_ok=True)
    fd = os.open(events_path(), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, ("%s %s %d\n" % (kind, job, time.time())).encode())
    finally:
        os.close(fd)
    rec = mode_record()
    if rec["checkout"] != "clone" or kind != "fault":
        return None
    seen = events()
    start = rec.get("watch_from")
    watched = seen[start:start + rec.get("watch", 0)] if isinstance(start, int) else []
    if any(e[0] == "fault" for e in watched):
        set_mode("worktree", "a tool fault in %s during the watch of the first %d clone jobs" % (job, rec.get("watch", 0)))
        return "SWITCHED BACK to checkout worktree: a tool fault during the watch of the first %d clone jobs" % rec.get("watch", 0)
    tail = [e[0] for e in seen[-FAULTS_BACK:]]
    if len(tail) == FAULTS_BACK and all(k == "fault" for k in tail):
        set_mode("worktree", "%d tool faults in a row, the last in %s" % (FAULTS_BACK, job))
        return "SWITCHED BACK to checkout worktree: %d tool faults in a row" % FAULTS_BACK
    return None


def canary_path():
    return os.path.join(F.STATE, "canary.json")


def cmd_mode(a):
    if len(a) == 1:
        rec = mode_record()
        print("checkout %s%s" % (rec["checkout"], " (%s)" % rec["why"] if rec.get("why") else ""))
        return
    want = a[1]
    if want not in MODES:
        F.die("usage: wt mode [worktree | clone --canary <issue or PR url read by the operator>]")
    if want == "clone":
        if "--canary" not in a or a.index("--canary") + 1 >= len(a):
            F.die("checkout clone needs the canary record: `wt mode clone --canary <url>` after the canary of CANARY.md passed")
        M.write(canary_path(), json.dumps({"record": a[a.index("--canary") + 1], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
        set_mode("clone", "canary " + a[a.index("--canary") + 1], watch=WATCH_JOBS)
    else:
        set_mode("worktree", "set by hand")
    print("checkout %s" % want)
