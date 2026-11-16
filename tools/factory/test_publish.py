import os, subprocess, tempfile, unittest

import json
import publish
import runner_loop
import store


def git(cwd, *a):
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Publish(unittest.TestCase):
    def test_push_bare_remote_and_pr_call(self):
        d = tempfile.mkdtemp()
        bare, wt = os.path.join(d, "r.git"), os.path.join(d, "wt")
        git(d, "init", "-q", "--bare", "-b", "dev", bare)
        git(d, "init", "-q", "-b", "dev", wt)
        git(wt, "remote", "add", "origin", bare)
        for k, v in (("user.name", "t"), ("user.email", "t@x")):
            git(wt, "config", k, v)
        with open(os.path.join(wt, "a.txt"), "w") as f:
            f.write("1")
        git(wt, "add", "."); git(wt, "commit", "-qm", "base")
        with open(os.path.join(wt, "a.txt"), "w") as f:
            f.write("2")
        calls = []
        sha = publish.publish(wt, 71, "C6e: x", "dev", lambda *a: calls.append(a) or "url", ["a.txt"])
        self.assertEqual(git(bare, "rev-parse", "factory/job-71"), sha)
        self.assertEqual(calls, [("C6e: x", "factory/job-71", "dev", "")])

    def test_body_lists_each_chunk_with_receipt(self):
        got = publish.body("o/r#71", {"B": {"verdict": "ok", "base": 1, "head": 0}, "A": {"verdict": "ok", "base": 2, "head": 0}})
        self.assertEqual(got.splitlines(), ["Job: o/r#71, chunk A, B",
                                            "Receipt A: done-test ok (base exit 2, head exit 0)",
                                            "Receipt B: done-test ok (base exit 1, head exit 0)"])

    def test_body_lists_only_unmerged_chunks_of_this_pr(self):
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            for c in ("A", "B"):
                st.add_ready("71", c, ["x"], "", [])
                st.set("71", "receipt:" + c, json.dumps({"verdict": "ok", "base": 1, "head": 0}))
            st.set_ready_state("71", "A", "merged")
            got = publish.body("o/r#71", runner_loop.unmerged_receipts(st, "71"))
            self.assertEqual(got.splitlines(), ["Job: o/r#71, chunk B", "Receipt B: done-test ok (base exit 1, head exit 0)"])
            st.close()

    def test_file_outside_paths_refused(self):
        d = tempfile.mkdtemp()
        bare, wt = os.path.join(d, "r.git"), os.path.join(d, "wt")
        git(d, "init", "-q", "--bare", "-b", "dev", bare)
        git(d, "init", "-q", "-b", "dev", wt)
        git(wt, "remote", "add", "origin", bare)
        for k, v in (("user.name", "t"), ("user.email", "t@x")):
            git(wt, "config", k, v)
        with open(os.path.join(wt, "a.txt"), "w") as f:
            f.write("1")
        git(wt, "add", "."); git(wt, "commit", "-qm", "base")
        for n in ("a.txt", "new.txt"):
            with open(os.path.join(wt, n), "w") as f:
                f.write("2")
        calls = []
        with self.assertRaises(ValueError):
            publish.publish(wt, 71, "t", "dev", lambda *a: calls.append(a), ["a.txt"])
        self.assertEqual((calls, git(wt, "rev-list", "--count", "HEAD"), git(bare, "branch")), ([], "1", ""))

    def _repo(self):
        d = tempfile.mkdtemp()
        bare, wt = os.path.join(d, "r.git"), os.path.join(d, "wt")
        git(d, "init", "-q", "--bare", "-b", "dev", bare)
        git(d, "init", "-q", "-b", "dev", wt)
        git(wt, "remote", "add", "origin", bare)
        for k, v in (("user.name", "t"), ("user.email", "t@x")):
            git(wt, "config", k, v)
        with open(os.path.join(wt, "a.txt"), "w") as f:
            f.write("1")
        git(wt, "add", "."); git(wt, "commit", "-qm", "base")
        return bare, wt

    def test_a_staged_rename_of_declared_paths_is_published(self):
        bare, wt = self._repo()
        git(wt, "mv", "a.txt", "b.txt")
        calls = []
        sha = publish.publish(wt, 71, "t", "dev", lambda *a: calls.append(a), ["a.txt", "b.txt"])
        self.assertEqual(git(bare, "rev-parse", "factory/job-71"), sha)
        self.assertEqual(git(bare, "ls-tree", "--name-only", "factory/job-71"), "b.txt")
        self.assertEqual(len(calls), 1)

    def test_a_declared_path_never_created_is_refused_before_anything(self):
        bare, wt = self._repo()
        with open(os.path.join(wt, "a.txt"), "w") as f:
            f.write("2")
        calls = []
        with self.assertRaises(ValueError) as ctx:
            publish.publish(wt, 71, "t", "dev", lambda *a: calls.append(a), ["a.txt", "nope.txt"])
        self.assertIn("never created", str(ctx.exception))
        self.assertIn("nope.txt", str(ctx.exception))
        self.assertEqual((calls, git(wt, "rev-list", "--count", "HEAD"), git(bare, "branch")), ([], "1", ""))
