import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store
import tokenstats

NOW = limits.ts("2026-11-15T12:00:00Z")


def fire(job, stage, who, tin, tout, cr, chunk="A"):
    return {"job": job, "chunk": chunk, "stage": stage, "coworker": who, "tokens_in": tin, "tokens_out": tout, "cache_read": cr}


class PlanShare(unittest.TestCase):
    def test_plan_fire_is_shared_over_its_merged_children(self):
        fires = [fire("plan:9", "plan", "planner", 1000, 200, 400, chunk=""),
                 fire(1, "build", "code", 100, 10, None), fire(2, "build", "code", 100, 10, None)]
        merged = [(1, "A"), (2, "A")]
        out = tokenstats.per_merged(fires, merged, "stage", parents={(1, "A"): 9, (2, "A"): 9})
        self.assertEqual(out["plan"]["changes"], 2)
        self.assertEqual(out["plan"]["tokens_in"], 500)
        self.assertEqual(out["plan"]["tokens_out"], 100)
        self.assertEqual(out["plan"]["cache_read"], 200)
        self.assertEqual(out["build"]["changes"], 2)

    def test_without_parents_result_is_unchanged(self):
        fires = [fire(1, "build", "code", 1000, 100, 800), fire(2, "build", "code", 1000, 100, 800),
                 fire(1, "fix", "code", 600, 50, 300), fire("plan:9", "plan", "planner", 1000, 200, 400, chunk="")]
        merged = [(1, "A"), (2, "A")]
        out = tokenstats.per_merged(fires, merged, "stage")
        self.assertEqual(out, tokenstats.per_merged(fires, merged, "stage", parents=None))
        self.assertNotIn("plan", out)
        self.assertEqual(out["build"]["tokens_in"], 1000)
        self.assertEqual(out["fix"]["changes"], 1)


class MeasuresPlan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, when, body):
        self.st.put_job(str(n), state, {"issue": n, "title": "T", "body": body}, "r", at="2026-11-15T%sZ" % when)

    def fire(self, job, run, tin, tout):
        fid = self.st.intent(job, "", "build")
        self.st.fired(fid, run)
        self.st.close_run(run, "done", tokens_in=tin, tokens_out=tout)

    def test_measures_adds_the_parent_plan_once(self):
        body = "**Part of**: #9\n**Depends on**: none\n"
        for n in (61, 62):
            self.put(n, "queued", "08:00:00", body)
            self.put(n, "merged", "09:00:00", body)
            self.fire(str(n), "r%d" % n, 100, 0)
        self.fire("plan:9", "rp", 1000, 0)
        self.assertEqual(digest.measures(self.st, NOW)["tokensPerMerged"], 600)
