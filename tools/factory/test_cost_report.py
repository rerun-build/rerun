import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import snapshot
import store as ledger_store
import tokenstats

NOW = limits.ts("2026-11-15T12:00:00Z")
DAY = 86400
TABLE = {"models": {"cheap": {"input": 1, "cache_read": 0.1, "cache_write": 1.25, "output": 5},
                    "dear": {"input": 8, "cache_read": 0.2, "cache_write": 10, "output": 40}}}
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


def merged(job, ago, result="green"):
    return {"job": job, "merged_at": NOW - ago, "dev_result": result, "fix_rounds": 0, "replans": 0}


class CostPerIssue(unittest.TestCase):
    def test_cost_per_issue_is_the_units_of_the_window_over_the_green_solved(self):
        jobs = [merged("1", 10), merged("2", 20)]
        fires = [{"at": NOW - 5, "tokens": 500, "units": 3.0}, {"at": NOW - 2 * DAY, "tokens": 500, "units": 1.0}]
        out = tokenstats.bar(jobs, fires, [], NOW)
        self.assertAlmostEqual(out["day"]["costPerIssue"], 1.5)
        self.assertAlmostEqual(out["week"]["costPerIssue"], 2.0)
        self.assertIsNone(tokenstats.bar([], fires, [], NOW)["day"]["costPerIssue"])


class DigestCost(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def job(self, n, state, at, **extra):
        data = {"issue": n, "title": "T", "body": "**Depends on**: none\n"}
        data.update(extra)
        self.st.put_job(str(n), state, data, "r", at="2026-11-15T%sZ" % at)

    def fire(self, job, stage, run, tin, tout, model=None, thinking=None, cache_read=None):
        fid = self.st.intent(job, "", stage, at="2026-11-15T09:30:00Z", model=model, thinking=thinking)
        self.st.fired(fid, run)
        self.st.close_run(run, "done", tokens_in=tin, tokens_out=tout, cache_read=cache_read)

    def one_green_issue(self):
        self.job(1, "queued", "08:00:00")
        self.job(1, "merged", "09:00:00", dev_result="green")

    def test_the_digest_splits_cost_by_station_model_and_thinking_level(self):
        self.one_green_issue()
        self.fire("1", "build", "r1", 1000000, 100000, model="cheap", thinking="high", cache_read=500000)
        self.fire("1", "review", "r2", 1000000, 0, model="dear", thinking="medium")
        self.fire("plan:9", "plan", "r3", 1000000, 0)
        cost = digest.cost(self.st, NOW, TABLE, None)
        self.assertAlmostEqual(cost["perIssue"], 17.05)
        self.assertEqual([r["name"] for r in cost["byStation"]], ["build", "plan", "review"])
        self.assertEqual([r["name"] for r in cost["byModel"]], ["cheap", "dear", "unknown"])
        self.assertEqual([r["name"] for r in cost["byThinking"]], ["high", "medium", "none"])
        build = cost["byStation"][0]
        self.assertEqual((build["runs"], build["tokens"]), (1, 1100000))
        self.assertAlmostEqual(build["units"], 1.05)
        self.assertAlmostEqual(build["unitsPerIssue"], 1.05)
        self.assertEqual(cost["unweighed"], ["unknown"])

    def test_without_a_plan_reading_the_weights_are_uncalibrated(self):
        self.one_green_issue()
        self.assertEqual(digest.cost(self.st, NOW, TABLE, None)["calibration"],
                         {"state": "uncalibrated", "unitsPerPlanPercent": None})

    def test_with_two_plan_readings_of_the_day_the_digest_shows_units_per_plan_percent(self):
        self.one_green_issue()
        self.fire("1", "build", "r1", 1000000, 100000, model="cheap", thinking="high", cache_read=500000)
        self.fire("1", "review", "r2", 1000000, 0, model="dear", thinking="medium")
        self.fire("plan:9", "plan", "r3", 1000000, 0)
        morning = limits.ts("2026-11-15T09:00:00Z")
        first = digest.cost(self.st, morning, TABLE, {"weekUsedPercent": 40})["calibration"]
        self.assertEqual(first, {"state": "uncalibrated", "unitsPerPlanPercent": None})
        later = digest.cost(self.st, NOW, TABLE, {"weekUsedPercent": 42})["calibration"]
        self.assertEqual(later["state"], "calibrated")
        self.assertAlmostEqual(later["unitsPerPlanPercent"], 17.05 / 2)

    def test_the_digest_and_its_bar_carry_the_cost(self):
        self.one_green_issue()
        self.fire("1", "build", "r1", 1000000, 100000, model="cheap", thinking="high")
        d = digest.build(self.st, CFG, NOW, plan=None)
        self.assertEqual(d["cost"]["calibration"], {"state": "uncalibrated", "unitsPerPlanPercent": None})
        self.assertIsNotNone(d["bar"]["day"]["costPerIssue"])
        snap = snapshot.build_snapshot(self.st, CFG, NOW, None, plan=None)
        self.assertEqual(snap["digest"]["cost"], d["cost"])
        self.assertEqual(snap["digest"]["bar"]["day"]["costPerIssue"], d["bar"]["day"]["costPerIssue"])


if __name__ == "__main__":
    unittest.main()
