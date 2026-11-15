import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T

PLAN = "PLAN READY (facts read on dev 4296d1f)"


class PlanDev(T.Base):
    def job_data(self, n=5):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job=?", str(n))[0][0])

    def put(self, body):
        self.w.issues = [{"number": 5, "title": "Fix x", "body": body, "comments": []}]

    def test_a_queued_job_keeps_the_dev_commit_of_its_plan_line(self):
        self.put(T.ready(PLAN))
        self.tick()
        self.assertEqual(self.job_data()["plan_dev"], "4296d1f")

    def test_a_waiting_job_keeps_it_too(self):
        self.put(T.ready(PLAN, "#7"))
        self.tick()
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(self.job_data()["plan_dev"], "4296d1f")

    def test_a_plan_line_without_a_commit_is_not_taken(self):
        self.put(T.ready("PLAN READY"))
        self.tick()
        self.assertEqual(self.w.rows("SELECT job FROM jobs"), [])
        self.assertEqual(len(self.w.issue(5)["comments"]), 1)
        self.assertIn("dev <sha>", self.w.issue(5)["comments"][0])

    def test_a_body_without_a_plan_line_is_taken_with_no_commit(self):
        self.put(T.ready("intro"))
        self.tick()
        self.assertIsNone(self.job_data()["plan_dev"])


if __name__ == "__main__":
    unittest.main()
