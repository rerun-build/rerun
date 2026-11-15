import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import states
from test_dispatch import Base


class Superseded(Base):
    def seed(self, plan_dev="4296d1f"):
        job = {"issue": 5, "title": "Fix x", "body": "Fix\n", "state": "queued", "round": 1, "worker": "coder",
               "paths": ["a/b.py", "a/test_b.py"], "test": "a/test_b.py"}
        if plan_dev:
            job["plan_dev"] = plan_dev
        self.d = self.new()
        self.d.save(job, "seeded")
        self.closes = []
        real = self.w.gh

        def gh(args):
            a = list(args)
            if a[0] == "api" and "/compare/" in a[1]:
                return json.dumps(["a/b.py"])
            if a[:2] == ["issue", "close"]:
                self.closes.append(a)
                return ""
            return real(a)

        self.d.gh = gh

    def run_build(self, last):
        self.tick()
        self.w.finish("b1", "looked\n" + last)
        self.tick(2)

    def test_a_stale_job_that_ends_done_elsewhere_is_superseded_and_its_issue_closed(self):
        self.seed()
        self.run_build("DONE ELSEWHERE: #77")
        self.assertEqual(self.state(), "superseded")
        self.assertEqual(len(self.closes), 1)
        self.assertEqual(self.closes[0][:4], ["issue", "close", "5", "-R"])
        self.assertEqual(self.closes[0][4], "o/r")
        self.assertIn("#77", self.closes[0][self.closes[0].index("--comment") + 1])
        self.assertEqual(len(self.w.edits(5)), 1)
        self.assertIn("factory-done", self.w.edits(5)[0])
        self.assertEqual(self.w.merges, [])
        self.assertEqual(self.d.store.get_job("5")["done_by"], "#77")
        self.tick(3)
        self.assertEqual(len(self.closes), 1)

    def test_done_elsewhere_from_a_job_that_was_not_stale_is_blocked(self):
        self.seed(plan_dev=None)
        self.run_build("DONE ELSEWHERE: #77")
        self.assertEqual(self.state(), "blocked")
        self.assertEqual(self.closes, [])

    def test_a_reference_that_is_neither_a_pr_nor_a_commit_is_blocked(self):
        self.seed()
        self.run_build("DONE ELSEWHERE: it is all done")
        self.assertEqual(self.state(), "blocked")
        self.assertEqual(self.closes, [])

    def test_the_building_goal_accepts_done_elsewhere(self):
        forms = states.GOALS["building"]
        self.assertEqual(len(forms), 3)
        self.assertEqual(forms[-1]["prefix"], "DONE ELSEWHERE: ")


if __name__ == "__main__":
    unittest.main()
