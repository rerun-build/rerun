import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gate import TESTF

LINE_TIMEOUT_S = 900


def issue_number(ref, body):
    m = re.fullmatch(r"chunk/(\d+)-[\w.-]+", ref or "")
    if m:
        return int(m.group(1))
    m = re.search(r"(?i)\b(?:closes|fixes|resolves) #(\d+)", body or "")
    return int(m.group(1)) if m else None


def run_lines(body):
    m = re.search(r"(?ms)^\*\*Run\*\*.*?```[a-z]*\n(.*?)```", (body or "").replace("\r\n", "\n"))
    return [line.strip() for line in m.group(1).strip().split("\n") if line.strip()] if m else []


def exempt(body):
    m = re.search(r"(?mi)^\*\*Red before green\*\*:\s*not applicable\b(.*)$", (body or "").replace("\r\n", "\n"))
    if not m:
        return None
    return m.group(1).strip(" :.-") or "no reason given"


def git(root, *args):
    return subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True, encoding="utf-8", check=True).stdout


def split_changes(name_status):
    restore, remove = [], []
    for line in name_status.splitlines():
        if not line.strip():
            continue
        status, path = line.split("\t", 1)
        if re.search(TESTF, path):
            continue
        (remove if status.startswith("A") else restore).append(path)
    return restore, remove


def run(lines, root):
    script = "set -e\n" + "\n".join("(%s)" % line for line in lines) + "\n"
    try:
        p = subprocess.run(["bash", "-c", script], cwd=root, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=LINE_TIMEOUT_S * max(1, len(lines)))
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    return p.returncode, (p.stdout + p.stderr)[-3000:]


def prove(root, base, lines, runner=run, prepare=()):
    lines = list(prepare) + list(lines)
    code, tail = runner(lines, root)
    if code:
        return False, "the Run lines fail at the head (exit %d)" % code, tail
    restore, remove = split_changes(git(root, "diff", "--name-status", "--no-renames", base, "HEAD"))
    if not restore and not remove:
        return False, "the pull request changes only test files, so there is no change for the done-test to catch", ""
    try:
        if restore:
            git(root, "checkout", base, "--", *restore)
        for path in remove:
            os.remove(os.path.join(root, path))
        code, tail = runner(lines, root)
    finally:
        git(root, "checkout", "HEAD", "--", ".")
    if code == 0:
        return False, ("the Run lines pass on dev's code too (base %s with only this pull request's test files on top): "
                       "the done-test does not test the change. Make it fail without the change and pass with it." % base[:8]), tail
    return True, "red on dev's code (exit %d at base %s), green at the head" % (code, base[:8]), tail


def fetch_issue(repo, n, token):
    req = urllib.request.Request("https://api.github.com/repos/%s/issues/%d" % (repo, n),
                                 headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8")).get("body") or ""


def report(text):
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--base")
    ap.add_argument("--issue", type=int)
    ap.add_argument("--issue-body-file")
    ap.add_argument("--prepare", action="append", default=[])
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    n = a.issue or issue_number(os.environ.get("HEAD_REF"), os.environ.get("PR_BODY"))
    if not n:
        report("Red before green: no factory issue for this pull request, nothing to prove.")
        return 0
    if a.issue_body_file:
        with open(a.issue_body_file, encoding="utf-8") as f:
            body = f.read()
    else:
        body = fetch_issue(os.environ["GITHUB_REPOSITORY"], n, os.environ["GH_TOKEN"])
    why = exempt(body)
    if why:
        report("Red before green for #%d: not applicable (%s)." % (n, why))
        return 0
    lines = run_lines(body)
    if not lines:
        report("Red before green for #%d: the issue has no Run lines, nothing to prove." % n)
        return 0
    base = a.base or git(root, "rev-parse", "HEAD^1").strip()
    ok, why, tail = prove(root, base, lines, prepare=a.prepare)
    report("Red before green for #%d: %s." % (n, why))
    if tail and not ok:
        report("```\n%s\n```" % tail)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
