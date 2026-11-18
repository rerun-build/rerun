import unittest

import dispatch as D


class ReplanBrief(unittest.TestCase):
    def test_a_changed_run_line_is_written_inside_the_run_block(self):
        text = D.replan_brief({"issue": 5, "title": "T", "reason": "BLOCKED: x"}, "o/r", 1)
        self.assertIn("inside the `**Run**` block", text)
        self.assertIn("reads only that block", text)

    def test_a_bullet_that_no_longer_holds_is_rewritten_where_it_stands(self):
        text = D.replan_brief({"issue": 5, "title": "T", "reason": "BLOCKED: x"}, "o/r", 1)
        self.assertIn("where it stands, so no bullet a correction voids is left", text)
        self.assertIn("the prover gets every **Change** and **Corrections** bullet as an ask", text)


if __name__ == "__main__":
    unittest.main()
