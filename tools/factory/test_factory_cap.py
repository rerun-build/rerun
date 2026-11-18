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
