import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import limits as M

T0 = "2026-11-12T08:00:00Z"


def at(seconds):
    return M.ts(T0) + seconds


class TestLimits(unittest.TestCase):
    def test_third_failure_returns_to_plan(self):
        self.assertEqual(M.fix_or_replan(0, M.FIX_BUILDS, 1, "test red"), ("FIX", "test red"))
        self.assertEqual(M.fix_or_replan(1, M.FIX_BUILDS, 1, "test red"), ("FIX", "test red"))
        action, why = M.fix_or_replan(2, M.FIX_BUILDS, 1, "test red")
        self.assertEqual(action, "PLAN")
        self.assertIn("test red", why)
        self.assertEqual(M.fix_or_replan(2, M.FIX_BUILDS, 3, "test red")[0], "BLOCKED")

    def test_job_ci_and_review_caps(self):
        self.assertEqual((M.FIX_BUILDS, M.JOB_FIXES, M.REVIEW_ROUNDS, M.PLAN_ROUNDS, M.FIRED_CAP), (2, 2, 2, 3, 20))
        self.assertEqual([M.fix_or_replan(n, M.REVIEW_ROUNDS, 1, "REJECT")[0] for n in range(3)], ["FIX", "FIX", "PLAN"])
        self.assertEqual([M.fix_or_replan(n, M.JOB_FIXES, 2, "gates red")[0] for n in range(3)], ["FIX", "FIX", "PLAN"])

    def test_plan_round_above_three_blocks(self):
        self.assertEqual(M.replan(1, "x"), ("PLAN", "x"))
        self.assertEqual(M.replan(2, "x"), ("PLAN", "x"))
        action, why = M.replan(3, "x")
        self.assertEqual(action, "BLOCKED")
        self.assertIn("plan_round 3/3", why)

    def test_challenge(self):
        self.assertEqual(M.challenge("READY", 0, 1, "ok"), ("BUILD", None))
        self.assertEqual(M.challenge("READY", 1, 2, "ok"), ("BUILD", None))
        self.assertEqual(M.challenge("REJECT", 0, 1, "1. no done-test"), ("PLAN", "1. no done-test"))
        self.assertEqual(M.challenge("REJECT", 1, 2, "1. still none")[0], "NEEDS_BOSS")
        self.assertEqual(M.challenge("REJECT", 0, 3, "1. x")[0], "BLOCKED")

    def test_fired_cap(self):
        self.assertEqual(M.may_fire(0), ("FIRE", None))
        self.assertEqual(M.may_fire(19), ("FIRE", None))
        action, why = M.may_fire(20)
        self.assertEqual(action, "BLOCKED")
        self.assertIn("20/20", why)


