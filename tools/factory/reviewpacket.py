import subprocess


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def review_diff(repo, base, head, rejected=None):
    if rejected and _git(repo, "merge-base", "--is-ancestor", rejected, head).returncode == 0:
        start = rejected
    else:
        start = base
    r = _git(repo, "diff", start + ".." + head)
    if r.returncode:
        raise RuntimeError("git diff failed: " + r.stderr.strip())
    return r.stdout
