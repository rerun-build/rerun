import contextlib, os, subprocess
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

    def test_a_token_added_in_one_commit_and_removed_in_the_next_still_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "leak.txt", "key = " + "ghp" + "_" + "A" * 36 + "\n")
        self.commit(p, "leak.txt", "key = from the environment\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in leak.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_token_typed_into_a_hand_resolved_merge_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "same.txt", "mine\n")
        self.move_dev("same.txt", "theirs\n")
        T.git(p, "fetch", "--quiet", "origin", "dev")
        T.git(p, "merge", "--quiet", "origin/dev", check=False)
        T.write(p, "same.txt", "key = " + "ghp" + "_" + "C" * 36 + "\n")
        T.git(p, "add", "same.txt")
        T.git(p, "commit", "--quiet", "--no-edit")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in same.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_token_typed_into_a_merge_and_removed_in_the_next_commit_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "same.txt", "mine\n")
        self.move_dev("same.txt", "theirs\n")
        T.git(p, "fetch", "--quiet", "origin", "dev")
        T.git(p, "merge", "--quiet", "origin/dev", check=False)
        T.write(p, "same.txt", "key = " + "ghp" + "_" + "C" * 36 + "\n")
        T.git(p, "add", "same.txt")
        T.git(p, "commit", "--quiet", "--no-edit")
        self.commit(p, "same.txt", "key = from the environment\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in same.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_token_in_a_binary_file_refuses_the_push(self):
        p = self.ready_clone()
        with open(os.path.join(p, "blob.bin"), "wb") as f:
            f.write(b"\x00\xff\x00" + ("ghp" + "_" + "D" * 36).encode() + b"\x00\xfe")
        T.git(p, "add", "-A")
        T.git(p, "commit", "--quiet", "-m", "a binary file")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in blob.bin", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_token_on_a_line_that_starts_with_two_plus_signs_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "notes.txt", "++ key = " + "ghp" + "_" + "E" * 36 + "\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in notes.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_token_shape_dev_already_holds_does_not_refuse_an_edit_of_that_file(self):
        self.move_dev("fixture.txt", "first\nfake = " + "ghp" + "_" + "F" * 36 + "\n")
        p = self.ready_clone()
        self.commit(p, "fixture.txt", "second\nfake = " + "ghp" + "_" + "F" * 36 + "\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 0, out)
        self.assertTrue(self.remote_sha("refs/heads/chunk/7-1"))

    def bad_git(self, script):
        fake = os.path.join(self.tmp, "badgit")
        with open(fake, "w") as f:
            f.write("#!/bin/sh\nif [ \"$1\" = cat-file ] && [ \"$2\" = --batch ]; then %s; fi\nexec git \"$@\"\n" % script)
        os.chmod(fake, 0o755)
        return mock.patch.object(F, "GIT", fake)

    def test_a_git_that_fails_while_the_new_files_are_read_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "leak.txt", "key = " + "ghp" + "_" + "A" * 36 + "\n")
        with self.bad_git("exit 1"):
            code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the new files could not be read for the token check", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_git_cut_off_while_the_new_files_are_read_refuses_the_push(self):
        p = self.ready_clone()
        self.commit(p, "a.txt", "a\n")
        self.commit(p, "leak.txt", "key = " + "ghp" + "_" + "A" * 36 + "\n")
        with self.bad_git("git \"$@\" | head -c 60; exit 0"):
            code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the new files could not be read for the token check", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_token_in_a_commit_message_refuses_the_push(self):
        p = self.ready_clone()
        T.write(p, "a.txt", "a\n")
        T.git(p, "add", "-A")
        T.git(p, "commit", "--quiet", "-m", "use " + "ghp" + "_" + "B" * 36)
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("the shape of a GitHub token is in a commit message", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_refused_automatic_merge_commit_leaves_no_merge_behind(self):
        p = self.ready_clone()
        self.commit(p, "a.txt")
        self.move_dev("b.txt", "dev moved\n")
        hook = os.path.join(p, ".git", "hooks", "commit-msg")
        T.write(os.path.dirname(hook), "commit-msg", "#!/bin/sh\necho refused by hook >&2\nexit 1\n")
        os.chmod(hook, 0o755)
        code, out = self.pr_open(p)
        self.assertNotEqual(code, 0, out)
        self.assertFalse(os.path.exists(os.path.join(p, ".git", "MERGE_HEAD")))
        self.assertFalse(os.path.exists(os.path.join(p, ".git", "factory-merging")))
        self.assertEqual(T.git(p, "status", "--porcelain"), "")
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_branch_with_no_change_of_its_own_opens_no_pull_request(self):
        p = self.ready_clone()
        with open(os.path.join(p, ".git", "info", "exclude"), "a") as f:
            f.write("node_modules/\n")
        self.move_dev("b.txt", "dev moved\n")
        code, out = self.pr_open(p)
        self.assertEqual(code, 2, out)
        self.assertIn("no commits ahead of origin/dev", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def merge_dev(self, pr):
        def fake_api(path, *a, **k):
            return [] if path.endswith("/files?per_page=100") else {"default_branch": "main"} if path == "repos/" + FULL else pr
        with mock.patch.dict(os.environ, {"FACTORY_DISPATCHER": "1"}), mock.patch.object(F, "api", fake_api):
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
