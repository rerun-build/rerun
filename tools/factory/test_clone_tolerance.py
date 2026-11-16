import os, shutil, subprocess, tempfile, unittest
from unittest import mock

import test_factory as T

F = T.F
git, write = T.git, T.write

KEEP_LINE = "KEEP   rerun/8-1  a job clone, not a worktree of the shared clone"


class CloneCase(T.FactoryCase):
    def job_clone(self):
        path = os.path.join(F.WT, T.REPO, "8-1")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        git(self.tmp, "clone", "--quiet", self.origin, path)
        for k, v in (("user.name", "t"), ("user.email", "t@localhost"), ("commit.gpgsign", "false")):
            git(path, "config", k, v)
        git(path, "checkout", "--quiet", "-b", "chunk/8-1")
        self.commit(path, "only-here.txt", "x\n")
        return path

    def sweep(self, *argv):
        with mock.patch.object(F, "pr_lookup", lambda full, branch: []):
            return self.call(F.cmd_wt, ["sweep"] + list(argv))


class CloneTolerance(CloneCase):
    def test_sweep_keeps_a_clone_whose_commit_the_shared_clone_lacks(self):
        path = self.job_clone()
        code, out = self.sweep()
        self.assertEqual(code, 0, out)
        self.assertIn(KEEP_LINE, out.splitlines())
        code, out = self.sweep("--apply")
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.isdir(path))

    def test_sweep_still_reads_a_worktree_beside_a_clone(self):
        self.job_clone()
        wt = self.wt(chunk="1")
        code, out = self.sweep()
        self.assertEqual(code, 0, out)
        self.assertIn(KEEP_LINE, out.splitlines())
        self.assertTrue(any(l.split()[:2] == ["KEEP", "rerun/7-1"] or l.split()[:2] == ["REMOVE", "rerun/7-1"] for l in out.splitlines()), out)
        self.assertTrue(os.path.isdir(wt))

    def test_wt_done_on_a_clone_refuses_and_deletes_nothing(self):
        path = self.job_clone()
        head = git(path, "rev-parse", "HEAD")
        code, out = self.call(F.cmd_wt, ["done", "rerun", "8", "1"])
        self.assertEqual(code, 2, out)
        self.assertIn("REFUSED: ", out)
        self.assertIn("is a job clone", out)
        self.assertTrue(os.path.isdir(path))
        self.assertEqual(git(path, "rev-parse", "HEAD"), head)

    def test_a_contains_error_means_unprovable(self):
        path = self.job_clone()
        self.assertIsNone(F.unsaved(self.clone, path, "chunk/8-1"))

    def test_the_marker_is_set(self):
        self.assertEqual(F.CLONE_SAFE, 1)


class InstallMarker(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="clone-install-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.tree = os.path.join(self.tmp, "tree")
        shutil.copytree(os.path.dirname(os.path.abspath(__file__)), self.tree, ignore=shutil.ignore_patterns("__pycache__", "test_*"))
        self.prefix = os.path.join(self.tmp, "prefix")

    def install(self):
        return subprocess.run(["sh", os.path.join(self.tree, "install.sh"), "--prefix", self.prefix, "--jev-keyfile", "/nonexistent-key"],
                              capture_output=True, text=True)

    def test_a_tree_without_the_marker_is_refused_and_nothing_is_written(self):
        fp = os.path.join(self.tree, "factory.py")
        with open(fp) as f:
            text = f.read()
        with open(fp, "w") as f:
            f.write(text.replace("CLONE_SAFE = 1\n", ""))
        r = self.install()
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("REFUSED: ", r.stdout + r.stderr)
        self.assertFalse(os.path.exists(self.prefix))

    def test_a_tree_with_the_marker_installs(self):
        r = self.install()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.prefix, "factory", "factory.py")))


if __name__ == "__main__":
    unittest.main()
