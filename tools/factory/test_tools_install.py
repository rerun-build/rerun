import fcntl, json, os, shutil, subprocess, sys, tempfile, time, unittest
from unittest import mock

import test_factory as T

F = T.F
HERE = os.path.dirname(os.path.abspath(__file__))
STUB = """CLONE_SAFE = 1
import os, sys, time
cmd = os.environ.get("FACTORY_CMD")
if cmd not in ("packet", "wt"):
    print("commands: packet, wt")
    sys.exit(2)
time.sleep(float(os.environ.get("T_SLEEP", "0")))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe
if os.environ.get("T_BREAK") and os.path.exists(os.path.join(probe.WHERE, "broken")):
    raise RuntimeError("broken copy")
print(probe.WHERE)
"""
A, B = "a" * 40, "b" * 40


def tree(root, broken_syntax=False):
    os.makedirs(os.path.join(root, "triggers"))
    os.makedirs(os.path.join(root, "bin"))
    shutil.copy(os.path.join(HERE, "install.sh"), root)
    for n in ("packet", "wt"):
        shutil.copy(os.path.join(HERE, "bin", n), os.path.join(root, "bin", n))
    with open(os.path.join(root, "factory.py"), "w") as f:
        f.write(STUB + ("def broken(:\n" if broken_syntax else ""))
    with open(os.path.join(root, "probe.py"), "w") as f:
        f.write("import os\nWHERE = os.path.dirname(os.path.abspath(__file__))\n")
    with open(os.path.join(root, "triggers", "x.md"), "w") as f:
        f.write("x\n")
    return root


