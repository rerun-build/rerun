import unittest

import planning

ISSUE = {"number": 612, "title": "Floor: show the queue", "body": "SECRET BODY"}
REPO = "o/rerun"


class BriefTest(unittest.TestCase):
    def setUp(self):
        self.text = planning.brief(ISSUE, REPO)

    def test_first_line_names_job(self):
        self.assertIn('rerun #612, "Floor: show the queue"', self.text)
        self.assertIn("call no other coworker and send no question to Rob", self.text)

    def test_reads_issue_without_copying_body(self):
        self.assertIn("gh issue view 612 -R o/rerun", self.text)
        self.assertNotIn("SECRET BODY", self.text)

    def test_cut_format(self):
        for part in (
            "PLAN READY (cut of #612; facts read on dev at <sha>)",
            "**Part of**: #612",
            "**Worker**: coder",
            "**Test file**",
            "**Files**",
            "**Change**",
            "**Done-test**",
            "**Run**",
            "**Depends on**",
        ):
            self.assertIn(part, self.text)

    def test_label_sentence(self):
        self.assertIn("Do not label a child `factory` and do not touch the label `factory-plan`: the dispatcher does both.", self.text)

    def test_last_line(self):
        self.assertTrue(self.text.endswith("or `BLOCKED: <one sentence>` when the issue cannot be cut."))
        self.assertIn("CUT: #a, #b", self.text)

    def test_the_plan_brief_asks_for_every_ask_in_a_slice_or_out_of_scope(self):
        text = planning.plan_brief(ISSUE, REPO)
        self.assertIn("Number every ask of the issue", text)
        self.assertIn("Does every numbered ask stand in a slice or under Out of scope?", text)

    def test_no_comments_rule(self):
        self.assertIn("add no comments in code", self.text)

    def test_length(self):
        self.assertLess(len(self.text), 3000)


if __name__ == "__main__":
    unittest.main()
