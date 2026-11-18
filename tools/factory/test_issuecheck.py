import contextlib
import io
import os
import tempfile
import unittest
from unittest import mock

import issuecheck
from test_cutshape_run_faults import body


class IssueCheck(unittest.TestCase):
    tree = {"tools/factory/x.py", "tools/factory/test_x.py"}

    def test_a_clean_body_has_no_faults(self):
        self.assertEqual(issuecheck.faults(body("cd tools/factory && python3 -I -m unittest test_x"), self.tree), [])

    def test_a_format_fault_is_named(self):
        found = issuecheck.faults(body("python3 -m pytest tools/factory/test_x.py"), self.tree)
        self.assertEqual(len(found), 1)
        self.assertIn("no pytest", found[0])

    def test_main_prints_ok_or_the_faults_and_sets_the_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "body.md")
            for run, code, last in (("true", 0, "OK"), ("python3 -m pytest x", 1, "1 fault: fix them before you save the issue")):
                with open(path, "w", encoding="utf-8") as f:
                    f.write(body(run))
                out = io.StringIO()
                with mock.patch.object(issuecheck, "tracked", return_value=self.tree), contextlib.redirect_stdout(out):
                    self.assertEqual(issuecheck.main(["issuecheck.py", path]), code)
                self.assertEqual(out.getvalue().strip().splitlines()[-1], last)

    def test_usage(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(issuecheck.main(["issuecheck.py"]), 2)


if __name__ == "__main__":
    unittest.main()
