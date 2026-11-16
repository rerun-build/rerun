import fcntl, os, signal, subprocess, sys, textwrap, time, unittest
from unittest import mock

import test_factory as T

F = T.F
FULL = "special-place-ai-heaven/rerun"
HERE = os.path.dirname(os.path.abspath(__file__))


class MirrorCase(T.FactoryCase):
    def setUp(self):
        super().setUp()
        import mirror
        self.M = mirror
        gh = os.path.join(self.tmp, "github.com", "special-place-ai-heaven")
        os.makedirs(gh)
        os.symlink(self.origin, os.path.join(gh, "rerun.git"))
        for k, v in (("GITHUB", "file://" + self.tmp + "/github.com/"), ("BACKOFF_S", 0)):
            p = mock.patch.object(mirror, k, v)
            p.start()
            self.addCleanup(p.stop)

    def quiet(self, fn, *a):
        return self.call(lambda _: sys.exit(fn(*a)), [])

    def advance(self, name="next.txt"):
        seed = os.path.join(self.tmp, "seed")
        T.git(seed, "pull", "--quiet", self.origin, "dev")
        sha = self.commit(seed, name, name + "\n")
        T.git(seed, "push", "--quiet", self.origin, "HEAD:refs/heads/dev")
        return sha


class Mirror(MirrorCase):
    def test_refresh_makes_a_bare_mirror_with_gc_off(self):
        code, out = self.quiet(self.M.refresh, FULL)
        self.assertEqual(code, 0, out)
        m = self.M.path("rerun")
        self.assertEqual(T.git(m, "rev-parse", "--is-bare-repository"), "true")
        self.assertEqual(T.git(m, "config", "gc.auto"), "0")
        self.assertEqual(T.git(m, "rev-parse", "refs/heads/dev"), self.remote_sha("refs/heads/dev"))

    def test_refresh_keeps_the_shared_checkout_of_code_intelligence_at_todays_dev(self):
        new = self.advance()
        with mock.patch.object(self.M.F, "ensure_clone", lambda full: (T.git(self.clone, "fetch", "--quiet", "origin"), F.follow_base(self.clone))):
            code, out = self.quiet(self.M.refresh, FULL)
        self.assertEqual(code, 0, out)
        self.assertEqual(T.git(self.clone, "rev-parse", "HEAD"), new)
        self.assertIn("shared checkout", out)

    def test_a_push_into_the_mirror_is_refused_by_its_hook(self):
        self.quiet(self.M.refresh, FULL)
        c = self.make_clone("c")
        T.git(c, "remote", "set-url", "origin", self.M.path("rerun"))
        self.commit(c, "x.txt")
        r = subprocess.run(["git", "push", "origin", "HEAD:refs/heads/chunk/9-1"], cwd=c, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("read-only cache", r.stderr)
        self.assertEqual(T.git(self.M.path("rerun"), "for-each-ref", "refs/heads/chunk/"), "")

    def test_freshness_check_says_behind_then_fresh(self):
        self.quiet(self.M.refresh, FULL)
        new = self.advance()
        code, out = self.quiet(self.M.check, FULL)
        self.assertEqual(code, 3, out)
        self.assertIn("MIRROR BEHIND rerun", out)
        self.quiet(self.M.refresh, FULL)
        code, out = self.quiet(self.M.check, FULL)
        self.assertEqual(code, 0, out)
        self.assertEqual(T.git(self.M.path("rerun"), "rev-parse", "refs/heads/dev"), new)

    def test_stale_git_locks_left_by_a_killed_fetch_are_cleared_by_the_single_writer(self):
        self.quiet(self.M.refresh, FULL)
        m = self.M.path("rerun")
        for f in ("packed-refs.lock", os.path.join("refs", "heads", "dev.lock")):
            open(os.path.join(m, f), "w").close()
        new = self.advance()
        code, out = self.quiet(self.M.refresh, FULL)
        self.assertEqual(code, 0, out)
        self.assertIn("removed stale git lock packed-refs.lock", out)
        self.assertEqual(T.git(m, "rev-parse", "refs/heads/dev"), new)

    def test_a_second_refresh_does_not_wait(self):
        os.makedirs(self.M.root(), exist_ok=True)
        with open(os.path.join(self.M.root(), "rerun.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            t = time.time()
            code, out = self.quiet(self.M.refresh, FULL)
        self.assertEqual(code, 0, out)
        self.assertIn("another refresh is running", out)
        self.assertLess(time.time() - t, 2)
        self.assertFalse(os.path.isdir(self.M.path("rerun")))

    def test_unreachable_github_is_transient(self):
        self.quiet(self.M.refresh, FULL)
        with mock.patch.object(self.M, "GITHUB", "file://" + self.tmp + "/nowhere/"):
            code, out = self.quiet(self.M.check, FULL)
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: ", out)


DRIVER = textwrap.dedent("""
    import os, sys
    sys.path.insert(0, os.environ["T_HERE"])
    import factory as F, mirror
    F.GIT = os.environ.get("T_GIT") or "git"
    F.ensure_clone = lambda full: None
    mirror.BACKOFF_S = 0
    real, kill = mirror.git, os.environ.get("T_KILL")
    def git(args, cwd="/tmp", timeout=300):
        if kill == "final" and cwd == mirror.path("rerun"):
            os._exit(137)
        r = real(args, cwd=cwd, timeout=timeout)
        if kill == "cloned" and args[0] == "clone":
            os._exit(137)
        return r
    mirror.git = git
    sys.exit(mirror.refresh("special-place-ai-heaven/rerun"))
""")


class KilledRefresh(MirrorCase):
    def drive(self, **extra):
        env = dict(os.environ, T_HERE=HERE, FACTORY_WORK=F.WORK, FACTORY_GITHUB_URL=self.M.GITHUB, **extra)
        return subprocess.Popen([sys.executable, "-I", "-c", DRIVER], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def test_a_first_refresh_killed_after_the_clone_leaves_no_temporary_mirror_behind(self):
        p = self.drive(T_KILL="cloned")
        self.assertEqual(p.wait(60), 137, p.stdout.read())
        code, out = self.quiet(self.M.refresh, FULL)
        self.assertEqual(code, 0, out)
        self.assertEqual([e for e in os.listdir(self.M.root()) if e.endswith(".tmp")], [])

    def test_a_first_refresh_killed_after_the_rename_leaves_a_mirror_that_refuses_pushes(self):
        p = self.drive(T_KILL="final")
        self.assertEqual(p.wait(60), 137, p.stdout.read())
        self.assertTrue(os.path.isdir(self.M.path("rerun")))
        c = self.make_clone("c")
        T.git(c, "remote", "set-url", "origin", self.M.path("rerun"))
        self.commit(c, "x.txt")
        r = subprocess.run(["git", "push", "origin", "HEAD:refs/heads/chunk/9-1"], cwd=c, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0, r.stderr)
        self.assertIn("read-only cache", r.stderr)

    def test_a_git_left_running_by_a_killed_refresh_still_holds_the_lock(self):
        self.quiet(self.M.refresh, FULL)
        fake = os.path.join(self.tmp, "slowgit")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\nif [ \"$1\" = fetch ]; then echo $$ > \"$T_DIR/fetch.pid\"; exec sleep 30; fi\nexec git \"$@\"\n")
        os.chmod(fake, 0o755)
        p = self.drive(T_GIT=fake, T_DIR=self.tmp)
        pid = os.path.join(self.tmp, "fetch.pid")
        for _ in range(200):
            if os.path.exists(pid) and open(pid).read().strip():
                break
            time.sleep(0.05)
        p.kill()
        p.wait(10)
        with open(pid) as f:
            left = int(f.read().strip())
        self.addCleanup(lambda: subprocess.run(["kill", "-9", str(left)], capture_output=True))
        code, out = self.quiet(self.M.refresh, FULL)
        self.assertEqual(code, 0, out)
        self.assertIn("another refresh is running", out)


class SigtermReachesGit(unittest.TestCase):
    def test_sigterm_is_passed_to_git_and_waited_for(self):
        import tempfile
        d = tempfile.mkdtemp(prefix="term-")
        fake = os.path.join(d, "git")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\ntrap 'echo got-term > %s/term; exit 143' TERM\necho started > %s/started\nwhile :; do sleep 0.1; done\n" % (d, d))
        os.chmod(fake, 0o755)
        code = textwrap.dedent("""
            import sys; sys.path.insert(0, %r)
            import factory as F, mirror
            F.GIT = %r
            mirror.git(["fetch"], cwd=%r)
        """) % (HERE, fake, d)
        p = subprocess.Popen([sys.executable, "-I", "-c", code])
        for _ in range(100):
            if os.path.exists(os.path.join(d, "started")):
                break
            time.sleep(0.05)
        p.send_signal(signal.SIGTERM)
        self.assertEqual(p.wait(10), 143)
        with open(os.path.join(d, "term")) as f:
            self.assertEqual(f.read().strip(), "got-term")


def ended(pid):
    try:
        with open("/proc/%d/stat" % pid) as f:
            return f.read().rsplit(")", 1)[1].split()[0] == "Z"
    except OSError:
        return True


class TimeoutEndsTheTree(unittest.TestCase):
    def slow(self, child):
        import tempfile
        d = tempfile.mkdtemp(prefix="tree-")
        fake = os.path.join(d, "slow")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\nsh -c '%s echo $$ > %s/child.pid; i=0; while [ $i -lt 120 ]; do sleep 0.1; i=$((i+1)); done' &\nwait\n" % (child, d))
        os.chmod(fake, 0o755)
        return fake, os.path.join(d, "child.pid")

    def past_its_time(self, child):
        import mirror
        fake, pid = self.slow(child)
        t0 = time.time()
        with mock.patch.object(mirror, "GRACE_S", 1):
            r = mirror.run([fake], timeout=1)
        took = time.time() - t0
        with open(pid) as f:
            left = int(f.read().strip())
        self.addCleanup(lambda: subprocess.run(["kill", "-9", str(left)], capture_output=True))
        self.assertLess(took, 8)
        self.assertNotEqual(r.returncode, 0)
        for _ in range(40):
            if ended(left):
                break
            time.sleep(0.05)
        self.assertTrue(ended(left), "the child of the command is still running")

    def test_a_command_past_its_time_is_ended_with_its_children(self):
        self.past_its_time("")

    def test_a_child_that_ignores_the_first_signal_is_ended_by_the_second(self):
        self.past_its_time("trap \"\" TERM;")
