import unittest

from test_dispatch import Base, HEAD, PR_LINE, World, ready, wf
from test_dispatch_proof import BODY
import pools


class FreeCopies(unittest.TestCase):
    def cfg(self, order=(("r1", 2), ("r2", 1))):
        return {"types": {"reviewer": {"coworkers": [{"id": i, "name": i.upper(), "runs": n} for i, n in order]}}}

    def test_every_free_copy_in_settings_order(self):
        self.assertEqual(pools.free_copies(self.cfg(), "reviewer", []), [("r1", 1), ("r1", 2), ("r2", 1)])
        self.assertEqual(pools.free_copies(self.cfg(order=(("r2", 1), ("r1", 2))), "reviewer", []), [("r2", 1), ("r1", 1), ("r1", 2)])

    def test_a_full_coworker_is_skipped_and_busy_copies_are_not_listed(self):
        self.assertEqual(pools.free_copies(self.cfg(), "reviewer", [("r1", 1), ("r1", 2)]), [("r2", 1)])
        self.assertEqual(pools.free_copies(self.cfg(), "reviewer", [("r2", 1)]), [("r1", 1), ("r1", 2)])

    def test_pick_copy_is_the_first_free_copy(self):
        self.assertEqual(pools.pick_copy(self.cfg(), "reviewer", []), ("r1", 1))
        self.assertIsNone(pools.pick_copy(self.cfg(order=(("r1", 1),)), "reviewer", [("r1", 1)]))


def issue(n):
    return {"number": n, "title": "Fix %d" % n, "body": ready(), "comments": []}


class Warm(Base):
    builders = ["b1", "b2"]

    def setUp(self):
        super().setUp()
        self.cfg["reviewers"] = [{"id": "r1", "name": "R1", "runs": 2}, {"id": "r2", "name": "R2", "runs": 1}]
        self.cfg["builders"] = [{"id": "b1", "name": "B1", "runs": 2}, {"id": "b2", "name": "B2", "runs": 1}]
        self.cfg["cache_life"] = {"subscription": 3600, "key": 300}

    def done(self, rid, out):
        self.w.runs[rid] = {"status": "done", "output": out, "error": None}

    def copy_of(self, n="5"):
        return self.d.store.get_job(n)["copy"]

    def round_two(self, wait):
        self.w = World([issue(4), issue(5)])
        self.w.ledger = self.cfg["ledger_file"]
        self.tick()
        self.done("run1", "PR: https://github.com/o/r/pull/41")
        self.tick(2)
        self.done("run2", PR_LINE)
        self.tick(2)
        self.done("run3", "ok\nVERDICT: ACCEPT @abcdef1")
        self.done("run4", "bad\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick()
        self.w.clock += wait
        self.tick(2)
        fix = self.copy_of()
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        return fix, self.copy_of()

    def test_round_two_review_goes_to_the_warm_reviewer_copy(self):
        fix, review = self.round_two(60)
        self.assertEqual(review, 2)
        self.assertEqual(self.w.sends[-1][0], "r1")

    def test_past_cache_life_takes_the_first_free(self):
        fix, review = self.round_two(3600)
        self.assertEqual(review, 1)

    def test_fix_goes_to_the_builders_last_copy(self):
        fix, review = self.round_two(60)
        self.assertEqual(fix, 2)

    def test_no_cache_life_keeps_todays_pick(self):
        del self.cfg["cache_life"]
        fix, review = self.round_two(60)
        self.assertEqual((fix, review), (1, 1))

    def test_proof_never_goes_to_builder_or_reviewer_even_if_warm(self):
        self.cfg["proof"] = True
        self.w.issues[0]["body"] = BODY
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.to_review()
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.tick(3)
        self.assertEqual(self.w.sends[-1][0], "r2")
        self.assertEqual(self.copy_of(), 1)

    def test_the_second_review_is_sent_to_the_reviewer_of_the_first(self):
        self.to_review()
        self.w.finish("r1", "bad\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick(2)
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.assertEqual(self.w.sends[-1][0], "r1")
        self.assertIn("One review", self.w.sends[-1][1])


if __name__ == "__main__":
    unittest.main()
