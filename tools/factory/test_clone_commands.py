import contextlib, os, subprocess, unittest
from unittest import mock

import test_factory as T
from test_clone_new import CloneCase, FULL
from test_propen_paths import issue_json

F = T.F


class CloneCommands(CloneCase):
    def ready_clone(self, chunk="1"):
        code, out = self.new(chunk)
        self.assertEqual(code, 0, out)
        p = self.folder(chunk)
        for k, v in (("user.name", "t"), ("user.email", "t@localhost"), ("commit.gpgsign", "false")):
            T.git(p, "config", k, v)
        return p

    @contextlib.contextmanager
    def inside(self, p, fix=False):
        real_run = F.run
        body = os.path.join(self.tmp, "body.md")
        T.write(self.tmp, "body.md", "\n".join(F.PR_HEADS) + "\n")

        def fake_run(cmd, *a, **k):
            if cmd[0] != F.GH:
                return real_run(cmd, *a, **k)
            if cmd[1] == "api":
                return subprocess.CompletedProcess(cmd, 0, issue_json([], "SMALL FIX"), "")
            if cmd[1:3] == ["pr", "list"]:
                return subprocess.CompletedProcess(cmd, 0, '[{"number": 9, "url": "https://github.com/%s/pull/9"}]' % FULL if fix else "[]", "")
            return subprocess.CompletedProcess(cmd, 0, "https://github.com/%s/pull/9\n" % FULL, "")
        cwd = os.getcwd()
        os.chdir(p)
        try:
            with mock.patch.object(F, "run", fake_run):
                yield ["--fix"] if fix else ["--title", "t", "--body-file", body]
        finally:
            os.chdir(cwd)

    def pr_open(self, p, fix=False):
        with self.inside(p, fix) as argv:
            return self.call(F.cmd_pr_open, argv)

    def move_dev(self, name, text):
        seed = os.path.join(self.tmp, "seed")
        T.git(seed, "pull", "--quiet", self.origin, "dev")
        self.commit(seed, name, text)
        T.git(seed, "push", "--quiet", self.origin, "HEAD:refs/heads/dev")

    def test_an_old_worktree_and_a_clone_both_push_a_fix(self):
        T.git(self.clone, "remote", "set-url", "origin", self.github + FULL + ".git")
        old = self.wt(issue="7", chunk="2")
        self.commit(old, "old.txt")
        T.git(old, "push", "--quiet", "origin", "chunk/7-2")
        new = self.ready_clone("1")
        self.commit(new, "new.txt")
        T.git(new, "push", "--quiet", "origin", "chunk/7-1")
        for p, br in ((old, "chunk/7-2"), (new, "chunk/7-1")):
            sha = self.commit(p, "fix.txt", "fix of %s\n" % br)
            code, out = self.pr_open(p, fix=True)
            self.assertEqual(code, 0, out)
            self.assertIn("PUSHED fix to " + br, out)
            self.assertEqual(self.remote_sha("refs/heads/" + br), sha)

    def test_a_clone_without_the_ready_stamp_refuses(self):
        p = self.ready_clone()
        os.remove(os.path.join(p, ".git", "factory-ready"))
        self.commit(p, "a.txt")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("was not finished. Run `wt new rerun 7 1` again", out)

    def test_a_clone_whose_origin_is_not_github_refuses_before_the_push(self):
        p = self.ready_clone()
        T.git(p, "remote", "set-url", "origin", os.path.join(self.tmp, "elsewhere.git"))
        self.commit(p, "a.txt")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("origin of this clone is", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_branch_behind_dev_gets_dev_merged_in_first(self):
        p = self.ready_clone()
        self.commit(p, "a.txt")
        self.move_dev("b.txt", "dev moved\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 0, out)
        self.assertIn("MERGED origin/dev into chunk/7-1 first", out)
        head = self.remote_sha("refs/heads/chunk/7-1")
        self.assertEqual(T.git(p, "merge-base", "--is-ancestor", self.remote_sha("refs/heads/dev"), head, check=False), "")

    def test_a_conflict_with_dev_aborts_the_merge_and_pushes_nothing(self):
        p = self.ready_clone()
        self.commit(p, "same.txt", "mine\n")
        self.move_dev("same.txt", "theirs\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("CONFLICT: dev moved and conflicts with this branch in same.txt", out)
        self.assertFalse(os.path.exists(os.path.join(p, ".git", "MERGE_HEAD")))
        self.assertEqual(T.git(p, "status", "--porcelain"), "")
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_an_automatic_merge_cut_off_earlier_is_cleared(self):
        p = self.ready_clone()
        self.commit(p, "a.txt")
        self.move_dev("b.txt", "dev moved\n")
        T.git(p, "fetch", "--quiet", "origin", "dev")
        T.git(p, "merge", "--no-commit", "--no-ff", "origin/dev")
        open(os.path.join(p, ".git", "factory-merging"), "w").close()
        code, out = self.pr_open(p)
        self.assertEqual(code, 0, out)
        self.assertIn("cleared an automatic merge of dev that was cut off earlier", out)
        self.assertTrue(self.remote_sha("refs/heads/chunk/7-1"))

    def test_the_shape_of_a_token_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "leak.txt", "key = " + "ghp" + "_" + "A" * 36 + "\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in leak.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def merge_dev(self, pr):
        def fake_api(path, *a, **k):
            return [] if path.endswith("/files?per_page=100") else {"default_branch": "main"} if path == "repos/" + FULL else pr
        with mock.patch.object(F, "api", fake_api):
            return self.call(F.cmd_merge_dev, [T.REPO, "9"])

    def test_merge_dev_on_a_pull_request_merged_earlier_says_so_and_exits_0(self):
        p = self.ready_clone()
        pr = {"base": {"ref": "dev"}, "head": {"ref": "chunk/7-1", "sha": "1" * 40}, "state": "closed", "merged": True,
              "draft": False, "merge_commit_sha": "abcdef12" + "0" * 32}
        code, out = self.merge_dev(pr)
        self.assertEqual(code, 0, out)
        self.assertIn("MERGED earlier as abcdef12", out)
        self.assertTrue(os.path.isdir(p))

    def test_the_whole_chain_on_a_clone(self):
        p = self.ready_clone()
        self.commit(p, "a.txt")
        code, out = self.pr_open(p)
        self.assertEqual(code, 0, out)
        sha = self.commit(p, "b.txt")
        code, out = self.pr_open(p, fix=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), sha)
        pr = {"base": {"ref": "dev"}, "head": {"ref": "chunk/7-1", "sha": sha}, "state": "closed", "merged": True, "draft": False, "merge_commit_sha": "f" * 40}
        code, out = self.merge_dev(pr)
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.isdir(p))
