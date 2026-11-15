import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base

COMPARE = "repos/o/r/compare/4296d1f...dev"


class PlanStale(Base):
    def seed(self, plan_dev="4296d1f"):
        job = {"issue": 5, "title": "Fix x", "body": "Fix\n", "state": "queued", "round": 1, "worker": "coder",
               "paths": ["a/b.py", "a/test_b.py"], "test": "a/test_b.py"}
        if plan_dev:
            job["plan_dev"] = plan_dev
        self.d = self.new()
        self.d.save(job, "seeded")

    def compare_says(self, answer):
        real = self.w.gh
        self.compares = []

        def gh(args):
            a = list(args)
            if a[0] == "api" and "/compare/" in a[1]:
                self.compares.append(a)
                if isinstance(answer, Exception):
                    raise answer
                return json.dumps(answer)
            return real(a)

        self.d.gh = gh

    def record(self):
        return self.d.store.get_job("5")

    def test_a_changed_file_of_the_issue_puts_the_run_first_in_the_brief(self):
        self.seed()
        self.compare_says(["a/b.py", "z/other.py"])
        self.tick()
        self.assertEqual(self.compares[0][1], COMPARE)
        msg = self.w.sends[0][1]
        self.assertIn("DONE ELSEWHERE: <commit or #pr>", msg)
        self.assertIn("in these files of the issue: a/b.py.", msg)
        self.assertEqual(self.record()["stale"], ["a/b.py"])

    def test_changes_elsewhere_leave_the_brief_as_it_was(self):
        self.seed()
        self.compare_says(["z/other.py"])
        self.tick()
        msg = self.w.sends[0][1]
        self.assertNotIn("DONE ELSEWHERE", msg)
        self.assertIn("`PR: <url>` or `BLOCKED: <one sentence>`", msg)
        self.assertEqual(self.record()["stale"], [])

    def test_a_job_without_plan_dev_makes_no_compare_call(self):
        self.seed(plan_dev=None)
        self.compare_says(["a/b.py"])
        self.tick()
        self.assertEqual(self.compares, [])
        self.assertNotIn("DONE ELSEWHERE", self.w.sends[0][1])
        self.assertIsNone(self.record().get("stale"))

    def test_a_failed_compare_never_stops_the_build(self):
        self.seed()
        self.compare_says(D.Error("gh api failed"))
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertNotIn("DONE ELSEWHERE", self.w.sends[0][1])
        self.assertIsNone(self.record().get("stale"))
        self.assertIn("plan check skipped: gh api failed", self.out.getvalue())

    def test_an_unreadable_answer_never_stops_the_build(self):
        self.seed()
        self.compare_says("not a list")
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertIsNone(self.record().get("stale"))


if __name__ == "__main__":
    unittest.main()
