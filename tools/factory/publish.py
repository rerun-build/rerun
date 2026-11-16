import os
import subprocess


def _git(cwd, *a):
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def _outside(worktree, paths):
    ok = tuple(p.rstrip("/") for p in paths)
    changed = [l.split(None, 1)[1] for l in _git(worktree, "status", "--porcelain", "--no-renames", "-uall").splitlines()]
    return [c for c in changed if not any(c == p or c.startswith(p + "/") for p in ok)]


def body(job_ref, receipts):
    ids = sorted(receipts)
    lines = ["Job: %s, chunk %s" % (job_ref, ", ".join(ids))]
    for c in ids:
        r = receipts[c]
        lines.append("Receipt %s: done-test %s (base exit %s, head exit %s)" % (c, r.get("verdict"), r.get("base"), r.get("head")))
    return "\n".join(lines)


def publish(worktree, issue, title, base, open_pr, paths, remote="origin", body=""):
    head = "factory/job-%s" % issue
    extra = _outside(worktree, paths)
    if extra:
        raise ValueError("files outside the chunk paths: %s" % ", ".join(extra))
    missing, stage = [], []
    for p in paths:
        if os.path.exists(os.path.join(worktree, p)) or _git(worktree, "ls-files", "--", p):
            stage.append(p)
        elif subprocess.run(["git", "cat-file", "-e", "HEAD:%s" % p], cwd=worktree, capture_output=True).returncode != 0:
            missing.append(p)
    if missing:
        raise ValueError("declared paths never created: %s" % ", ".join(missing))
    _git(worktree, "checkout", "-q", "-B", head)
    if stage:
        _git(worktree, "add", "--", *stage)
    if _git(worktree, "diff", "--cached", "--name-only"):
        _git(worktree, "commit", "-qm", title)
    _git(worktree, "push", "-q", remote, "%s:refs/heads/%s" % (head, head))
    open_pr(title, head, base, body)
    return _git(worktree, "rev-parse", "HEAD")
