import os, shutil, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F
import mirror as M
import refresh

FULL = "special-place-ai-heaven/moldwright"


def prefix():
    return os.environ.get("FACTORY_TOOLS_PREFIX", "/data/tools")


def current(pre):
    name = os.readlink(os.path.join(pre, "factory-current")) if os.path.islink(os.path.join(pre, "factory-current")) else ""
    return name[len("factory-"):] if name.startswith("factory-") else None


def skip_path():
    return os.path.join(F.STATE, "tools-skip")


def read(p):
    try:
        with open(p) as f:
            return f.read().strip() or None
    except OSError:
        return None


def gh_cli(args):
    r = F.run([F.GH] + args, check=False, timeout=60)
    if r.returncode:
        raise RuntimeError("gh %s: %s" % (" ".join(args[:2]), (r.stderr or r.stdout).strip()[-200:]))
    return r.stdout


def main(argv, gh=gh_cli):
    pre = prefix()
    key = os.environ.get("FACTORY_JEV_KEYFILE") or os.path.join(pre, "jev.env")
    cur = current(pre)
    try:
        sha = refresh.target(gh, FULL, cur, read(skip_path()))
    except Exception as e:
        print("TRANSIENT: cannot read the green tools commit of dev: %s" % str(e)[:200])
        return 3
    if not sha:
        print("TOOLS current at %s" % (cur or "none")[:8])
        return 0
    m = M.path(F.short(FULL))
    if not os.path.isdir(m) or M.git(["cat-file", "-e", sha + "^{commit}"], cwd=m).returncode:
        print("TRANSIENT: the mirror lacks %s; the next `mirror refresh` brings it" % sha[:8])
        return 3
    tmp = tempfile.mkdtemp(prefix="tools-%s-" % sha[:8])
    try:
        arc = subprocess.Popen([F.GIT, "archive", sha, "tools/factory"], cwd=m, stdout=subprocess.PIPE)
        tar = subprocess.run(["tar", "-x", "-C", tmp], stdin=arc.stdout, capture_output=True)
        arc.stdout.close()
        if arc.wait() or tar.returncode:
            print("TRANSIENT: could not export %s from the mirror" % sha[:8])
            return 3
        r = subprocess.run(["sh", os.path.join(tmp, "tools", "factory", "install.sh"), "--prefix", pre, "--jev-keyfile", key, "--version", sha],
                           capture_output=True, text=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out = ((r.stdout or "") + (r.stderr or "")).replace(key, "<keyfile>").strip()
    if r.returncode == 3:
        print("TRANSIENT: %s not installed now: %s" % (sha[:8], out[-300:]))
        return 3
    if r.returncode:
        M.write(skip_path(), sha)
        print("INSTALL FAILED for %s; still on %s and %s is skipped until a newer green commit: %s" % (sha[:8], (cur or "none")[:8], sha[:8], out[-300:]))
        return 2
    print("TOOLS installed %s (was %s)" % (sha[:8], (cur or "none")[:8]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
