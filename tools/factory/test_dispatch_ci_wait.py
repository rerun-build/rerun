import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, HEAD, wf


def run(name, conclusion, status="completed", wid=1, rid=77):
  return dict(wf(name, conclusion, status=status, wid=wid), id=rid)


class CiWait(Base):
  def reason(self):
      return self.d.store.get_job("5").get("wait_reason")

  def test_a_run_queued_on_a_pool_shows_as_queued_in_the_wait_reason(self):
      self.to_checks()
      self.w.workflows[HEAD] = [run("image", None, status="queued")]
      self.tick()
      self.assertEqual(self.state(), "checks")
      self.assertEqual(self.reason(), "queued: image")

  def test_a_run_in_progress_shows_as_running(self):
      self.to_checks()
      self.w.workflows[HEAD] = [run("image", None, status="in_progress")]
      self.tick()
      self.assertEqual(self.reason(), "running: image")

  def test_a_run_that_needs_approval_shows_its_conclusion_and_is_not_rerun(self):
      self.to_checks()
      self.w.workflows[HEAD] = [run("deploy", "action_required")]
      self.tick()
      self.assertEqual(self.reason(), "not passed: deploy action_required")
      self.assertEqual(self.w.reruns, [])

  def test_a_cancelled_run_is_rerun_once_and_shows_its_conclusion(self):
      self.to_checks()
      self.w.workflows[HEAD] = [run("ci", "cancelled")]
      self.tick()
      self.assertEqual(self.w.reruns, ["repos/o/r/actions/runs/77/rerun"])
      self.assertEqual(self.reason(), "not passed: ci cancelled")
      self.tick(3)
      self.assertEqual(len(self.w.reruns), 1)
      self.assertEqual(self.state(), "checks")

  def test_a_cancelled_run_next_to_a_passed_run_of_the_same_workflow_is_not_rerun(self):
      self.to_checks()
      self.w.workflows[HEAD] = [run("ci", "cancelled", rid=76), run("ci", "success", rid=78)]
      self.tick()
      self.assertEqual(self.w.reruns, [])
      self.assertEqual(self.state(), "merged")

  def test_the_wait_reason_is_in_the_snapshot_and_leaves_with_the_state(self):
      self.to_checks()
      self.w.workflows[HEAD] = [run("image", None, status="queued")]
      self.tick()
      import snapshot
      snap = snapshot.build_snapshot(self.d.store, self.cfg, self.w.clock, None, beat=1)
      self.assertEqual([j["reason"] for j in snap["jobs"] if j["issue"] == 5], ["queued: image"])
      self.w.workflows[HEAD] = [run("image", "success")]
      self.tick()
      self.assertEqual(self.state(), "merged")
      self.assertNotIn("wait_reason", self.d.store.get_job("5"))


if __name__ == "__main__":
  unittest.main()
