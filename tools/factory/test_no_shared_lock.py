import os, subprocess, sys

import test_clone_new as N

T = N.T
FULL = N.FULL
DRIVER = N.DRIVER.replace(', "--clone"])', '])')


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
