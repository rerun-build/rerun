import io, os, sys, tempfile, types, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F


class FactoryCap(unittest.TestCase):
    def test_cap_check_reads_limits_capacity(self):
        run = mock.Mock(return_value=types.SimpleNamespace(stdout="chunk/71-1"))
        with mock.patch.object(F, "wt_dirs", return_value=[("rerun", "71-1", "/x")]), mock.patch.object(F, "run", run), \
                mock.patch.object(F, "marker", return_value="/nonexistent/marker"):
            with mock.patch.object(F.limits, "capacity", return_value=1), self.assertRaises(SystemExit):
                F.cap_check()
            with mock.patch.object(F.limits, "capacity", return_value=2):
                F.cap_check()

    def test_fallback_3(self):
        with mock.patch.object(F, "limits", None):
            self.assertEqual(F.max_builders(), 3)


class WtNewSweep(unittest.TestCase):
    def run_new(self, capacity):
        class Stop(Exception):
            pass

        def fake_run(cmd, cwd="/tmp", check=True, timeout=300):
            out = "1024\tx" if cmd[0] == "du" else "chunk/71-1"
            return types.SimpleNamespace(stdout=out, returncode=0)

        sweep = mock.Mock(return_value=("sum", []))
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as d:
            wt = os.path.join(d, "wt")
            os.makedirs(os.path.join(wt, "rerun", "71-1"))
            with mock.patch.object(F, "WORK", d), mock.patch.object(F, "WT", wt), mock.patch.object(F, "STATE", os.path.join(d, "state")), \
                    mock.patch.object(F, "MIN_FREE_GB", 0), mock.patch.object(F.shutil, "disk_usage", return_value=types.SimpleNamespace(free=2**40)), mock.patch.object(F, "MIN_FREE_MEM_GB", 0), \
                    mock.patch.object(F, "MEMINFO", os.path.join(d, "none")), mock.patch.object(F, "run", fake_run), \
                    mock.patch.object(F, "wt_sweep", sweep), mock.patch.object(F, "api", side_effect=Stop), \
                    mock.patch.object(F.limits, "capacity", return_value=capacity), mock.patch("sys.stdout", out):
                try:
                    F.cmd_wt(["new", "special-place-ai-heaven/rerun", "820", "main"])
                    outcome = "returned"
                except Stop:
                    outcome = "reached plan_check"
                except SystemExit as e:
                    outcome = "refused %s" % e.code
        return sweep, outcome, out.getvalue()

    def test_room_does_not_sweep(self):
        sweep, outcome, _ = self.run_new(2)
        self.assertEqual(sweep.call_count, 0)
        self.assertEqual(outcome, "reached plan_check")

    def test_cap_sweeps_once_and_still_refuses(self):
        sweep, outcome, out = self.run_new(1)
        self.assertEqual(sweep.call_count, 1)
        self.assertEqual(outcome, "refused 2")
        self.assertIn("builders are already active", out)


class LockMessage(unittest.TestCase):
    def test_waiting_line_on_stderr(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "builders.lock"), "w").write("4242 1\n")
            err = io.StringIO()
            with mock.patch.object(F, "STATE", d), mock.patch.object(F, "LOCK_WAIT_S", 0), \
                    mock.patch("sys.stdout", io.StringIO()), mock.patch("sys.stderr", err):
                with self.assertRaises(SystemExit), F.builder_lock():
                    pass
            self.assertIn("waiting for builders.lock (held by pid 4242)", err.getvalue())


if __name__ == "__main__":
    unittest.main()
