import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_planning_cut import Cut, TWO_STAGE

NOTE = "handover/ss/run1-1.md"
LINE = "Continue from your handover note: %s in the shared space (read it with your shared files tool). Read it first; do not redo what it marks done." % NOTE


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

    def test_a_lost_replan_is_sent_again_with_the_cut_failure_it_carried(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.w.finish("ss", "BLOCKED: plan: #5 names a gone file")
        self.station.once(2)
        self.station.once(3)
        self.lose("boss", "run1", note=NOTE)
        self.station.once(4)
        self.assertEqual(self.store.get_all("plan:5")["state"], "resend")
        self.station.once(5)
        resent = self.w.sends[1][1]
        self.assertEqual(resent.split("\n")[0], LINE)
        self.assertIn("BLOCKED: plan: #5 names a gone file", resent)

    def test_a_lost_revise_is_sent_again_with_the_answers_it_carried(self):
        self.build(TWO_STAGE)
        for k, v in (("state", "revise"), ("title", "Fix x"), ("answers", '["use the blue one"]'), ("agent", "boss"), ("copy", "1"), ("run", "p0")):
            self.store.set("plan:5", k, v)
        self.station.once(1)
        self.assertIn("use the blue one", self.w.sends[0][1])
        self.lose("boss", "run1", note=NOTE)
        self.station.once(2)
        self.station.once(3)
        resent = self.w.sends[1][1]
        self.assertEqual(resent.split("\n")[0], LINE)
        self.assertIn("use the blue one", resent)

    def test_a_note_of_another_stage_is_not_put_on_the_cut(self):
        self.build(TWO_STAGE)
        self.planned()
        for k, v in (("handover", NOTE), ("handover_stage", "review")):
            self.store.set("plan:5", k, v)
        self.station.once(1)
        self.assertNotIn("handover note", self.w.sends[0][1])

    def test_a_re_send_to_the_other_coworker_of_the_same_stage_carries_the_note(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.lose("ss", "c1", note=NOTE)
        self.station.once(2)
        self.seed(99, "cutting", "ss", "held")
        self.station.once(3)
        self.assertEqual(self.w.sends[0][0], "ike")
        self.assertEqual(self.w.sends[0][1].split("\n")[0], LINE)

    def test_a_send_that_failed_keeps_the_note_for_the_next_try(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.lose("ss", "c1", note=NOTE)
        self.station.once(2)
        self.w.cut_off_next_send = True
        self.w.hide_runs = True
        self.station.once(3)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["handover"]), ("planned", NOTE))
        self.station.once(4)
        self.assertEqual(self.w.sends[-1][1].split("\n")[0], LINE)
        self.assertEqual(self.store.get_all("plan:5")["handover"], "")

    def test_an_unstaged_plan_lost_forgets_its_intent_so_no_other_run_is_adopted(self):
        self.build({})
        self.seed(5, "running", "ss", "c1")
        self.store.set("plan:5", "intent", "1970-01-01T00:16:40Z")
        self.lose("ss", "c1")
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["intent"], rec["agent"]), ("unsent", "", ""))

    def test_an_unstaged_plan_lost_after_it_opened_children_is_blocked(self):
        self.build({})
        self.w.open_children = [{"number": 601, "body": "Part of #5"}]
        self.seed(5, "running", "ss", "c1")
        self.lose("ss", "c1")
        self.station.once(2)
        self.assertEqual(self.store.get_all("plan:5")["state"], "blocked")

    def test_a_run_that_finished_as_the_limit_cancelled_it_is_read_as_finished(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        real = self.station.account

        def account(tool, args):
            if tool == "cancel_run":
                self.w.runs["c1"] = {"status": "done", "output": "BLOCKED: nothing to cut"}
                return {"wasRunning": False}
            return real(tool, args)

        self.station = type(self.station)(self.cfg, self.store, account, self.station.gh, lambda: 1000.0 + 2701)
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]), ("blocked", "nothing to cut"))
        self.assertNotIn("resent", rec)
        self.assertEqual(self.w.sends, [])


if __name__ == "__main__":
    unittest.main()
