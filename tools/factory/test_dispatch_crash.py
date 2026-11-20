import os, sys, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, iso, ready


class Crash(Base):
  def two_jobs(self):
      self.w.issues = [{"number": n, "title": "t%d" % n, "body": ready(), "comments": []} for n in (5, 6)]

  def test_an_unexpected_exception_in_one_job_does_not_stop_the_beat_or_the_other_job(self):
      self.two_jobs()
      real = D.Dispatcher.step

      def step(d, j):
          if j["issue"] == 5:
              raise TypeError("odd")
          return real(d, j)

      with unittest.mock.patch.object(D.Dispatcher, "step", step):
          self.tick()
      self.assertEqual(self.state(6), "building")
      self.assertEqual(self.state(5), "queued")
      self.assertEqual(self.d.store.get_job("5")["errors"], 1)
      self.assertIn("#5 queued: TypeError", self.out.getvalue())

  def test_twenty_failed_passes_inside_two_hours_leave_the_job_in_its_state(self):
      with unittest.mock.patch.object(D.Dispatcher, "step", side_effect=RuntimeError("odd")):
          self.tick(20)
      self.assertNotEqual(self.state(), "failed")
      self.assertEqual(self.d.store.get_job("5")["errors"], 20)

  def test_twenty_unexpected_exceptions_in_a_row_end_the_job_failed(self):
      with unittest.mock.patch.object(D.Dispatcher, "step", side_effect=RuntimeError("odd")):
          self.tick(19)
          self.w.clock += D.FAIL_AFTER_S
          self.tick()
      self.assertEqual(self.state(), "failed")
      reason = self.d.store.get_job("5")["reason"]
      self.assertIn("20 passes in a row failed", reason)
      self.assertIn("RuntimeError", reason)

  def test_an_unexpected_exception_in_intake_is_logged_and_the_jobs_still_step(self):
      self.tick()
      with unittest.mock.patch.object(D.Dispatcher, "intake", side_effect=TypeError("odd")):
          self.tick()
      self.assertIn("intake: TypeError", self.out.getvalue())
      self.assertEqual(self.state(), "building")

  def test_an_unexpected_exception_in_reconcile_is_logged_and_the_beat_goes_on(self):
      with unittest.mock.patch.object(D.Dispatcher, "reconcile", side_effect=OSError("odd")):
          self.tick()
      self.assertIn("reconcile: OSError", self.out.getvalue())
      self.assertEqual(self.state(), "building")

  def test_recovers_or_requeues_job_left_in_sending_without_run_id_after_crash(self):
      self.d = self.new()
      ts = iso(self.w.clock)
      fid_a = self.d.store.intent("5", "", "build", coworker="B1", at=ts)
      self.d.store.put_job("5", "building", {"issue": 5, "title": "Fix x", "body": ready(), "agent": "b1", "copy": 1,
                                             "sending": "build", "run": None, "fire_id": fid_a, "intent_at": ts})
      self.w.runs["r_adopt"] = {"status": "running"}
      self.w.order.append(("r_adopt", "b1"))
      self.w.sent_at["r_adopt"] = self.w.clock
      self.tick()
      j_a = self.d.store.get_job("5")
      self.assertEqual((j_a["state"], j_a["run"], j_a["sending"]), ("building", "r_adopt", None))
      self.assertEqual(self.w.rows("SELECT status, run_id FROM fires WHERE id=?", fid_a), [("running", "r_adopt")])
      self.assertFalse(j_a.get("errors"))

      self.w.issues.append({"number": 6, "title": "Fix y", "body": ready(), "comments": []})
      fid_b = self.d.store.intent("6", "", "build", coworker="B2", at=ts)
      self.d.store.put_job("6", "building", {"issue": 6, "title": "Fix y", "body": ready(), "agent": "b2", "copy": 1,
                                             "sending": "build", "run": None, "fire_id": fid_b, "intent_at": ts})
      j_b = self.d.store.get_job("6")
      self.d.finished_run(j_b)
      j_b = self.d.store.get_job("6")
      self.assertEqual((j_b["state"], j_b["sending"]), ("queued", None))
      self.assertEqual(self.w.rows("SELECT status FROM fires WHERE id=?", fid_b), [("lost",)])
      self.assertFalse(j_b.get("errors"))


if __name__ == "__main__":
  unittest.main()
