import argparse
import contextlib
import io
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import strip

STAGES = (("base", 1), ("ours", 2), ("theirs", 3))


def git(root, *args):
    return subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)


def conflicted(root):
    return [p for p in git(root, "diff", "--name-only", "--diff-filter=U").stdout.splitlines() if p]


def stage(root, n, path):
    r = subprocess.run(["git", "-C", root, "show", ":%d:%s" % (n, path)], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def stripped_copies(root, paths, ts_module):
    work = tempfile.mkdtemp(prefix="settle-")
    kept = []
    for path in paths:
        blobs = {name: stage(root, n, path) for name, n in STAGES}
        if None in blobs.values() or not strip.kind(path):
            continue
        for name, blob in blobs.items():
            target = os.path.join(work, name, path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(blob)
        kept.append(path)
    if kept:
        git(work, "init", "-q")
        git(work, "add", "-A")
        args = ["--root", work, "--write"] + (["--ts-module", ts_module] if ts_module else [])
        with contextlib.redirect_stdout(io.StringIO()):
            strip.main(args)
    return work, kept


def settle(root, ts_module=None, dry=False):
    paths = conflicted(root)
    work, candidates = stripped_copies(root, paths, ts_module)
    settled, left = [], [p for p in paths if p not in candidates]
    for path in candidates:
        ours, base, theirs = (os.path.join(work, name, path) for name in ("ours", "base", "theirs"))
        merged = subprocess.run(["git", "merge-file", "-p", ours, base, theirs], capture_output=True, cwd=work)
        if merged.returncode != 0:
            left.append(path)
            continue
        settled.append(path)
        if dry:
            continue
        with open(os.path.join(root, path), "wb") as f:
            f.write(merged.stdout)
        git(root, "add", "--", path)
    return settled, sorted(left)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Settle merge conflicts that only come from removed comments.")
    ap.add_argument("--root", default=".")
    ap.add_argument("--ts-module")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args(argv)
    settled, left = settle(os.path.abspath(a.root), a.ts_module, a.dry)
    for path in settled:
        print("SETTLED " + path)
    for path in left:
        print("LEFT " + path)
    print("%d settled, %d left for a person" % (len(settled), len(left)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
