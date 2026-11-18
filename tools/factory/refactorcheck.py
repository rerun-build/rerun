import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gate import TESTF

_REFACTOR = re.compile(r"^refactor\b", re.I)


def offenders(commits, files_of):
    found = []
    for sha, subject in commits:
        if not _REFACTOR.search(subject):
            continue
        for path in files_of(sha):
            if re.search(TESTF, path):
                found.append("%s %s" % (sha[:7], path))
    return found


def _git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    args = ap.parse_args(argv)
    commits = [tuple(line.split("\t", 1)) for line in _git("log", "--format=%H%x09%s", args.base + "..HEAD").splitlines() if "\t" in line]
    bad = offenders(commits, lambda sha: _git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines())
    for line in bad:
        print(line)
    if bad:
        print("refactor commits change test files: " + ", ".join(bad))
        return 1
    print("no refactor commit changes a test file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
