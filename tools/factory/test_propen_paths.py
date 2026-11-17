import json, os, subprocess, unittest
from unittest import mock
from test_factory import FactoryCase, FULL, F, git, write


def issue_json(files, text=None):
    if text is None:
        text = "PLAN READY\n\n**Files**\n" + "".join("- `%s`\n" % f for f in files) + "\n**Depends on**: none\n"
    return json.dumps({"number": 7, "body": text})


class PrOpenPaths(FactoryCase):
    def open_pr(self, files, issue_body=None, fix=False, readable=True, commits=("work.txt", "other.txt"), note=""):
        p = self.wt(issue="7", chunk="1")
        for name in commits:
            os.makedirs(os.path.dirname(os.path.join(p, name)), exist_ok=True)
            self.commit(p, name)
        body = os.path.join(self.tmp, "body.md")
        write(self.tmp, "body.md", "\n".join(F.PR_HEADS) + "\n" + note)
        real_run = F.run

        def fake_run(cmd, *a, **k):
            if cmd[0] != F.GH:
                return real_run(cmd, *a, **k)
            if cmd[1] == "api":
                if not readable:
                    return subprocess.CompletedProcess(cmd, 1, "", "boom")
                return subprocess.CompletedProcess(cmd, 0, issue_json(files, issue_body), "")
            if cmd[1] == "pr" and cmd[2] == "list":
                out = '[{"number": 9, "url": "https://github.com/%s/pull/9"}]' % FULL if fix else "[]"
                return subprocess.CompletedProcess(cmd, 0, out, "")
            return subprocess.CompletedProcess(cmd, 0, "https://github.com/%s/pull/9\n" % FULL, "")

        ctx = (p, FULL, "chunk/7-1", "dev", "7", "1")
        argv = ["--fix"] if fix else ["--title", "t", "--body-file", body]
        with mock.patch.object(F, "wt_context", lambda: ctx), mock.patch.object(F, "run", fake_run):
            return self.call(F.cmd_pr_open, argv)

    def test_a_file_outside_the_issue_files_refuses_before_the_push(self):
        code, out = self.open_pr(["work.txt"])
        self.assertEqual(code, 2, out)
        self.assertIn("outside the **Files**", out)
        self.assertIn("other.txt", out)
        self.assertNotIn("work.txt", out.split("outside the **Files**")[1])
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_a_fix_round_with_a_file_outside_refuses_before_the_push(self):
        code, out = self.open_pr(["work.txt"], fix=True)
        self.assertEqual(code, 2, out)
        self.assertIn("other.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_an_unreadable_issue_refuses(self):
        code, out = self.open_pr(["work.txt"], readable=False)
        self.assertEqual(code, 2, out)
        self.assertIn("could not read issue #7", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_files_inside_the_issue_files_and_folders_open_the_pr(self):
        code, out = self.open_pr(["work.txt", "docs/"], commits=("work.txt", "docs/a.md"))
        self.assertEqual(code, 0, out)
        self.assertNotEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def on_dev(self, name):
        seed = self.make_clone("seed2")
        git(seed, "checkout", "--quiet", "-B", "dev", "origin/dev")
        os.makedirs(os.path.dirname(os.path.join(seed, name)), exist_ok=True)
        write(seed, name, "old" + chr(10))
        git(seed, "add", "-A")
        git(seed, "commit", "--quiet", "-m", "old test")
        git(seed, "push", "--quiet", self.origin, "HEAD:refs/heads/dev")
        git(self.clone, "fetch", "--quiet", "origin")

    def adapted(self, *names):
        return "## Tests adapted" + chr(10) + "".join("- `%s`: the change renames what it asserts%s" % (n, chr(10)) for n in names)

    def test_an_existing_test_the_note_lists_as_adapted_may_change_outside_the_files(self):
        self.on_dev("a/test_old.py")
        code, out = self.open_pr(["work.txt"], commits=("work.txt", "a/test_old.py"), note=self.adapted("a/test_old.py"))
        self.assertEqual(code, 0, out)
        self.assertNotEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_an_existing_test_the_note_does_not_list_is_refused(self):
        self.on_dev("a/test_old.py")
        code, out = self.open_pr(["work.txt"], commits=("work.txt", "a/test_old.py"))
        self.assertEqual(code, 2, out)
        self.assertIn("a/test_old.py", out)
        self.assertIn("## Tests adapted", out)

    def test_listing_does_not_let_a_new_test_or_another_file_through(self):
        self.on_dev("a/test_old.py")
        code, out = self.open_pr(["work.txt"], commits=("work.txt", "a/test_new.py", "other.txt"), note=self.adapted("a/test_new.py", "other.txt"))
        self.assertEqual(code, 2, out)
        self.assertIn("a/test_new.py", out)
        self.assertIn("other.txt", out)
        self.assertEqual(self.remote_sha("refs/heads/chunk/7-1"), "")

    def test_an_issue_without_files_puts_no_rule(self):
        code, out = self.open_pr([], issue_body="SMALL FIX", commits=("other.txt",))
        self.assertEqual(code, 0, out)
        self.assertNotEqual(self.remote_sha("refs/heads/chunk/7-1"), "")


if __name__ == "__main__":
    unittest.main()
