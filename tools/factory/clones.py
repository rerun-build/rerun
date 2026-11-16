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
    try:
        M.write(owner_path(name), json.dumps({"run": os.environ.get("FACTORY_RUN") or "unknown", "pid": os.getpid(),
                                              "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
        yield
    finally:
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


def prepare(path, branch, base):
    must(M.git(["config", "branch.%s.factorybase" % branch, base], cwd=path), "git config")
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
    tmp = os.path.join(tmp_root(), "%s-%s-%d" % (repo, d, os.getpid()))
    os.makedirs(tmp_root(), exist_ok=True)
    m = M.path(repo)
    src = m if os.path.isdir(m) and M.git(["for-each-ref", "--count=1", "refs/heads"], cwd=m).stdout.strip() else M.url(full)
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
        sha = must(M.git(["rev-parse", "--verify", "refs/remotes/origin/" + base], cwd=tmp), "base in the mirror")
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
        err = F.install_deps(final)
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
