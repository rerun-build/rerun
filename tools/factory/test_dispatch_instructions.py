import json
import unittest

from test_dispatch import Base, World
from test_instructions import BODY, NEW, OLD, SOUL

ISSUE = 40
BODY_R1 = BODY.replace("**Coworker**: linus", "**Coworker**: R1")
APPLIED = SOUL.replace(OLD, NEW, 1)


def change(body=BODY_R1):
    return {"number": ISSUE, "title": "Reviewer R1 reads the new rule", "body": body, "comments": [],
            "labels": ["instructions"], "state": "OPEN"}


class Instructions(Base):
    def setUp(self):
        super().setUp()
        self.w = World(issues=[change()])
        self.w.ledger = self.cfg["ledger_file"]
        self.w.unlabelled.add(ISSUE)
        self.w.souls = {"r1": SOUL}

    def kv(self, job, k):
        rows = self.w.rows("SELECT v FROM kv WHERE job=? AND k=?", job, k)
        return rows[0][0] if rows else None

    def state_of(self):
        return self.kv("instr:%d" % ISSUE, "state")

    def comments(self):
        return self.w.issue(ISSUE)["comments"]

    def closes(self):
        return [c for n, c in self.w.closed if n == ISSUE]

    def test_an_instructions_issue_goes_to_a_reviewer_who_is_not_the_coworker_it_changes(self):
        self.tick()
        self.assertEqual([s[0] for s in self.w.sends], ["r2"])
        self.assertIn("Review an instructions change", self.w.sends[0][1])
        self.assertEqual(self.w.soul_updates, [])
        self.assertEqual(self.state_of(), "review")

    def test_accept_applies_the_new_text_keeps_the_old_and_closes_the_issue(self):
        self.tick()
        self.w.finish("r2", "ok\nVERDICT: ACCEPT")
        self.tick()
        self.assertEqual(self.w.soul_updates, [("r1", APPLIED)])
        before = json.loads(self.kv("soul", str(ISSUE)))
        self.assertEqual((before["agent"], before["before"]), ("r1", SOUL))
        self.assertEqual(self.state_of(), "applied")
        self.assertEqual(len(self.closes()), 1)
        self.assertIn("applied", self.closes()[0])
        self.assertIn("R1", self.closes()[0])
        self.assertIn("R2", self.closes()[0])
        sends, closed = len(self.w.sends), len(self.w.closed)
        self.tick(12)
        self.assertEqual(self.w.soul_updates, [("r1", APPLIED)])
        self.assertEqual((len(self.w.sends), len(self.w.closed)), (sends, closed))

    def test_reject_changes_nothing_and_closes_with_the_verdict(self):
        self.tick()
        self.w.finish("r2", "no\nVERDICT: REJECT: it widens the permission")
        self.tick()
        self.assertEqual(self.w.soul_updates, [])
        self.assertIsNone(self.kv("soul", str(ISSUE)))
        self.assertEqual(self.state_of(), "rejected")
        self.assertEqual(self.closes(), ["Not applied. The review by R2 ended: VERDICT: REJECT: it widens the permission"])

    def test_an_unreadable_issue_gets_one_comment_and_no_review(self):
        self.w.issue(ISSUE)["body"] = BODY_R1.split("**New text**")[0]
        self.tick()
        self.tick(12)
        self.assertEqual(len(self.comments()), 1)
        self.assertIn("New text", self.comments()[0])
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.state_of(), "unreadable")

    def test_old_text_that_is_not_in_the_current_instructions_is_refused_before_any_review(self):
        self.w.souls = {"r1": "Something else entirely.\n"}
        self.tick()
        self.assertEqual(self.w.sends, [])
        self.assertIn("occurs 0 times", self.comments()[0])
        self.assertEqual(self.state_of(), "refused")

    def test_a_coworker_outside_the_dispatcher_pools_is_refused(self):
        self.w.issue(ISSUE)["body"] = BODY_R1.replace("**Coworker**: R1", "**Coworker**: ASSISTANT")
        self.tick()
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.comments(), ["Not applied: ASSISTANT is not a coworker of the dispatcher's pools."])
        self.assertEqual(self.state_of(), "refused")

    def test_text_changed_between_the_review_and_the_accept_is_not_applied(self):
        self.tick()
        self.w.souls["r1"] = "Rewritten by hand.\n"
        self.w.finish("r2", "ok\nVERDICT: ACCEPT")
        self.tick()
        self.assertEqual(self.w.soul_updates, [])
        self.assertIn("occurs 0 times", self.comments()[-1])
        self.assertEqual(self.state_of(), "refused")

    def test_an_issue_changed_between_the_review_and_the_accept_is_not_applied(self):
        self.tick()
        self.w.issue(ISSUE)["body"] = BODY_R1.replace(NEW, NEW + "\nAlso this.")
        self.w.finish("r2", "ok\nVERDICT: ACCEPT")
        self.tick()
        self.assertEqual(self.w.soul_updates, [])
        self.assertIn("changed since the review", self.comments()[-1])
        self.assertEqual(self.state_of(), "refused")

    def test_the_review_takes_a_reviewer_copy_while_it_runs(self):
        self.tick()
        self.assertIn(("r2", 1), self.d.running())
        self.assertNotIn(("r1", 1), self.d.running())


if __name__ == "__main__":
    unittest.main()
