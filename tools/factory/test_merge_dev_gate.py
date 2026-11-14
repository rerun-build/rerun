import contextlib, io, os, subprocess, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F

PR = {"base": {"ref": "dev"}, "head": {"ref": "chunk/7-1", "sha": "a" * 40}, "state": "open", "draft": False, "merge_commit_sha": "0" * 40}


class MergeDevGate(unittest.TestCase):
    def merge(self, gate_code):
        calls = []

        def fake_api(path, *a, **k):
            return [] if path.endswith("/files?per_page=100") else {"default_branch": "main"} if path.count("/") == 2 else PR

        def fake_run(cmd, *a, **k):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, gate_code if cmd[1].endswith("gate.py") else 0, "GATE", "")

        green = [{"name": "ci", "status": "completed", "conclusion": "success", "id": 1, "url": ""}]
        out = io.StringIO()
        with mock.patch.object(F, "api", fake_api), mock.patch.object(F, "run", fake_run), mock.patch.object(F, "checks", lambda *a: green), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                F.cmd_merge_dev(["rerun", "9"])
                code = 0
            except SystemExit as e:
                code = e.code
        return code, calls

    def test_refused_without_pass_at_head(self):
        code, calls = self.merge(1)
        self.assertNotEqual(code, 0)
        self.assertFalse(any(c[1:3] == ["pr", "merge"] for c in calls))
        self.assertTrue(any(c[1].endswith("gate.py") for c in calls))

    def test_merges_when_gate_passes(self):
        code, calls = self.merge(0)
        self.assertEqual(code, 0)
        self.assertTrue(any(c[1:3] == ["pr", "merge"] for c in calls))


if __name__ == "__main__":
    unittest.main()
