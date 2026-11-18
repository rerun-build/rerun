import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutshape
import plancheck

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def tracked(root=ROOT):
    out = subprocess.run(["git", "-C", root, "ls-files"], capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return {line for line in out.splitlines() if line}


def faults(body, tree, number=0):
    issue = {"number": number, "body": body}
    found = list(cutshape.parse(issue)["errors"])
    found += [f for f in plancheck.faults(issue, tree, own_tests=True) if f not in found]
    return found


def main(argv):
    if len(argv) != 2:
        print("usage: python3 -I tools/factory/issuecheck.py <file with the issue body>")
        return 2
    with open(argv[1], encoding="utf-8") as f:
        body = f.read()
    found = faults(body, tracked())
    for fault in found:
        print("FAULT " + fault)
    print("OK" if not found else "%d fault%s: fix them before you save the issue" % (len(found), "" if len(found) == 1 else "s"))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
