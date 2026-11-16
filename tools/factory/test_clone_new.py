import fcntl, json, os, re, subprocess, sys, textwrap, time, unittest
from unittest import mock

import test_factory as T

F = T.F
FULL = "special-place-ai-heaven/rerun"
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|x-access-token|://[^/\s]*@")
DRIVER = textwrap.dedent("""
    import os, sys
    sys.path.insert(0, os.environ["T_HERE"])
    import factory as F, clones, mirror
    F.GIT = "git"
    F.plan_check = lambda *a: None
    F.api = lambda *a, **k: {"default_branch": "main"}
    F.MIN_FREE_MEM_GB = 0
    F.MIN_FREE_GB = 0
    clones.BACKOFF_S = 0
    kill = os.environ.get("T_KILL")
    clones.step = lambda n: os._exit(137) if n == kill else n
    go = os.environ.get("T_GO")
    while go and not os.path.exists(go):
        pass
    F.cmd_wt(["new", "rerun", os.environ["T_ISSUE"], os.environ["T_CHUNK"], "--clone"])
""")
PNPM = "#!/bin/sh\n[ -n \"$T_KILL_PNPM\" ] && kill -9 $PPID\nmkdir -p node_modules && echo ok > node_modules/.ok\n"


class CloneCase(T.FactoryCase):
    def setUp(self):
        super().setUp()
        import clones, mirror
        self.C, self.M = clones, mirror
        gh = os.path.join(self.tmp, "github.com", "special-place-ai-heaven")
        os.makedirs(gh)
        os.symlink(self.origin, os.path.join(gh, "rerun.git"))
        self.github = "file://" + self.tmp + "/github.com/"
        seed = os.path.join(self.tmp, "seed")
        T.write(seed, "pnpm-lock.yaml", "lockfileVersion: 9\n")
        T.git(seed, "add", "-A")
        T.git(seed, "commit", "--quiet", "-m", "lock")
        T.git(seed, "push", "--quiet", self.origin, "HEAD:refs/heads/dev")
        bindir = os.path.join(self.tmp, "bin")
        os.makedirs(bindir)
        with open(os.path.join(bindir, "pnpm"), "w") as f:
            f.write(PNPM)
        os.chmod(os.path.join(bindir, "pnpm"), 0o755)
        self.env = dict(os.environ, T_HERE=HERE, FACTORY_WORK=F.WORK, FACTORY_GITHUB_URL=self.github,
                        PATH=bindir + os.pathsep + os.environ.get("PATH", ""), FACTORY_RUN="run-a",
                        GH_TOKEN="ghp_" + "Z" * 36, GIT_CONFIG_NOSYSTEM="1")
        for k, v in (("GITHUB", self.github),):
            p = mock.patch.object(mirror, k, v)
            p.start()
            self.addCleanup(p.stop)

    def spawn(self, chunk="1", issue="7", **extra):
        env = dict(self.env, T_ISSUE=issue, T_CHUNK=chunk, **extra)
        return subprocess.Popen([sys.executable, "-I", "-c", DRIVER], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def new(self, chunk="1", issue="7", **extra):
        p = self.spawn(chunk, issue, **extra)
        out = p.communicate(120)[0]
        return p.returncode, out

    def folder(self, chunk="1", issue="7"):
        return os.path.join(F.WT, T.REPO, "%s-%s" % (issue, chunk))

    def assert_ready(self, path, chunk="1", issue="7"):
        self.assertTrue(os.path.isdir(os.path.join(path, ".git")))
        self.assertTrue(os.path.isfile(os.path.join(path, ".git", "factory-ready")))
        self.assertTrue(os.path.isfile(os.path.join(path, ".git", "factory-created")))
        self.assertFalse(os.path.exists(os.path.join(path, ".git", "objects", "info", "alternates")))
        self.assertEqual(T.git(path, "remote", "get-url", "origin"), self.github + FULL + ".git")
        self.assertEqual(T.git(path, "rev-parse", "--abbrev-ref", "HEAD"), "chunk/%s-%s" % (issue, chunk))
        self.assertEqual(T.git(path, "config", "branch.chunk/%s-%s.factorybase" % (issue, chunk)), "dev")
        self.assertTrue(os.path.isfile(os.path.join(path, "node_modules", ".ok")))
        with open(F.reg_path(T.REPO, "%s-%s" % (issue, chunk))) as f:
            self.assertEqual(json.load(f)["checkout"], "clone")
        cwd = os.getcwd()
        try:
            os.chdir(path)
            self.assertEqual(F.wt_context()[1:5], (FULL, "chunk/%s-%s" % (issue, chunk), "dev", issue))
        finally:
            os.chdir(cwd)


class CloneNew(CloneCase):
    def test_clone_from_github_when_there_is_no_mirror(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn("checkout clone", out)
        self.assert_ready(self.folder())
        self.assertEqual(T.git(self.folder(), "rev-parse", "HEAD"), self.remote_sha("refs/heads/dev"))

    def test_clone_from_the_mirror_survives_the_mirror_being_pruned_and_removed(self):
        self.call(lambda _: self.M.refresh(FULL), [])
        code, out = self.new()
        self.assertEqual(code, 0, out)
        m = self.M.path("rerun")
        T.git(m, "gc", "--quiet", "--prune=now")
        import shutil
        shutil.rmtree(m)
        p = self.folder()
        for k, v in (("user.name", "t"), ("user.email", "t@localhost"), ("commit.gpgsign", "false")):
            T.git(p, "config", k, v)
        self.commit(p, "after.txt")
        T.git(p, "fsck", "--no-progress")
        T.git(p, "push", "--quiet", "origin", "chunk/7-1")
        self.assertTrue(self.remote_sha("refs/heads/chunk/7-1"))

    def test_a_mirror_behind_github_still_gives_todays_base(self):
        self.call(lambda _: self.M.refresh(FULL), [])
        seed = os.path.join(self.tmp, "seed")
        new = self.commit(seed, "later.txt")
        T.git(seed, "push", "--quiet", self.origin, "HEAD:refs/heads/dev")
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertEqual(T.git(self.folder(), "rev-parse", "HEAD"), new)

    def test_github_unreachable_starts_from_the_mirror_and_says_so(self):
        self.call(lambda _: self.M.refresh(FULL), [])
        os.remove(os.path.join(self.tmp, "github.com", "special-place-ai-heaven", "rerun.git"))
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn("base from the mirror at", out)

    def test_github_unreachable_and_no_mirror_is_transient(self):
        os.remove(os.path.join(self.tmp, "github.com", "special-place-ai-heaven", "rerun.git"))
        code, out = self.new()
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: ", out)
        self.assertFalse(os.path.exists(self.folder()))

    def test_no_token_lands_in_the_clone(self):
        code, out = self.new()
        self.assertEqual(code, 0, out)
        g = os.path.join(self.folder(), ".git")
        for f in ("config", "FETCH_HEAD", "packed-refs"):
            if os.path.isfile(os.path.join(g, f)):
                with open(os.path.join(g, f)) as fh:
                    self.assertIsNone(TOKEN.search(fh.read()), f)
        self.assertIsNone(TOKEN.search(T.git(self.folder(), "remote", "-v")))

    def test_a_second_run_on_a_ready_clone_says_exists(self):
        self.new()
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assertIn("EXISTS ", out)

    def test_a_live_lease_of_another_run_is_transient_and_changes_nothing(self):
        os.makedirs(os.path.join(F.STATE, "jobs"))
        with open(os.path.join(F.STATE, "jobs", "rerun-7-1.owner"), "w") as f:
            json.dump({"run": "run-b", "since": "2026-11-16T10:00:00Z"}, f)
        with open(os.path.join(F.STATE, "jobs", "rerun-7-1.lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            t = time.time()
            code, out = self.new()
        self.assertEqual(code, 3, out)
        self.assertIn("owned by run run-b since 2026-11-16T10:00:00Z", out)
        self.assertLess(time.time() - t, 30)
        self.assertFalse(os.path.exists(self.folder()))

    def test_the_ceiling_refuses_a_new_folder(self):
        for c in ("2", "3"):
            os.makedirs(self.folder(c))
        with mock.patch.object(self.C, "CEILING", 2):
            code, out = self.call(lambda _: self.C.new(FULL, "7", "1", None, "t", "main"), [])
        self.assertEqual(code, 2, out)
        self.assertIn("ceiling of 2 job folders", out)

    def test_eight_at_once_all_finish_and_share_nothing(self):
        go = os.path.join(self.tmp, "go")
        ps = [self.spawn(str(i), T_GO=go) for i in range(1, 9)]
        time.sleep(1)
        open(go, "w").close()
        outs = [(p.communicate(180)[0], p.returncode) for p in ps]
        for out, code in outs:
            self.assertEqual(code, 0, out)
        dirs = [self.folder(str(i)) for i in range(1, 9)]
        for i, p in enumerate(dirs, 1):
            self.assert_ready(p, chunk=str(i))
        self.assertEqual(len({os.path.realpath(os.path.join(p, ".git")) for p in dirs}), 8)
        self.assertFalse(os.path.exists(os.path.join(F.STATE, "builders.lock")))


class KillAtEveryStep(CloneCase):
    def check(self, **kill):
        code, out = self.new(**kill)
        self.assertIn(code, (137, -9), out)
        code, out = self.new()
        self.assertEqual(code, 0, out)
        self.assert_ready(self.folder())

    def test_killed_after_the_clone(self):
        self.check(T_KILL="cloned")

    def test_killed_after_the_origin_is_set(self):
        self.check(T_KILL="origin")

    def test_killed_after_the_fetch(self):
        self.check(T_KILL="fetched")

    def test_killed_after_the_branch(self):
        self.check(T_KILL="branched")

    def test_killed_before_the_rename_leaves_nothing_visible(self):
        code, out = self.new(T_KILL="branched")
        self.assertEqual(code, 137, out)
        self.assertFalse(os.path.exists(self.folder()))

    def test_killed_after_the_rename(self):
        self.check(T_KILL="renamed")

    def test_killed_during_the_dependency_install(self):
        self.check(T_KILL_PNPM="1")

    def test_killed_after_the_install_before_the_stamp(self):
        self.check(T_KILL="installed")
