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

    def mode(self, name, test_flag=True, script=SCRIPT):
        rc, made, _ = self.run_mode(name, test_flag, script)
        return rc, made

    def run_mode(self, name, test_flag=True, script=SCRIPT):
        calls = os.path.join(self.tmp, "calls")
        env = dict(os.environ, PATH=self.tmp + os.pathsep + os.environ["PATH"], CALLS=calls, TIDY_ROOT=self.root)
        env.pop("TIDY_TEST", None)
        if test_flag:
            env["TIDY_TEST"] = "1"
        done = subprocess.run([SH, script, name], env=env, capture_output=True, text=True)
        rc = done.returncode
        made = []
        if os.path.exists(calls):
            with open(calls) as f:
                made = f.read().splitlines()
            os.remove(calls)
        return rc, made, done.stdout + done.stderr

    def test_report_removes_nothing_and_run_removes_two_kinds(self):
        self.assertEqual(self.mode("report"), (0, ["docker system df"]))
        self.assertEqual(self.mode("run"), (0, ["docker image prune -f", "docker builder prune -af"]))

    def test_install_leaves_a_copy_and_a_timer_and_uninstall_takes_them_away(self):
        units, copy = os.path.join(self.root, "etc/systemd/system"), os.path.join(self.root, "usr/local/sbin/rerun-tidy")
        rc, made = self.mode("install")
        self.assertEqual((rc, made), (0, ["systemctl daemon-reload", "systemctl enable --now rerun-tidy.timer", "systemctl list-timers rerun-tidy.timer --no-pager"]))
        with open(os.path.join(units, "rerun-tidy.service")) as f:
            self.assertIn("ExecStart=%s run\n" % copy, f.read())
        self.assertTrue(os.access(copy, os.X_OK))
        self.assertEqual(sorted(os.listdir(units)), ["rerun-tidy.service", "rerun-tidy.timer"])
        self.assertEqual(self.mode("uninstall"), (0, ["systemctl disable --now rerun-tidy.timer", "systemctl daemon-reload"]))
        self.assertEqual(os.listdir(units) + os.listdir(os.path.dirname(copy)), [])

    def test_install_and_uninstall_refuse_tidy_root_without_the_test_flag(self):
        for name in ("install", "uninstall"):
            self.assertEqual(self.mode(name, test_flag=False), (2, []))
        self.assertEqual(os.listdir(os.path.join(self.root, "etc/systemd/system")), [])
        self.assertEqual(os.listdir(os.path.join(self.root, "usr/local/sbin")), [])

    def test_install_from_the_installed_copy_says_run_it_from_the_clone(self):
        copy = os.path.join(self.root, "usr/local/sbin/rerun-tidy")
        shutil.copy(SCRIPT, copy)
        rc, made, out = self.run_mode("install", script=copy)
        self.assertEqual((rc, made), (2, []))
        self.assertIn("run install from the clone", out)
        self.assertEqual(os.listdir(os.path.join(self.root, "etc/systemd/system")), [])

    def test_an_unknown_mode_changes_nothing(self):
        self.assertEqual(self.mode("purge"), (2, []))


if __name__ == "__main__":
    unittest.main()
