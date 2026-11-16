import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base


class FollowUps(Base):
    def titles(self):
        return sorted(p["title"] for p in self.w.problems if "From the review of #5." in (p["body"] or ""))

    def test_an_accept_with_two_notes_opens_two_issues(self):
        self.to_review()
        self.w.finish("r1", "fine\nFollow-up: add a retry test\n- Non-blocking: rename x to y\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.titles(), ["add a retry test", "rename x to y"])
        self.assertEqual(self.state(), "checks")

    def test_a_note_repeated_in_the_next_round_opens_no_second_issue(self):
        self.to_review()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.titles(), ["add a retry test"])

    def test_a_verdict_with_no_note_opens_no_issue(self):
        self.to_checks()
        self.assertEqual(self.titles(), [])

    def test_a_failed_create_still_moves_the_job(self):
        self.to_review()
        real = self.w.gh

        def gh(args):
            if list(args)[:2] == ["issue", "create"]:
                raise D.Error("gh issue create failed: exit 1")
            return real(args)

        self.w.gh = gh
        self.close()
        self.w.finish("r1", "Follow-up: add a retry test\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_the_review_brief_asks_for_follow_up_lines(self):
        self.assertIn("`Follow-up: <one sentence>`", D.review_brief({"issue": 5, "title": "t"}, 9, "abcdef1234"))


if __name__ == "__main__":
    unittest.main()
