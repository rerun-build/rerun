import contextlib, io, os, sys, tempfile, types, unittest
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
    def run_new(self, capped):
        class Stop(Exception):
            pass

        sweep = mock.Mock(return_value=("sum", []))
        lock = contextlib.nullcontext()
        with mock.patch.object(F, "wt_sweep", sweep), mock.patch.object(F, "builder_lock", return_value=lock), \
                mock.patch.object(F, "cap_check", return_value=capped), mock.patch.object(F, "du_gb", return_value=1), \
                mock.patch.object(F, "avail_mem_gb", return_value=None), mock.patch.object(F, "plan_check", side_effect=Stop), \
                mock.patch.object(F.shutil, "disk_usage", return_value=types.SimpleNamespace(free=2**50)), \
                mock.patch.object(F.os.path, "isdir", return_value=False), mock.patch.object(F.os, "makedirs"), \
                mock.patch.object(F, "die", side_effect=SystemExit("builders are already active")):
            try:
                F.cmd_wt(["new", "special-place-ai-heaven/rerun", "820", "main"])
            except (Stop, SystemExit):
                pass
        return sweep

    def test_room_does_not_sweep(self):
        self.assertEqual(self.run_new(None).call_count, 0)

    def test_cap_sweeps_once(self):
        self.assertEqual(self.run_new(True).call_count, 1)


class LockMessage(unittest.TestCase):
    def test_waiting_line_on_stderr(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "builders.lock"), "w").write("4242 1\n")
            err = io.StringIO()
            with mock.patch.object(F, "STATE", d), mock.patch.object(F, "LOCK_WAIT_S", 0), \
                    mock.patch.object(F, "die", side_effect=SystemExit), mock.patch("sys.stderr", err):
                with self.assertRaises(SystemExit), F.builder_lock():
                    pass
            self.assertIn("waiting for builders.lock (held by pid 4242)", err.getvalue())


if __name__ == "__main__":
    unittest.main()