class Installs(unittest.TestCase):
    def setUp(self):
        if sys.platform == "win32" or not shutil.which("sh") or not shutil.which("flock"):
            self.skipTest("needs sh and flock")
        self.tmp = tempfile.mkdtemp(prefix="installs-")
        self.addCleanup(shutil.rmtree, self.tmp)
        self.pre = os.path.join(self.tmp, "tools")
        self.key = os.path.join(self.tmp, "secret-key-path")

    def install(self, src, sha):
        return subprocess.run(["sh", os.path.join(src, "install.sh"), "--prefix", self.pre, "--jev-keyfile", self.key, "--version", sha],
                              capture_output=True, text=True)

    def wrapper(self, n, **env):
        return subprocess.run([os.path.join(self.pre, "bin", n)], capture_output=True, text=True, env=dict(os.environ, **env))

    def two(self):
        a, b = tree(os.path.join(self.tmp, "A")), tree(os.path.join(self.tmp, "B"))
        self.assertEqual(self.install(a, A).returncode, 0)
        r = self.install(b, B)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return a, b

    def test_each_version_is_its_own_folder_and_the_switch_is_one_link(self):
        self.two()
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + B)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-previous")), "factory-" + A)
        with open(os.path.join(self.pre, "factory-installed")) as f:
            self.assertTrue(f.read().startswith(B + " "))
        r = self.wrapper("packet")
        self.assertEqual(r.stdout.strip(), os.path.join(self.pre, "factory-" + B))

    def test_a_running_command_keeps_the_copy_it_started_with(self):
        a = tree(os.path.join(self.tmp, "A"))
        self.install(a, A)
        p = subprocess.Popen([os.path.join(self.pre, "bin", "packet")], stdout=subprocess.PIPE, text=True, env=dict(os.environ, T_SLEEP="2"))
        time.sleep(0.5)
        self.assertEqual(self.install(tree(os.path.join(self.tmp, "B")), B).returncode, 0)
        self.assertEqual(p.communicate(30)[0].strip(), os.path.join(self.pre, "factory-" + A))

    def test_a_copy_that_fails_its_self_check_is_never_switched_to(self):
        a = tree(os.path.join(self.tmp, "A"))
        self.install(a, A)
        r = self.install(tree(os.path.join(self.tmp, "B"), broken_syntax=True), B)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("REFUSED: ", r.stderr)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + A)
        self.assertFalse(os.path.exists(os.path.join(self.pre, "factory-" + B)))

    def test_a_second_installer_does_not_wait_and_changes_nothing(self):
        a = tree(os.path.join(self.tmp, "A"))
        self.install(a, A)
        with open(os.path.join(self.pre, ".install.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            t = time.time()
            r = self.install(tree(os.path.join(self.tmp, "B")), B)
        self.assertEqual(r.returncode, 3)
        self.assertIn("TRANSIENT: another install is running", r.stdout)
        self.assertLess(time.time() - t, 5)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + A)

    def test_a_read_only_command_falls_back_to_the_previous_copy_and_says_so(self):
        self.two()
        open(os.path.join(self.pre, "factory-" + B, "broken"), "w").close()
        r = self.wrapper("packet", T_BREAK="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("FALLBACK: packet failed", r.stderr)
        self.assertEqual(r.stdout.strip().splitlines()[-1], os.path.join(self.pre, "factory-" + A))

    def test_a_command_that_changes_things_never_falls_back(self):
        self.two()
        open(os.path.join(self.pre, "factory-" + B, "broken"), "w").close()
        r = self.wrapper("wt", T_BREAK="1")
        self.assertEqual(r.returncode, 1)
        self.assertNotIn("FALLBACK", r.stderr)

    def test_ci_wait_and_risk_never_fall_back(self):
        a = tree(os.path.join(self.tmp, "A"))
        for n in ("ci-wait", "risk"):
            shutil.copy(os.path.join(HERE, "bin", n), os.path.join(a, "bin", n))
        self.assertEqual(self.install(a, A).returncode, 0)
        for n in ("ci-wait", "risk"):
            with open(os.path.join(self.pre, "bin", n)) as f:
                self.assertNotIn("FALLBACK", f.read(), n)
        with open(os.path.join(self.pre, "bin", "packet")) as f:
            self.assertIn("FALLBACK", f.read())

    def test_an_install_cut_off_after_the_switch_is_finished_by_the_rerun(self):
        self.install(tree(os.path.join(self.tmp, "A")), A)
        b = tree(os.path.join(self.tmp, "B"))
        shutil.copy(os.path.join(HERE, "bin", "risk"), os.path.join(b, "bin", "risk"))
        self.assertEqual(self.install(b, B).returncode, 0)
        os.remove(os.path.join(self.pre, "bin", "risk"))
        with open(os.path.join(self.pre, "factory-installed"), "w") as f:
            f.write(A + " 2026-11-16T00:00:00Z\n")
        r = self.install(b, B)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("already the current copy", r.stdout)
        self.assertTrue(os.path.isfile(os.path.join(self.pre, "bin", "risk")))
        with open(os.path.join(self.pre, "factory-installed")) as f:
            self.assertTrue(f.read().startswith(B + " "))
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + B)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-previous")), "factory-" + A)
        r = self.install(b, B)
        self.assertIn("already the current copy", r.stdout)

    def test_reinstalling_the_previous_copy_keeps_its_folder(self):
        a, b = self.two()
        mark = os.path.join(self.pre, "factory-" + A, "in-use")
        open(mark, "w").close()
        r = self.install(a, A)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.exists(mark))
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + A)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-previous")), "factory-" + B)

    def test_the_keyfile_path_is_never_printed(self):
        a = tree(os.path.join(self.tmp, "A"))
        r = self.install(a, A)
        self.assertNotIn(self.key, r.stdout + r.stderr)

    def test_install_removes_stale_merge_dev_wrapper(self):
        a = tree(os.path.join(self.tmp, "A"))
        os.makedirs(os.path.join(self.pre, "bin"), exist_ok=True)
        stale = os.path.join(self.pre, "bin", "merge-dev")
        open(stale, "w").close()
        r = self.install(a, A)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(os.path.exists(stale))


