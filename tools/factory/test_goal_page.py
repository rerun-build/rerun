import unittest

import dispatch as D
import planning

LINE = "The goal every factory job serves is the brain page `north-star-factory`. Read it with your brain tool only when the issue leaves open a choice that the goal settles."
JOB = {"issue": 5, "title": "t", "worker": "coder"}


class GoalPage(unittest.TestCase):
    def test_the_tail_carries_the_goal_line(self):
        self.assertIn(LINE, D.TAIL)

    def test_every_dispatched_brief_carries_it_once(self):
        texts = [
            D.build_brief(JOB),
            D.review_brief(JOB, 9, "abcdef1234"),
            D.fix_brief(JOB, 9, "no"),
            D.proof_brief(JOB, 9, "abcdef1234", ["x"]),
            D.first_brief(dict(JOB, worker="researcher")),
            D.first_brief(dict(JOB, worker="designer")),
        ]
        for text in texts:
            self.assertEqual(text.count(LINE), 1)

    def test_the_planning_brief_carries_it_before_the_last_line(self):
        text = planning.brief({"number": 612, "title": "Floor"}, "o/rerun")
        self.assertEqual(text.count(LINE), 1)
        self.assertTrue(text.endswith("or `BLOCKED: <one sentence>` when the issue cannot be cut."))
        self.assertIn("Each child says in one line which part and which milestone of that page it serves.", text)


if __name__ == "__main__":
    unittest.main()
