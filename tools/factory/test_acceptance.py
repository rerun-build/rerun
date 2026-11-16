import unittest

import acceptance


def job(n, state, parent=None, pr=None, title=None):
    body = "**Depends on**: none\n"
    if parent:
        body += "**Part of**: #%d\n" % parent
    return {"issue": n, "title": title or "child %d" % n, "state": state, "pr": pr, "body": body}


PARENT = {"number": 50, "title": "Big thing", "body": "Ask one.\nAsk two."}
KIDS = [job(51, "merged", 50, 70, "first"), job(52, "superseded", 50, None, "second")]


class DueTests(unittest.TestCase):
    def test_a_parent_is_due_when_every_child_is_merged_or_superseded(self):
        self.assertEqual(acceptance.due(KIDS + [job(54, "merged", 50, 71), job(53, "merged", 60, 72)]), {50: [51, 52, 54], 60: [53]})

    def test_one_child_still_at_work_or_stopped_holds_the_parent(self):
        for state in ("waiting", "queued", "building", "review_wait", "reviewing", "blocked", "failed", "rejected", "returned", "checks", "fixing"):
            self.assertEqual(acceptance.due(KIDS + [job(55, state, 50)]), {}, state)

    def test_a_parent_with_no_merged_child_is_not_due(self):
        self.assertEqual(acceptance.due([job(51, "superseded", 50), job(52, "superseded", 50)]), {})

    def test_a_job_without_a_part_of_line_belongs_to_no_parent(self):
        self.assertEqual(acceptance.due([job(51, "merged")]), {})
        self.assertEqual(acceptance.due(KIDS + [job(56, "building")]), {50: [51, 52]})


class PlanTests(unittest.TestCase):
    def test_plan_reads_the_latest_plan_comment(self):
        cs = [{"body": "## Plan\nold"}, {"body": "chatter"}, {"body": "## Plan\nnew"}, {"body": "later chatter"}]
        self.assertEqual(acceptance.plan(cs), "## Plan\nnew")
        self.assertIsNone(acceptance.plan([{"body": "x"}]))
        self.assertIsNone(acceptance.plan([]))


class BriefTests(unittest.TestCase):
    def text(self, plan_text="## Plan\nstep"):
        return acceptance.brief("o/r", PARENT, plan_text, KIDS)

    def test_the_brief_carries_the_parent_text_its_plan_and_the_children(self):
        t = self.text()
        self.assertIn("sent by the dispatcher", t)
        self.assertIn("work alone", t)
        self.assertIn("https://github.com/o/r/issues/50", t)
        self.assertIn("Big thing", t)
        self.assertIn("Ask one.\nAsk two.", t)
        self.assertIn("## Plan\nstep", t)
        self.assertIn("- #51 first (merged, pull request #70)", t)
        self.assertIn("- #52 second (superseded)", t)
        self.assertLess(t.index("Ask one."), t.index("## Plan\nstep"))
        self.assertLess(t.index("## Plan\nstep"), t.index("- #51"))

    def test_the_brief_asks_for_the_check_against_dev_and_as_the_user(self):
        t = self.text()
        for phrase in ("against the code on dev", "as its user", "how one reaches it", "how one leaves it", "what it shows when it is empty", "when the input is wrong"):
            self.assertIn(phrase, t)

    def test_the_brief_names_both_last_lines_and_the_gap_issue_form(self):
        t = self.text()
        for phrase in ("ACCEPTED: <one sentence>", "GAPS: #a, #b", "P1", "**Part of**: #50", "**Repairs**: #<child>"):
            self.assertIn(phrase, t)

    def test_a_missing_plan_comment_is_said_so(self):
        t = self.text(None)
        self.assertIn("has no `## Plan` comment", t)


class OutcomeTests(unittest.TestCase):
    def test_accepted_is_the_last_line_with_its_sentence(self):
        self.assertEqual(acceptance.outcome("work\nACCEPTED: all asks met\n"), ("accepted", [], "ACCEPTED: all asks met"))

    def test_gaps_names_the_issues_in_order_once(self):
        self.assertEqual(acceptance.outcome("x\nGAPS: #12, #7, #12\n"), ("gaps", [12, 7], "GAPS: #12, #7, #12"))

    def test_gaps_without_a_number_or_no_final_line_is_none(self):
        self.assertEqual(acceptance.outcome("GAPS: none")[0], "none")
        self.assertEqual(acceptance.outcome("nothing here")[0], "none")
        self.assertEqual(acceptance.outcome("")[0], "none")

    def test_a_line_inside_a_code_fence_does_not_count(self):
        self.assertEqual(acceptance.outcome("```\nACCEPTED: fake\n```\n")[0], "none")
        self.assertEqual(acceptance.outcome("ACCEPTED: real\n```\nGAPS: #3\n```\n"), ("accepted", [], "ACCEPTED: real"))


if __name__ == "__main__":
    unittest.main()
