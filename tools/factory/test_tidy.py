import os, shutil, subprocess, tempfile, unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps", "tidy.sh")
SH = shutil.which("sh")


@unittest.skipIf(SH is None or os.name == "nt", "runs a POSIX shell script with stand-in programs on PATH (CI runs it on Linux)")
class Tidy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        for name in ("docker", "systemctl"):
            path = os.path.join(self.tmp, name)
            with open(path, "w") as f:
                f.write('#!/bin/sh\necho "%s $*" >> "$CALLS"\n' % name)
            os.chmod(path, 0o755)
        for d in ("etc/systemd/system", "usr/local/sbin"):
            os.makedirs(os.path.join(self.root, d))

    def mode(self, name):
        calls = os.path.join(self.tmp, "calls")
        env = dict(os.environ, PATH=self.tmp + os.pathsep + os.environ["PATH"], CALLS=calls, TIDY_ROOT=self.root)
        rc = subprocess.run([SH, SCRIPT, name], env=env, capture_output=True).returncode
        made = []
        if os.path.exists(calls):
            with open(calls) as f:
                made = f.read().splitlines()
            os.remove(calls)
        return rc, made

    def test_report_removes_nothing_and_run_removes_two_kinds(self):
        self.assertEqual(self.mode("report"), (0, ["docker system df"]))
        self.assertEqual(self.mode("run"), (0, ["docker image prune -f", "docker builder prune -af"]))

    def test_install_leaves_a_copy_and_a_timer_and_uninstall_takes_them_away(self):
        units, copy = os.path.join(self.root, "etc/systemd/system"), os.path.join(self.root, "usr/local/sbin/rerun-tidy")
        rc, made = self.mode("install")
        self.assertEqual((rc, made[:2]), (0, ["systemctl daemon-reload", "systemctl enable --now rerun-tidy.timer"]))
        with open(os.path.join(units, "rerun-tidy.service")) as f:
            self.assertIn("ExecStart=%s run\n" % copy, f.read())
        self.assertTrue(os.access(copy, os.X_OK))
        self.assertEqual(sorted(os.listdir(units)), ["rerun-tidy.service", "rerun-tidy.timer"])
        self.assertEqual(self.mode("uninstall")[0], 0)
        self.assertEqual(os.listdir(units) + os.listdir(os.path.dirname(copy)), [])

    def test_an_unknown_mode_changes_nothing(self):
        self.assertEqual(self.mode("purge"), (2, []))


if __name__ == "__main__":
    unittest.main()
