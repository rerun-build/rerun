from test_dispatch import Base, ready
import unittest


class ProvenGuards(Base):
    def setUp(self):
        super().setUp()
        self.w.issues[0]["body"] = ready("**Proven branch**: plan/5")
        self.w.branches = {"plan/5": "sha5aaaaaaaaaaa"}
        self.w.compare_files = ["a/b.py"]

    def pr_creates(self):
        return [c for c in self.w.gh_calls if c[:2] == ["pr", "create"]]

    def log_text(self):
        return self.out.getvalue()

    def test_a_proven_branch_that_changes_a_workflow_file_returns_the_job(self):
        self.w.issues[0]["body"] = self.w.issues[0]["body"].replace("`a/b.py`", "`.github/`")
        self.w.compare_files = [".github/workflows/ci.yml"]
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.pr_creates(), [])
        self.assertIn("workflow files", self.log_text())

    def test_a_proven_branch_with_an_ai_trailer_returns_the_job(self):
        self.w.compare_messages = ["fix x\n\nCo-Authored-By: someone <a@b.c>"]
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.pr_creates(), [])
        self.assertIn("AI trailer", self.log_text())

    def test_a_proven_branch_with_the_shape_of_a_token_returns_the_job(self):
        token = "gh" + "p_" + "A" * 36
        self.w.compare_patches = ["+token = " + token]
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.pr_creates(), [])
        self.assertIn("shape of a GitHub token", self.log_text())
        self.assertNotIn(token, self.log_text())

    def test_an_existing_chunk_branch_is_moved_to_the_proven_sha(self):
        self.w.ref_exists = True
        self.tick()
        self.assertIn(["api", "-X", "PATCH", "repos/o/r/git/refs/heads/chunk/5-p", "-f", "sha=sha5aaaaaaaaaaa", "-F", "force=true"], self.w.gh_calls)
        self.assertEqual(self.state(), "review_wait")

    def test_a_chunk_branch_that_cannot_be_moved_blocks_the_job_without_a_pull_request(self):
        self.w.ref_exists = True
        self.w.patch_error = "gh api failed: exit 1: HTTP 422"
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertEqual(self.pr_creates(), [])

    def test_a_pull_request_left_open_by_a_crash_is_taken_over(self):
        self.w.pr_create_error = "gh pr create failed: exit 1: network"
        self.w.open_prs = [{"number": 77}]
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertEqual(self.d.store.get_job("5")["pr"], 77)

    def test_a_pull_request_that_cannot_be_opened_blocks_the_job_once(self):
        self.w.pr_create_error = "gh pr create failed: exit 1: network"
        self.tick(2)
        self.assertEqual(self.state(), "blocked")
        self.assertEqual(len(self.pr_creates()), 1)
        self.assertEqual(self.w.sends, [])

    def test_a_github_error_reading_the_branch_leaves_the_job_queued(self):
        self.w.ref_error = "gh api failed: exit 1: HTTP 502"
        self.tick()
        self.assertEqual(self.state(), "queued")
        self.assertEqual(self.pr_creates(), [])
        self.w.ref_error = None
        self.tick()
        self.assertEqual(self.state(), "review_wait")


if __name__ == "__main__":
    unittest.main()
