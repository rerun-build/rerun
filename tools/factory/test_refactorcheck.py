import contextlib
import io
import os
import subprocess
import tempfile
import unittest

import cutshape
import refactorcheck

FORM = """**Worker**: coder

**Files** (allowed paths; nothing else)
- `a.py`

**Depends on**: none
"""


def parsed(extra):
    return cutshape.parse({"number": 1, "body": FORM + extra})


class RefactorTest(unittest.TestCase):
    def test_parse(self):
        self.assertTrue(parsed("**Refactor**: Yes\n")["refactor"])
        self.assertFalse(parsed("**Refactor**: no\n")["refactor"])
        self.assertFalse(parsed("")["refactor"])
        self.assertIn("refactor: expected yes or no", parsed("**Refactor**: maybe\n")["errors"])
        self.assertIn("refactor: more than one Refactor line", parsed("**Refactor**: yes\n**Refactor**: no\n")["errors"])

    def test_offenders(self):
        files = {"a" * 40: ["x/test_a.py"], "b" * 40: ["x/test_a.py"], "c" * 40: ["x/a.py"]}
        commits = [("a" * 40, "feat: a"), ("b" * 40, "refactor: b"), ("c" * 40, "Refactor c")]
        self.assertEqual(refactorcheck.offenders(commits, files.__getitem__), ["bbbbbbb x/test_a.py"])

    def test_main(self):
        with tempfile.TemporaryDirectory() as d:
            def git(*a):
                return subprocess.run(["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t", *a], check=True, capture_output=True, text=True).stdout.strip()

            def commit(path, msg):
                full = os.path.join(d, path)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "a") as f:
                    f.write("x\n")
                git("add", "-A")
                git("commit", "-m", msg)

            git("init", "-q")
            commit("a.py", "base")
            base = git("rev-parse", "HEAD")
            commit("tests/test_a.py", "feat: test")
            commit("a.py", "refactor: code")
            cwd = os.getcwd()
            os.chdir(d)
            try:
                self.assertEqual(refactorcheck.main(["--base", base]), 0)
                commit("tests/test_a.py", "refactor: bad")
                out = io.StringIO()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                    self.assertEqual(refactorcheck.main(["--base", base]), 1)
                self.assertIn("tests/test_a.py", out.getvalue())
            finally:
                os.chdir(cwd)


if __name__ == "__main__":
    unittest.main()
