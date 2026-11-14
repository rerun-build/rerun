import subprocess

MAX_LINES = 80


def _git(cwd, args, stdin):
    return subprocess.run(["git", *args], cwd=cwd, input=stdin, capture_output=True, text=True)


def apply(workdir, patch, allowed, max_lines=MAX_LINES):
    stat = _git(workdir, ["apply", "--numstat"], patch)
    if stat.returncode:
        return "failed"
    rows = [r.split("\t") for r in stat.stdout.splitlines()]
    if any(r[2] not in allowed for r in rows) or sum(int(r[0]) + int(r[1]) for r in rows if r[0] != "-") > max_lines:
        return "oversized"
    return "applied" if _git(workdir, ["apply"], patch).returncode == 0 else "failed"
