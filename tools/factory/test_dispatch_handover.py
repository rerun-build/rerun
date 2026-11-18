import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, ready, run_shape, T0, PR_LINE

NOTE = "handover/b1/run1-2.md"
LINE = "Continue from your handover note: %s in the shared space (read it with your shared files tool). Read it first; do not redo what it marks done." % NOTE


class Handover(Base):
    def test_a_run_that_errored_is_sent_again_with_its_handover_note_first(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.w.runs["run1"]["handoverPath"] = NOTE
        self.tick()
        resent = self.w.sends[1][1]
        self.assertEqual(resent.split("\n")[0], LINE)
        self.assertIn(self.w.sends[0][1], resent)

    def test_a_run_cancelled_by_the_run_limit_is_sent_again_with_the_note_it_had_written(self):
        self.w.clock = T0
        self.tick()
        self.w.runs["run1"] = dict(run_shape("run1", 7, T0), handoverPath=NOTE)
        self.tick()
        self.w.clock = T0 + 601
        self.tick()
        self.assertEqual(self.w.cancels, [("b1", "run1")])
        self.assertEqual(self.w.sends[1][1].split("\n")[0], LINE)

    def test_a_run_without_a_note_is_sent_again_with_the_plain_brief(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.assertEqual(self.w.sends[1][1], self.w.sends[0][1])

    def test_the_note_is_named_once_and_the_send_after_it_is_plain(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.w.runs["run1"]["handoverPath"] = NOTE
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick(2)
        self.assertNotIn("handover note", " ".join(m for _, m, _ in self.w.sends[2:]))

    def test_a_note_is_not_offered_to_another_coworker(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.w.runs["run1"]["handoverPath"] = NOTE
        self.d.send(self.d.store.get_job("5"), "b2", "other", "plain", "building", 1)
        self.assertEqual(self.w.sends[-1][1], "plain")

    def test_a_send_that_failed_keeps_the_note_and_the_next_send_still_carries_it(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.w.runs["run1"]["handoverPath"] = NOTE
        self.w.cut_off_next_send = True
        self.tick()
        self.assertEqual(self.d.store.get_job("5")["handover"], NOTE)
        self.assertEqual(self.w.sends[1][1].split("\n")[0], LINE)

    def test_the_note_is_dropped_from_the_job_once_a_run_id_is_kept(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.w.runs["run1"]["handoverPath"] = NOTE
        self.tick()
        self.assertNotIn("handover", self.d.store.get_job("5"))


if __name__ == "__main__":
    unittest.main()
