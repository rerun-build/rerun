import fcntl, json, os, re, shutil, signal, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F

GITHUB = os.environ.get("FACTORY_GITHUB_URL", "https://github.com/")
HOOK = "#!/bin/sh\necho 'REFUSED: this is the factory mirror, a read-only cache. Push to GitHub.' >&2\nexit 1\n"
GIT_LOCKS = ("packed-refs.lock", "config.lock", "HEAD.lock", "shallow.lock", "index.lock")
RETRIES, BACKOFF_S = 3, 2
GRACE_S = 10
STOPS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
HELD = []


def url(full):
    if re.match(r"[^/]*//[^/]*@", GITHUB):
        F.die("FACTORY_GITHUB_URL carries a credential; git takes it from its credential helper, never from a URL. Nothing done.")
    return GITHUB + full + ".git"


def root():
    return os.path.join(F.STATE, "mirrors")


def path(repo):
    return os.path.join(root(), repo + ".git")


def git(args, cwd="/tmp", timeout=300):
    return run([F.GIT] + args, cwd, timeout)


def tell(p, sig):
    try:
        os.killpg(p.pid, sig)
    except ProcessLookupError:
        pass


def end(p):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        tell(p, sig)
        try:
            return p.communicate(timeout=GRACE_S)
        except subprocess.TimeoutExpired:
            continue
    for f in (p.stdout, p.stderr):
        f.close()
    if p.poll() is None:
        p.returncode = -signal.SIGKILL
    return "", "the command and its children did not end %d s after SIGKILL" % GRACE_S


def run(cmd, cwd="/tmp", timeout=300):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, pass_fds=tuple(HELD), start_new_session=True)
    old = {s: signal.getsignal(s) for s in STOPS}

    def restore():
        for s, h in old.items():
            signal.signal(s, h if h is not None else signal.SIG_DFL)

    def on_stop(signum, _):
        tell(p, signal.SIGTERM)
        try:
            p.wait(60)
        except subprocess.TimeoutExpired:
            tell(p, signal.SIGKILL)
            p.wait()
        restore()
        sys.exit(128 + signum)
    for s in STOPS:
        signal.signal(s, on_stop)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        out, err = end(p)
    finally:
        restore()
    return subprocess.CompletedProcess(p.args, p.returncode, out, err)


def write(p, text):
    tmp = "%s.%d.tmp" % (p, os.getpid())
    with open(tmp, "w") as f:
        f.write(text)
    os.replace(tmp, p)


def clear_git_locks(m):
    gone = []
    for d, _, fs in os.walk(m):
        if os.path.basename(d) == "hooks":
            continue
        for f in fs:
            if f.endswith(".lock") and (f in GIT_LOCKS or os.path.relpath(d, m).split(os.sep)[0] == "refs"):
                os.remove(os.path.join(d, f))
                gone.append(os.path.relpath(os.path.join(d, f), m))
    return gone


def setup(m):
    git(["config", "gc.auto", "0"], cwd=m)
    git(["config", "receive.denyCurrentBranch", "refuse"], cwd=m)
    hook = os.path.join(m, "hooks", "pre-receive")
    os.makedirs(os.path.dirname(hook), exist_ok=True)
    with open(hook + ".tmp", "w") as f:
        f.write(HOOK)
    os.chmod(hook + ".tmp", 0o755)
    os.replace(hook + ".tmp", hook)


def refresh(full):
    repo = F.short(full)
    os.makedirs(root(), exist_ok=True)
    lk = open(os.path.join(root(), repo + ".lock"), "a")
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lk.close()
        print("MIRROR %s: another refresh is running, nothing to do" % repo)
        return 0
    HELD.append(lk.fileno())
    try:
        m = path(repo)
        if not os.path.isdir(m):
            tmp = m + ".tmp"
            shutil.rmtree(tmp, ignore_errors=True)
            r = git(["clone", "--quiet", "--mirror", url(full), tmp], timeout=900)
            if r.returncode:
                print("TRANSIENT: mirror %s could not be cloned: %s" % (repo, (r.stderr or "").strip()[-300:]))
                return 3
            setup(tmp)
            os.rename(tmp, m)
        for f in clear_git_locks(m):
            print("MIRROR %s: removed stale git lock %s" % (repo, f))
        setup(m)
        for i in range(RETRIES):
            r = git(["fetch", "--quiet", "--prune", "origin"], cwd=m)
            if r.returncode == 0:
                break
            time.sleep(BACKOFF_S * (i + 1))
        else:
            print("TRANSIENT: mirror %s fetch failed %d times: %s" % (repo, RETRIES, (r.stderr or "").strip()[-300:]))
            return 3
        try:
            F.ensure_clone(full)
            print("MIRROR %s: shared checkout %s follows its base" % (repo, os.path.join(F.REPOS, repo)))
        except SystemExit:
            print("TRANSIENT: mirror %s refreshed, but its shared checkout could not be refreshed" % repo)
            return 3
        dev = git(["rev-parse", "--verify", "--quiet", "refs/heads/dev"], cwd=m).stdout.strip()
        write(os.path.join(root(), repo + ".ok"), json.dumps({"at": int(time.time()), "dev": dev}))
        print("MIRROR %s refreshed, dev %s" % (repo, dev[:8] or "none"))
        return 0
    finally:
        HELD.remove(lk.fileno())
        lk.close()


def fresh(full, branch="dev"):
    m = path(F.short(full))
    if not os.path.isdir(m):
        return "MISSING", "", ""
    have = git(["rev-parse", "--verify", "--quiet", "refs/heads/" + branch], cwd=m).stdout.strip()
    r = git(["ls-remote", url(full), "refs/heads/" + branch], timeout=60)
    if r.returncode:
        return "UNREACHABLE", have, ""
    want = (r.stdout.split() or [""])[0]
    return ("FRESH" if have == want else "BEHIND"), have, want


def check(full):
    state, have, want = fresh(full)
    repo = F.short(full)
    if state == "FRESH":
        print("MIRROR %s fresh at %s" % (repo, have[:8]))
        return 0
    if state == "BEHIND":
        print("MIRROR BEHIND %s: mirror %s, GitHub %s" % (repo, have[:8] or "none", want[:8]))
    elif state == "MISSING":
        print("MIRROR MISSING %s: run `mirror refresh %s`" % (repo, repo))
    else:
        print("TRANSIENT: cannot reach GitHub to check the mirror of %s" % repo)
    return 3


def main(argv):
    if len(argv) != 2 or argv[0] not in ("refresh", "check"):
        print("usage: mirror refresh <repo> | mirror check <repo>")
        return 2
    full = F.repo_full(argv[1])
    return refresh(full) if argv[0] == "refresh" else check(full)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
