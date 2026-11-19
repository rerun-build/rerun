import os, re, subprocess, sys, unittest
import test_clone_new as N

T = N.T
F = T.F
FULL = N.FULL
DRIVER = N.DRIVER.replace(', "--clone"])', '])')
HERE = os.path.dirname(os.path.abspath(__file__))
GONE = ("builders.lock", "builder_lock", "cap_check", "max_builders", "MAX_BUILDERS", "LOCK_WAIT_S", "LOCK_STALE_S", '"worktree", "add')


def shipped():
    found = []
    for d in (HERE, os.path.join(HERE, "bin"), os.path.join(HERE, "triggers")):
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            path = os.path.join(d, name)
            if not os.path.isfile(path) or name.startswith("test_") or name.endswith(".pyc"):
                continue
            if name.endswith(".md") and os.path.basename(d) != "triggers":
                continue
            found.append(path)
    return found


def read(path):
    with open(path, "rb") as f:
        return f.read().decode("utf-8", "replace")


class NoSharedLock(unittest.TestCase):
    def test_the_shared_clone_lock_and_the_tool_cap_are_gone(self):
        names = [os.path.basename(p) for p in shipped()]
        self.assertIn("factory.py", names)
        self.assertIn("sense.py", names)
        hits = []
        for path in shipped():
            text = read(path)
            for word in GONE:
                if word in text:
                    hits.append("%s: %s" % (os.path.basename(path), word))
        self.assertEqual(hits, [])

    def test_every_lock_left_in_the_tools_never_waits(self):
        seen = 0
        for path in shipped():
            for line in read(path).splitlines():
                if "fcntl.flock(" in line:
                    seen += 1
                    self.assertIn("LOCK_NB", line, "%s: %s" % (os.path.basename(path), line))
                if re.search(r"(?<![\w.])flock\s", line):
                    self.assertTrue(re.search(r"(?<![\w.])flock\s+-n\b", line), "%s: %s" % (os.path.basename(path), line))
        self.assertGreaterEqual(seen, 1)


FAKE_GH = """#!/bin/sh
case "$1" in
  pr) echo '[{"number": 9, "url": "https://github.com/FULL/pull/9", "headRefOid": "0000000"}]' ;;
  api) case "$2" in
         *actions/runs*) echo '{"workflow_runs": []}' ;;
         *) echo '{"body": ""}' ;;
       esac ;;
  *) exit 1 ;;
esac
"""


class FixOnAnOldWorktree(T.FactoryCase):
    def test_a_fix_on_an_old_green_worktree_pushes_without_any_lock(self):
        p = self.wt(chunk="1")
        sha = self.commit(p)
        open(F.marker(T.REPO, "chunk/7-1"), "w").close()
        with open(os.path.join(F.STATE, "builders.lock"), "w") as f:
            f.write("%d %d\n" % (os.getpid(), 0))
        gh = os.path.join(self.tmp, "fake-gh")
        with open(gh, "w") as f:
            f.write(FAKE_GH.replace("FULL", FULL))
        os.chmod(gh, 0o755)
        saved_gh = F.GH
        self.addCleanup(setattr, F, "GH", saved_gh)
        F.GH = gh
        link = os.path.join(self.tmp, "github.com", FULL + ".git")
        os.makedirs(os.path.dirname(link))
        os.symlink(self.origin, link)
        T.git(p, "remote", "set-url", "origin", "file://" + link)
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(p)
        code, out = self.call(F.cmd_pr_open, ["--fix"])
        self.assertEqual(code, 0, out)
        self.assertIn("PUSHED fix to", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), sha)
        self.assertFalse(os.path.exists(F.marker(T.REPO, "chunk/7-1")))


class WtNewInWorktreeMode(N.CloneCase):
    def spawn(self, chunk="1", issue="7", **extra):
        env = dict(self.env, T_ISSUE=issue, T_CHUNK=chunk, **extra)
        return subprocess.Popen([sys.executable, "-I", "-c", DRIVER], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def test_wt_new_without_a_flag_makes_a_clone_straight_from_github_in_worktree_mode(self):
        self.assertNotEqual(DRIVER, N.DRIVER)
        self.call(lambda _: self.M.refresh(FULL), [])
        self.assertEqual(self.C.mode(), "worktree")
        code, out = self.new(T_KILL="cloned")
        self.assertIn(code, (137, -9), out)
        half = os.path.join(self.C.tmp_root(), "rerun-7-1")
        self.assertEqual(T.git(half, "remote", "get-url", "origin").strip(), self.github + FULL + ".git")
        code, out = self.new()
        self.assertEqual(code, 0, out)
        folder = self.folder()
        self.assert_ready(folder)
        self.assertEqual(T.git(folder, "rev-parse", "HEAD").strip(), self.remote_sha("refs/heads/dev").strip())
        self.assertEqual(len(T.git(self.clone, "worktree", "list").strip().splitlines()), 1)
