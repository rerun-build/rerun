import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
from test_dispatch import Base, D, ready


def issue(n, deps="none"):
    return {"number": n, "title": "t%d" % n, "body": ready(deps=deps), "comments": []}


class DeadDeps(Base):
    def data(self, n=5):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job=?", str(n))[0][0])

    def ended(self, n, state):
        self.d = self.new()
        self.d.store.put_job(str(n), state, {"issue": n, "title": "t%d" % n, "state": state, "relabelled": True, "commented": True})

    def lookups(self, n):
        return [c for c in self.w.gh_calls if c[:2] == ["api", "repos/o/r/issues/%d" % n]]

    def test_a_dependency_whose_job_ended_rejected_is_named_dead_and_commented_once(self):
        self.w.issues = [issue(5, "#7")]
        self.ended(7, "rejected")
        self.tick(3, fresh=True)
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(self.out.getvalue().count("waits on dead #7 (rejected)"), 1)
        self.assertEqual(len(self.w.issue(5)["comments"]), 1)
        self.assertIn("#7 (rejected)", self.w.issue(5)["comments"][0])
        self.assertEqual(self.data()["dead"], [[7, "rejected"]])
        snap = snapshot.build_snapshot(self.d.store, self.cfg, self.w.clock, None, beat=3)
        self.assertEqual([j["reason"] for j in snap["jobs"] if j["issue"] == 5], ["waits on dead #7 (rejected)"])

    def test_an_ended_dependency_carrying_the_label_again_is_not_dead(self):
        self.w.issues = [issue(5, "#7"), issue(7)]
        self.ended(7, "rejected")
        self.tick()
        self.assertNotIn("waits on dead", self.out.getvalue())
        self.assertEqual(self.w.issue(5)["comments"], [])

    def test_a_dependency_closed_as_not_planned_is_dead(self):
        self.w.issues = [issue(5, "#8")]
        self.w.close_reasons[8] = "not_planned"
        self.tick(2)
        self.assertEqual(self.state(), "waiting")
        self.assertIn("waits on dead #8 (closed as not planned)", self.out.getvalue())
        self.assertEqual(len(self.w.issue(5)["comments"]), 1)

    def test_a_dependency_closed_as_a_duplicate_is_dead(self):
        self.w.issues = [issue(5, "#8")]
        self.w.close_reasons[8] = "duplicate"
        self.tick()
        self.assertEqual(self.state(), "waiting")
        self.assertIn("waits on dead #8 (closed as duplicate)", self.out.getvalue())

    def test_a_dependency_closed_as_completed_long_ago_is_met_and_read_once(self):
        self.w.issues = [issue(5, "#7, #9")]
        self.tick(3)
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(len(self.lookups(9)), 1)
        self.w.open_numbers.discard(7)
        self.tick()
        self.assertEqual(self.state(), "building")

    def returned(self, n, replans):
        self.d = self.new()
        self.d.store.put_job(str(n), "returned", {"issue": n, "title": "t%d" % n, "state": "returned", "relabelled": True,
                                                  "commented": True, "reason": "BLOCKED: plan: a file outside its paths",
                                                  "replans": replans})

    def test_a_dependency_returned_for_a_re_plan_is_not_dead(self):
        self.w.issues = [issue(5, "#7")]
        self.returned(7, 0)
        self.w.open_numbers.add(7)
        self.tick(2)
        self.assertEqual(self.state(), "waiting")
        self.assertIn("waits on returned #7", self.out.getvalue())
        self.assertNotIn("dead #7", self.out.getvalue())
        self.assertNotIn("dead", self.data())
        self.assertEqual(self.data()["waits_on_returned"], [7])
        self.assertEqual(self.w.issue(5)["comments"], [])

    def test_a_dependency_returned_after_its_last_re_plan_is_dead(self):
        self.w.issues = [issue(5, "#7")]
        self.returned(7, 2)
        self.w.open_numbers.add(7)
        self.tick(2)
        self.assertEqual(self.data()["dead"], [[7, "returned"]])
        self.assertEqual(len(self.w.issue(5)["comments"]), 1)

    def test_an_open_issue_without_a_job_or_the_label_is_named_and_not_commented(self):
        self.w.issues = [issue(5, "#7")]
        self.tick()
        self.assertIn("waits on #7 (not a factory job)", self.out.getvalue())
        self.assertEqual(self.w.issue(5)["comments"], [])

    def test_the_beat_line_counts_rejected_today_and_jobs_waiting_on_a_dead_dependency(self):
        self.w.issues = [issue(5, "#7")]
        self.ended(7, "rejected")
        self.tick(2)
        line = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        self.assertIn("| ended today: merged 0, blocked 0, failed 0, returned 0, rejected 1 |", line)
        self.assertTrue(line.endswith(" | unreadable 0, dead waits 1 | problems 0 open, 0 owner"), line)

    def test_a_waiting_issue_given_its_label_back_waits_again(self):
        self.w.issues = [issue(5, "#7")]
        self.tick()
        self.w.unlabelled.add(5)
        self.d.beats = 9
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.w.unlabelled.discard(5)
        self.tick()
        self.assertEqual(self.state(), "waiting")

    def test_a_dependency_reopened_and_closed_again_is_read_again(self):
        self.w.issues = [issue(5, "#8")]
        self.w.close_reasons[8] = "not_planned"
        self.tick()
        self.w.open_numbers.add(8)
        self.tick()
        self.w.open_numbers.discard(8)
        self.w.close_reasons[8] = "completed"
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertEqual(len(self.lookups(8)), 2)

    def test_a_dependency_closed_completed_between_two_beats_is_met(self):
        self.w.issues = [issue(5, "#8")]
        self.w.close_reasons[8] = "not_planned"
        self.tick()
        self.assertEqual(self.state(), "waiting")
        self.w.close_reasons[8] = "completed"
        self.tick()
        self.assertEqual(self.state(), "building")

    def test_a_dependency_that_does_not_exist_is_named_dead(self):
        self.w.issues = [issue(5, "#9")]
        gh = self.w.gh
        def missing(a):
            if a[:2] == ["api", "repos/o/r/issues/9"]:
                raise D.Error("gh api repos/o/r/issues/9 failed: exit 1: gh: Not Found (HTTP 404)")
            return gh(a)
        self.w.gh = missing
        self.tick()
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(self.data()["dead"], [[9, "not found"]])
        self.assertIn("#9 (not found)", self.w.issue(5)["comments"][0])


if __name__ == "__main__":
    unittest.main()
