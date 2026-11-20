import dispatch as D
import factory
import planning
import states
from test_dispatch import ACCEPT, HEAD, Base, ready, wf
import unittest


def option(call, key):
    return call[call.index(key) + 1]


class ProvenTest(Base):
    def setUp(self):
        super().setUp()
        self.w.issues[0]["body"] = ready("**Proven branch**: plan/5")
        self.w.branches = {"plan/5": "sha5aaaaaaaaaaa"}
        self.w.compare_files = ["a/b.py"]

    def pr_creates(self):
        return [c for c in self.w.gh_calls if c[:2] == ["pr", "create"]]

    def log_text(self):
        return self.out.getvalue()

    def test_a_proven_job_starts_no_build_run_and_gets_a_pull_request_from_its_branch(self):
        self.tick()
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.state(), "review_wait")
        job = self.d.store.get_job("5")
        self.assertEqual(job["pr"], 42)
        self.assertEqual(job["proven"], "sha5aaaaaaaaaaa")
        self.assertIn(["api", "-X", "POST", "repos/o/r/git/refs", "-f", "ref=refs/heads/chunk/5-p", "-f", "sha=sha5aaaaaaaaaaa"], self.w.gh_calls)
        creates = self.pr_creates()
        self.assertEqual(len(creates), 1)
        self.assertEqual(option(creates[0], "--base"), "dev")
        self.assertEqual(option(creates[0], "--head"), "chunk/5-p")
        self.assertEqual(option(creates[0], "--title"), "Fix x (#5)")
        body = option(creates[0], "--body")
        self.assertTrue(body.startswith("Job: o/r#5, chunk p\n\n"))
        self.assertIn("plan/5", body)
        for heading in factory.PR_HEADS:
            self.assertIn(heading, body)
        self.assertTrue(body.rstrip().endswith("Closes #5"))

    def test_a_proven_job_whose_branch_creation_fails_still_gets_its_pull_request(self):
        gh = self.w.gh

        def refs_fail(args):
            if args[0] == "api" and "-X" in args and any(x.endswith("/git/refs") for x in args):
                raise D.Error("gh api failed: exit 1: Reference already exists")
            return gh(args)

        self.w.gh = refs_fail
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        job = self.d.store.get_job("5")
        self.assertEqual(job["pr"], 42)
        self.assertEqual(job["head_branch"], "chunk/5-p")
        self.assertEqual(len(self.pr_creates()), 1)
        self.assertIn("branch chunk/5-p not made, so it is moved to sha5aaa", self.log_text())

    def test_the_proven_job_goes_through_review_checks_and_proof_and_merges(self):
        self.tick(2)
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.w.sends[0][0], "r1")
        self.assertIn("pull request #42 of rerun, for job #5", self.w.sends[0][1])
        self.w.finish("r1", ACCEPT)
        self.tick()
        self.assertEqual(self.state(), "checks")
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick(3)
        self.assertEqual(self.w.merges, [["pr", "merge", "42", "-R", "o/r", "--merge", "--match-head-commit", HEAD, "--delete-branch"]])
        self.assertEqual(self.state(), "merged")
        self.assertEqual(len(self.w.sends), 1)

    def test_a_fix_round_of_a_proven_job_goes_to_a_free_builder_told_where_the_branch_is(self):
        self.tick(2)
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: wrong")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.tick()
        agent, msg, _ = self.w.sends[-1]
        self.assertIn(agent, ("b1", "b2"))
        self.assertIn("wt new rerun 5 p", msg)
        self.assertIn("git reset --hard origin/chunk/5-p", msg)
        self.assertEqual(self.state(), "fixing")
        self.assertEqual(self.d.store.get_job("5")["builder"], agent)

    def test_a_proven_branch_that_is_not_plan_of_the_issue_returns_the_job_to_the_planner(self):
        self.w.issues[0]["body"] = ready("**Proven branch**: plan/9")
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.sends, [])
        self.assertIn("plan: **Proven branch** names plan/9, not plan/5", self.log_text())

    def test_a_missing_proven_branch_returns_the_job_to_the_planner(self):
        self.w.branches = {}
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.sends, [])
        self.assertIn("plan: the proven branch plan/5 is not on GitHub", self.log_text())

    def test_a_proven_branch_with_a_file_outside_files_returns_the_job(self):
        self.w.compare_files = ["a/b.py", "c/d.py"]
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.sends, [])
        self.assertIn("c/d.py", self.log_text())
        self.assertEqual(self.pr_creates(), [])

    def test_a_returned_proven_job_is_not_told_its_pull_request_was_right(self):
        self.w.branches = {}
        self.tick()
        brief = D.replan_brief(self.d.store.get_job("5"), "o/r", 1)
        self.assertIn("plan/5 is not on GitHub", brief)
        self.assertNotIn("its diff was found right", brief)

    def test_a_job_without_the_line_is_built_as_today(self):
        self.w.issues[0]["body"] = ready()
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertEqual(self.w.sends[0][0], "b1")

    def test_a_queued_job_may_move_to_review_wait(self):
        self.assertTrue(states.allowed("queued", "review_wait"))

    def test_the_planner_brief_says_to_keep_the_proven_change_as_a_branch(self):
        text = planning.brief({"number": 612, "title": "Floor", "body": ""}, "o/rerun")
        self.assertIn("push that change as `plan/<child>`", text)
        self.assertIn("**Proven branch**: plan/<child>", text)

    def test_the_cutter_brief_keeps_the_proven_change(self):
        text = planning.cut_brief({"number": 612, "title": "Floor", "body": ""}, "o/rerun", "## Plan")
        self.assertNotIn("File none of that code", text)
        self.assertIn("once the child is filed, push it as `plan/<child>`", text)


if __name__ == "__main__":
    unittest.main()
