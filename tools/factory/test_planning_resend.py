import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_planning_cut import Cut, TWO_STAGE

NOTE = "/data/shared/handover/ss/run1-1.md"
LINE = "Continue from your handover note: %s. Read it first; do not redo what it marks done." % NOTE


class Resend(Cut):
    def lose(self, agent, run, status="error", note=None):
        self.w.finish(agent, None, status=status)
        if note:
            self.w.runs[run]["handoverPath"] = note

    def test_a_lost_cut_with_a_note_is_sent_again_once_with_the_line_first(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.lose("ss", "c1", note=NOTE)
        self.station.once(2)
        self.assertEqual(self.store.get_all("plan:5")["state"], "planned")
        self.station.once(3)
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.w.sends[0][1].split("\n")[0], LINE)
        self.assertIn("## Plan", self.w.sends[0][1])
        self.assertEqual(self.store.get_all("plan:5")["state"], "cutting")

    def test_a_lost_cut_without_a_note_is_sent_again_once_without_the_line(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.lose("ss", "c1")
        self.station.once(2)
        self.station.once(3)
        self.assertEqual(len(self.w.sends), 1)
        self.assertNotIn("handover note", self.w.sends[0][1])

    def test_a_cut_cancelled_by_the_run_limit_is_sent_again_with_its_note(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.w.runs["c1"]["handoverPath"] = NOTE
        self.station = type(self.station)(self.cfg, self.store, self.station.account, self.station.gh, lambda: 1000.0 + 2701)
        self.station.once(2)
        self.assertEqual(self.w.cancels, [("ss", "c1")])
        self.station.once(3)
        self.assertEqual(self.w.sends[0][1].split("\n")[0], LINE)

    def test_a_second_loss_of_the_same_step_is_blocked(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.lose("ss", "c1", note=NOTE)
        self.station.once(2)
        self.station.once(3)
        self.lose("ss", "run1", note=NOTE)
        self.station.once(4)
        rec = self.store.get_all("plan:5")
        self.assertEqual(rec["state"], "blocked")
        self.station.once(5)
        self.assertEqual(len(self.w.sends), 1)

    def test_an_answer_whose_goal_was_not_met_is_not_sent_again(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.w.finish("ss", "no last line", goal={"state": "not_met", "verdicts": []})
        self.station.once(2)
        self.station.once(3)
        self.assertEqual(self.store.get_all("plan:5")["state"], "blocked")
        self.assertEqual(self.w.sends, [])

    def test_a_lost_plan_is_sent_again_once_to_the_planner_with_the_line(self):
        self.build(TWO_STAGE)
        self.seed(5, "planning", "boss", "p1")
        self.lose("boss", "p1", note=NOTE)
        self.station.once(2)
        self.station.once(3)
        self.assertEqual(self.w.sends[0][0], "boss")
        self.assertEqual(self.w.sends[0][1].split("\n")[0], LINE)
        self.assertEqual(self.store.get_all("plan:5")["state"], "planning")
        self.lose("boss", "run1", note=NOTE)
        self.station.once(4)
        self.assertEqual(self.store.get_all("plan:5")["state"], "blocked")


if __name__ == "__main__":
    unittest.main()