class TestRuns(unittest.TestCase):
    def test_45_minutes(self):
        start = "2026-11-12T08:00:00.123Z"
        self.assertEqual(M.run_outcome({"id": "r1", "status": "running", "started_at": start}, at(45 * 60)), ("RUNNING", None))
        action, why = M.run_outcome({"id": "r1", "status": "running", "started_at": start}, at(45 * 60 + 1))
        self.assertEqual(action, "CANCEL")
        self.assertIn("run r1 still running", why)

    def test_wall_time_configurable(self):
        row = {"id": "r2", "status": "running", "started_at": T0}
        self.assertEqual(M.run_outcome(row, at(90), cfg={"run_limit_s": 90}), ("RUNNING", None))
        self.assertEqual(M.run_outcome(row, at(91), cfg={"run_limit_s": 90})[0], "CANCEL")
        self.assertEqual(M.run_outcome(row, at(91), cfg={"run_limit_s": None})[0], "RUNNING")

    def test_stall_cancels(self):
        row = {"id": "r3", "status": "running", "started_at": T0}
        steps = {"last_step_at": "2026-11-12T08:05:00Z", "tokens": 0}
        self.assertEqual(M.run_outcome(row, at(300 + 600), steps), ("RUNNING", None))
        action, why = M.run_outcome(row, at(300 + 601), steps)
        self.assertEqual(action, "CANCEL")
        self.assertIn("stalled", why)
        self.assertEqual(M.run_outcome(row, at(61), {"last_step_at": None}, {"stall_s": 60})[0], "CANCEL")
        self.assertEqual(M.run_outcome(row, at(900), steps, {"stall_s": 0})[0], "RUNNING")

    def test_token_cap_cancels(self):
        row = {"id": "r4", "status": "running", "started_at": T0}
        steps = {"last_step_at": T0, "tokens": 1000}
        self.assertEqual(M.run_outcome(row, at(5), steps, {"token_cap": 1000}), ("RUNNING", None))
        action, why = M.run_outcome(row, at(5), dict(steps, tokens=1001), {"token_cap": 1000})
        self.assertEqual(action, "CANCEL")
        self.assertIn("tokens", why)
        self.assertEqual(M.run_outcome(row, at(5), dict(steps, tokens=10**9))[0], "RUNNING")

    def test_outcomes(self):
        now = at(60)
        self.assertEqual(M.run_outcome({"status": "done"}, now), ("DONE", None))
        self.assertEqual(M.run_outcome({"status": "error", "error": "interrupted: engine restarted"}, now), ("RESTARTED", None))
        self.assertEqual(M.run_outcome({"status": "error", "error": "provider 529"}, now)[0], "REFIRE_ONCE")
        self.assertEqual(M.run_outcome({"status": "cancelled"}, now)[0], "FAILED")
        self.assertEqual(M.run_outcome(None, now)[0], "MISSING")

    def test_restart_refires_once(self):
        self.assertEqual(M.restart(0), ("REFIRE", None))
        self.assertEqual(M.restart(1)[0], "FAILED")

    def test_ci_not_started_after_30_minutes(self):
        self.assertFalse(M.ci_overdue(T0, at(30 * 60)))
        self.assertTrue(M.ci_overdue(T0, at(30 * 60 + 1)))

    def test_pending_firing_resolution(self):
        firing = "2026-11-12T08:02:11Z"
        rows = [{"id": "old", "trigger_slug": "factory-build", "started_at": "2026-11-12T08:01:00.000Z"},
                {"id": "other", "trigger_slug": "factory-plan", "started_at": "2026-11-12T08:02:12.000Z"},
                {"id": "later", "trigger_slug": "factory-build", "started_at": "2026-11-12T08:05:00.000Z"},
                {"id": "mine", "trigger_slug": "factory-build", "started_at": "2026-11-12T08:02:11.123Z"},
                {"id": "noslug", "trigger_slug": None, "started_at": "2026-11-12T08:02:11.500Z"}]
        f = M.ts(firing)
        self.assertEqual(M.resolve_pending(firing, "factory-build", rows, f + 1, 120), ("RUN", "mine"))
        self.assertEqual(M.resolve_pending(firing, "factory-review", rows, f + 3 * 120 - 1, 120), ("WAIT", None))
        action, why = M.resolve_pending(firing, "factory-review", rows, f + 3 * 120, 120)
        self.assertEqual(action, "FAILED")
        self.assertIn("factory-review", why)

    def test_ts_forms(self):
        self.assertEqual(M.ts("2026-11-12T08:00:00Z"), M.ts("2026-11-12T08:00:00+00:00"))
        self.assertAlmostEqual(M.ts("2026-11-12T08:00:00.250Z") - M.ts(T0), 0.25)


class TestReplan(unittest.TestCase):
    OLD = """## Goal
x
## Chunks
- [ ] 1. One | builder: larry | test: factory t/test_a.py | done-test: test_a::A::test_a | paths: t/a.py, t/test_a.py | max-lines: 300 | depends on: -
- [ ] 2. Two | builder: larry | test: factory t/test_b.py | done-test: test_b::B::test_b | paths: t/b.py, t/test_b.py | max-lines: 300 | depends on: 1
## Risks
"""

    def test_merged_chunks_must_stay(self):
        lines = M.L.chunk_lines(self.OLD)
        new_ok = "## Chunks\n" + lines[0].replace("- [ ]", "- [x]") + "\n" + lines[1].replace("Two", "Two, smaller") + "\n- [ ] 3. Three | builder: x\n"
        self.assertEqual(M.keeps_merged(self.OLD, new_ok, {"1"}), ("OK", None))
        changed = "## Chunks\n" + lines[0].replace("One", "One again") + "\n" + lines[1] + "\n"
        self.assertEqual(M.keeps_merged(self.OLD, changed, {"1"}), ("BLOCKED", "re-plan changes merged chunk(s): 1"))
        self.assertEqual(M.keeps_merged(self.OLD, "## Chunks\n" + lines[1] + "\n", {"1", "2"}), ("BLOCKED", "re-plan changes merged chunk(s): 1"))
        self.assertEqual(M.keeps_merged(self.OLD, "## Chunks\n" + lines[1] + "\n", set()), ("OK", None))


if __name__ == "__main__":
    unittest.main()
