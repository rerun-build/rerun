import unittest
from test_dispatch import Base


class PlanRuns(Base):
    def setUp(self):
        super().setUp()
        self.w.issues = [{"number": 5, "title": "Plan me", "body": "Free text, no plan line.", "labels": [{"name": "P0"}],
                          "createdAt": "2026-11-01T00:00:00Z", "comments": []}]
        self.cfg["types"] = {"planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}, {"id": "p2", "name": "IKE", "runs": 1}]}}
        self.cfg["planning"] = {"plan_by": ["Boss"], "cut_by": ["IKE"]}

    def plan_run(self):
        return [r for r, a in self.w.order if a == "p1"][-1]

    def fire_rows(self, job):
        return self.w.rows("SELECT status, tokens_in, tokens_out, cache_read FROM fires WHERE job=?", job)

    def test_done_plan_run_closes_its_fire_with_tokens(self):
        self.tick()
        self.w.finish("p1", "PLAN: the plan is ready")
        self.w.runs[self.plan_run()].update(inputTokens=1000, outputTokens=50, cachedInputTokens=900)
        self.tick()
        self.assertEqual(self.fire_rows("plan:5"), [("done", 1000, 50, 900)])

    def test_plan_run_cancelled_at_limit_closes_as_error_with_tokens(self):
        self.tick()
        self.w.runs[self.plan_run()].update(inputTokens=400, outputTokens=20, cachedInputTokens=0)
        self.w.clock += 3000
        self.tick()
        self.assertEqual(self.fire_rows("plan:5"), [("error", 400, 20, 0)])
        self.assertEqual(self.w.rows("SELECT v FROM kv WHERE job='plan:5' AND k='state'"), [("resend",)])

    def test_lost_send_abandons_the_fire(self):
        self.tick()
        fid = self.d.store.intent("plan:5", "", "plan", coworker="Boss", at="2026-11-13T18:00:00Z")
        self.d.store.set("plan:5", "state", "sending")
        self.d.store.set("plan:5", "fire", fid)
        self.tick()
        self.assertEqual(self.w.rows("SELECT status, error FROM fires WHERE id=?", fid),
                         [("lost", "the send was cut off before a run id was kept")])


class ReplanRuns(Base):
    def setUp(self):
        super().setUp()
        self.cfg["types"] = {
            "coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
            "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]},
            "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}, {"id": "p2", "name": "IKE", "runs": 1}]},
        }

    def test_replan_run_is_closed_when_it_ends(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: plan: a file outside its paths")
        self.tick()
        self.assertEqual(self.state(), "returned")
        run = [r for r, a in self.w.order if a == "p1"][-1]
        self.assertEqual(self.w.rows("SELECT status FROM fires WHERE run_id=?", run), [("running",)])
        self.tick()
        self.assertEqual(self.w.rows("SELECT status FROM fires WHERE run_id=?", run), [("running",)])
        self.w.finish("p1", "PLAN: done")
        self.w.runs[run].update(inputTokens=1000, outputTokens=50, cachedInputTokens=900)
        self.tick()
        self.assertEqual(self.w.rows("SELECT status, tokens_in, tokens_out, cache_read FROM fires WHERE run_id=?", run),
                         [("done", 1000, 50, 900)])


if __name__ == "__main__":
    unittest.main()
