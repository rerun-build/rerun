import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, NOT_MET


class Stale(Base):
    def last_reason(self):
        return self.w.rows("SELECT reason FROM transitions WHERE job=5 AND to_state='rejected' ORDER BY id LIMIT 1")[0][0]

    def test_an_accept_naming_another_commit_rejects_the_job(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT @1234567")
        self.tick()
        self.assertEqual(self.state(), "rejected")
        self.assertEqual(self.last_reason(), "rejected: verdict names 1234567, the head is abcdef1: VERDICT: ACCEPT @1234567")
        self.assertEqual(self.w.merges, [])

    def test_an_accept_naming_no_commit_rejects_the_job(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: ACCEPT")
        self.tick()
        self.assertEqual(self.state(), "rejected")
        self.assertIn("verdict names no commit, the head is abcdef1", self.last_reason())
        self.assertEqual(self.w.merges, [])

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
