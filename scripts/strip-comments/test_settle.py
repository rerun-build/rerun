import os
import subprocess
import tempfile
import unittest

import settle

BASE = "def total(xs):\n    # add them up\n    return sum(xs)\n\n\ndef top(xs):\n    return max(xs)\n"
OURS = "def total(xs):\n    return sum(xs)\n\n\ndef top(xs):\n    return max(xs)\n"
THEIRS = "def total(xs):\n    # add them up, skipping None\n    return sum(x for x in xs if x is not None)\n\n\ndef top(xs):\n    return max(xs)\n"


def run(root, *args):
    subprocess.run(["git", "-C", root] + list(args), check=True, capture_output=True)


class Settle(unittest.TestCase):
    def repo(self, ours, theirs):
        root = tempfile.mkdtemp(prefix="settle-test-")
        run(root, "init", "-q", "-b", "main")
        run(root, "config", "user.email", "t@example.com")
        run(root, "config", "user.name", "t")
        path = os.path.join(root, "calc.py")

        def commit(text, msg):
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            run(root, "add", "calc.py")
            run(root, "commit", "-q", "-m", msg)

        commit(BASE, "base")
        run(root, "checkout", "-q", "-b", "theirs")
        commit(theirs, "theirs")
        run(root, "checkout", "-q", "main")
        commit(ours, "ours")
        subprocess.run(["git", "-C", root, "merge", "-q", "theirs"], capture_output=True)
        return root, path

    def test_a_conflict_that_comes_only_from_removed_comments_is_settled_without_comments(self):
        root, path = self.repo(OURS, THEIRS)
        self.assertEqual(settle.conflicted(root), ["calc.py"])
        done, left = settle.settle(root)
        self.assertEqual((done, left), (["calc.py"], []))
        with open(path, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("if x is not None", text)
        self.assertNotIn("#", text)
        self.assertEqual(settle.conflicted(root), [])

    def test_a_real_clash_of_code_is_left_for_a_person(self):
        root, path = self.repo(OURS.replace("sum(xs)", "sum(xs) or 0"), THEIRS)
        done, left = settle.settle(root)
        self.assertEqual((done, left), ([], ["calc.py"]))
        self.assertEqual(settle.conflicted(root), ["calc.py"])

    def test_dry_run_changes_nothing(self):
        root, path = self.repo(OURS, THEIRS)
        done, _ = settle.settle(root, dry=True)
        self.assertEqual(done, ["calc.py"])
        self.assertEqual(settle.conflicted(root), ["calc.py"])


if __name__ == "__main__":
    unittest.main()
