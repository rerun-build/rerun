import os, sys, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, ready


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

  def test_twenty_unexpected_exceptions_in_a_row_end_the_job_failed(self):
      with unittest.mock.patch.object(D.Dispatcher, "step", side_effect=RuntimeError("odd")):
          self.tick(20)
      self.assertEqual(self.state(), "failed")
      self.assertIn("20 passes in a row failed", self.d.store.get_job("5")["reason"])

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


if __name__ == "__main__":
  unittest.main()