class AutoInstall(T.FactoryCase):
    def setUp(self):
        super().setUp()
        if sys.platform == "win32" or not shutil.which("sh") or not shutil.which("flock"):
            self.skipTest("needs sh and flock")
        import toolsupdate, mirror
        self.U, self.M = toolsupdate, mirror
        self.pre = os.path.join(self.tmp, "tools")
        work = self.make_clone("toolsrc", init=True)
        tree(os.path.join(work, "tools", "factory"))
        T.git(work, "add", "-A")
        T.git(work, "commit", "--quiet", "-m", "good")
        self.good = T.git(work, "rev-parse", "HEAD")
        with open(os.path.join(work, "tools", "factory", "factory.py"), "a") as f:
            f.write("def broken(:\n")
        T.git(work, "commit", "--quiet", "-am", "bad")
        self.bad = T.git(work, "rev-parse", "HEAD")
        os.makedirs(os.path.dirname(self.M.path("rerun")), exist_ok=True)
        T.git(self.tmp, "clone", "--quiet", "--mirror", work, self.M.path("rerun"))
        for k, v in (("FACTORY_TOOLS_PREFIX", self.pre), ("FACTORY_JEV_KEYFILE", "/k")):
            p = mock.patch.dict(os.environ, {k: v})
            p.start()
            self.addCleanup(p.stop)
        self.green = self.good

    def gh(self, args):
        if "factory-tools.yml" in args[1]:
            return json.dumps({"workflow_runs": [{"head_sha": self.green}]})
        return json.dumps([{"sha": self.green}])

    def run_u(self):
        return self.call(lambda _: sys.exit(self.U.main([], gh=self.gh)), [])

    def test_a_new_green_tools_commit_is_installed_once(self):
        code, out = self.run_u()
        self.assertEqual(code, 0, out)
        self.assertIn("TOOLS installed %s" % self.good[:8], out)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + self.good)
        code, out = self.run_u()
        self.assertIn("TOOLS current at %s" % self.good[:8], out)

    def test_without_a_key_file_setting_the_tools_still_update(self):
        with mock.patch.dict(os.environ):
            del os.environ["FACTORY_JEV_KEYFILE"]
            code, out = self.run_u()
        self.assertEqual(code, 0, out)
        self.assertIn("TOOLS installed %s" % self.good[:8], out)

    def test_a_commit_that_fails_to_install_is_skipped_and_the_current_copy_stays(self):
        self.run_u()
        self.green = self.bad
        code, out = self.run_u()
        self.assertEqual(code, 2, out)
        self.assertIn("INSTALL FAILED for %s; still on %s" % (self.bad[:8], self.good[:8]), out)
        self.assertEqual(os.readlink(os.path.join(self.pre, "factory-current")), "factory-" + self.good)
        code, out = self.run_u()
        self.assertEqual(code, 0, out)
        self.assertIn("TOOLS current at", out)

    def test_a_busy_install_lock_is_transient_and_skips_nothing(self):
        os.makedirs(self.pre, exist_ok=True)
        with open(os.path.join(self.pre, ".install.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            code, out = self.run_u()
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: ", out)
        self.assertNotIn("TOOLS installed", out)
        self.assertFalse(os.path.exists(self.U.skip_path()))
        code, out = self.run_u()
        self.assertEqual(code, 0, out)
        self.assertIn("TOOLS installed %s" % self.good[:8], out)

    def stub(self):
        with open(os.path.join(self.pre, "factory-" + self.good, "webguide.py"), "w") as f:
            f.write("import os, sys, time\n"
                    "open(sys.argv[2] + '.called', 'w').write(' '.join(sys.argv[1:]))\n"
                    "time.sleep(float(os.environ.get('T_GUIDE_SLEEP', '0')))\n"
                    "print('webguide: stub')\n")

    def called(self):
        return os.path.join(self.pre, "webguide.called")

    def test_every_clean_run_has_the_current_copy_ensure_the_guide_copy(self):
        self.run_u()
        self.stub()
        code, out = self.run_u()
        self.assertEqual(code, 0, out)
        self.assertIn("TOOLS current", out)
        self.assertEqual(out.strip().splitlines()[-1], "webguide: stub")
        with open(self.called()) as f:
            self.assertEqual(f.read(), "--dir %s ensure" % os.path.join(self.pre, "webguide"))

    def test_a_failed_update_leaves_the_guide_copy_alone(self):
        self.run_u()
        self.stub()
        self.green = self.bad
        code, out = self.run_u()
        self.assertEqual(code, 2, out)
        self.assertTrue(out.strip().splitlines()[-1].startswith("INSTALL FAILED"), out)
        self.assertFalse(os.path.exists(self.called()))

    def test_a_late_run_leaves_the_guide_copy_to_the_next_run(self):
        self.run_u()
        self.stub()
        ticks = [0, 51]
        code, out = self.call(lambda _: sys.exit(self.U.main([], gh=self.gh, clock=lambda: ticks.pop(0) if len(ticks) > 1 else ticks[0])), [])
        self.assertEqual(code, 0, out)
        self.assertIn("webguide: not checked", out)
        self.assertFalse(os.path.exists(self.called()))

    def test_an_ensure_past_its_timeout_is_stopped_and_says_when_it_retries(self):
        self.run_u()
        self.stub()
        started = time.monotonic()
        with mock.patch.dict(os.environ, {"T_GUIDE_SLEEP": "5"}):
            code, out = self.call(lambda _: self.U.guides(self.pre, timeout=1), [])
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(out.strip(), "webguide: ensure stopped at 1 s; next try after the one-hour wait")

    def test_github_unreachable_is_transient(self):
        def down(args):
            raise RuntimeError("HTTP 502")
        code, out = self.call(lambda _: sys.exit(self.U.main([], gh=down)), [])
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: ", out)
