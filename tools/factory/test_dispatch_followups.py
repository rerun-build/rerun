import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base


class FollowUps(Base):
    INBOX = "Factory follow-ups inbox"

    def inboxes(self):
        return [p for p in self.w.problems if p["title"] == self.INBOX]

    def creates(self):
        return [c for c in self.w.gh_calls if c[:2] == ["issue", "create"]]

    def searches(self):
        return [c for c in self.w.gh_calls if c[:2] == ["issue", "list"] and "Factory follow-ups inbox in:title" in c]

    def test_an_accept_with_two_notes_writes_one_comment_on_a_new_inbox(self):
        self.to_review()
        self.w.finish("r1", "fine\nFollow-up: add a retry test\n- Non-blocking: rename x to y\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(len(self.creates()), 1)
        self.assertNotIn("--label", self.creates()[0])
        [inbox] = self.inboxes()
        [text] = inbox["comments"]
        self.assertTrue(text.startswith("From #5, pull request #42:\n"))
        self.assertIn("add a retry test", text)
        self.assertIn("rename x to y", text)
        self.assertEqual(self.state(), "checks")

    def test_a_note_repeated_in_the_next_round_is_not_written_twice(self):
        self.to_review()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.w.finish("r1", "Follow-up: add a retry test\nFollow-up: log the sum\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        [inbox] = self.inboxes()
        self.assertEqual(len(inbox["comments"]), 2)
        self.assertNotIn("add a retry test", inbox["comments"][1])
        self.assertIn("log the sum", inbox["comments"][1])
        self.assertEqual(len(self.creates()), 1)
        self.assertEqual(len(self.searches()), 1)

    def test_the_open_inbox_is_used_and_a_near_title_is_not(self):
        self.w.problems += [{"number": 950, "title": "Factory follow-ups inbox (old)", "body": "", "comments": [], "labels": [], "state": "OPEN"},
                            {"number": 951, "title": self.INBOX, "body": "", "comments": [], "labels": [], "state": "OPEN"}]
        self.to_review()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.creates(), [])
        self.assertEqual(self.w.issue(950)["comments"], [])
        self.assertEqual(len(self.w.issue(951)["comments"]), 1)

    def test_a_verdict_with_no_note_touches_no_issue(self):
        self.to_checks()
        self.assertEqual(self.creates(), [])
        self.assertEqual(self.searches(), [])

    def test_a_failed_comment_is_tried_again_at_the_next_review(self):
        self.to_review()
        real = self.w.gh

        def gh(args):
            if list(args)[:2] == ["issue", "comment"]:
                raise D.Error("gh issue comment failed: exit 1")
            return real(args)

        self.w.gh = gh
        self.close()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual([c for p in self.inboxes() for c in p["comments"]], [])
        self.w.gh = real
        self.close()
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        [inbox] = self.inboxes()
        self.assertEqual(len(inbox["comments"]), 1)
        self.assertIn("add a retry test", inbox["comments"][0])
        self.assertEqual(self.state(), "checks")

    def test_a_kept_inbox_that_fails_is_searched_again(self):
        self.to_review()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick()
        [old] = self.inboxes()
        old["state"] = "CLOSED"
        real = self.w.gh

        def gh(args):
            if list(args)[:3] == ["issue", "comment", str(old["number"])]:
                raise D.Error("gh issue comment failed: exit 1")
            return real(args)

        self.w.gh = gh
        self.close()
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.w.finish("r1", "Follow-up: log the sum\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        new = [p for p in self.inboxes() if p["state"] == "OPEN"]
        self.assertEqual(len(new), 1)
        self.assertIn("log the sum", new[0]["comments"][0])
        self.assertEqual(len(old["comments"]), 1)

    def test_a_failed_search_creates_nothing_and_the_job_moves(self):
        self.to_review()
        real = self.w.gh

        def gh(args):
            if "Factory follow-ups inbox in:title" in list(args):
                raise D.Error("gh issue list failed: exit 1")
            return real(args)

        self.w.gh = gh
        self.close()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.creates(), [])
        self.assertEqual(self.state(), "checks")

    def test_the_review_brief_asks_for_follow_up_lines(self):
        self.assertIn("`Follow-up: <one sentence>`", D.review_brief({"issue": 5, "title": "t"}, 9, "abcdef1234"))

if __name__ == "__main__":
    unittest.main()
