import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, NOT_MET


class Stale(Base):
    def reasons(self):
        return [r[0] for r in self.w.rows("SELECT reason FROM transitions WHERE job=5 ORDER BY id")]

    def test_an_accept_naming_another_commit_is_asked_again_then_blocks(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT @1234567")
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertIn("verdict names 1234567, the head is abcdef1: asked again", self.reasons())
        self.tick()
        self.w.finish("r1", "VERDICT: ACCEPT @1234567")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("blocked: verdict names 1234567, the head is abcdef1: asked again", self.reasons())
        self.assertEqual(self.w.merges, [])

    def test_an_accept_naming_no_commit_is_asked_again(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT")
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertIn("verdict names no commit, the head is abcdef1: asked again", self.reasons())

    def test_an_accept_with_at_goes_to_checks(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT at abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_an_accept_with_at_naming_another_commit_is_asked_again(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT at 1234567")
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertIn("verdict names 1234567, the head is abcdef1: asked again", self.reasons())

    def test_the_second_review_may_name_the_head(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT @1234567")
        self.tick(2)
        self.w.finish("r1", "VERDICT: ACCEPT at abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_a_stale_accept_with_a_goal_not_met_blocks_the_job(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT @1234567\nTools: shell 2 calls", goal=NOT_MET)
        self.tick()
        self.assertEqual(self.state(), "blocked")

    def test_an_accept_with_the_full_id_goes_to_checks(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT @abcdef1234567890")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_a_reject_naming_another_commit_goes_to_the_fix_round(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @1234567: wrong sum")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")


if __name__ == "__main__":
    unittest.main()
