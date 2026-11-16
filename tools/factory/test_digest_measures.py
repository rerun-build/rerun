import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store

NOW = limits.ts("2026-11-15T12:00:00Z")
BODY = "**Depends on**: none\n"
EMPTY = {"mergedPerHour": 0.0, "leadTimeS": None, "firstPassYield": None, "fixRounds": None,
         "blocks": {"blocked": 0, "rejected": 0, "failed": 0, "returned": 0, "unsolvable": 0}, "tokensPerMerged": None,
         "escalated": 0, "escalatedMerged": 0}


class Measures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, when):
        at = when if "T" in when else "2026-11-15T%sZ" % when
        self.st.put_job(str(n), state, {"issue": n, "title": "T", "body": BODY}, "r", at=at)

    def fire(self, n, run, tin, tout):
        fid = self.st.intent(str(n), "", "build")
        self.st.fired(fid, run)
        self.st.close_run(run, "done", tokens_in=tin, tokens_out=tout)

    def test_an_empty_store_measures_nothing(self):
        self.assertEqual(digest.measures(self.st, NOW), EMPTY)

    def test_the_window_measures_merges_fixes_blocks_and_tokens(self):
        self.put(61, "queued", "08:00:00")
        self.put(61, "merged", "09:00:00")
        self.put(62, "queued", "09:00:00")
        self.put(62, "fix_wait", "09:30:00")
        self.put(62, "merged", "11:00:00")
        self.put(63, "queued", "2026-11-13T08:00:00Z")
        self.put(63, "merged", "2026-11-13T09:00:00Z")
        self.put(64, "queued", "09:00:00")
        self.put(64, "blocked", "10:00:00")
        self.put(65, "queued", "09:00:00")
        self.put(65, "failed", "11:00:00")
        self.fire(61, "r1", 1000, 500)
        self.fire(61, "r2", 200, 100)
        self.fire(62, "r3", 3000, 1000)
        self.fire(63, "r4", 99999, 1)
        self.assertEqual(digest.measures(self.st, NOW), {
            "mergedPerHour": 0.08, "leadTimeS": 5400.0, "firstPassYield": 0.5, "fixRounds": 0.5,
            "blocks": {"blocked": 1, "rejected": 0, "failed": 1, "returned": 0, "unsolvable": 0}, "tokensPerMerged": 2900.0,
            "escalated": 0, "escalatedMerged": 0})


if __name__ == "__main__":
    unittest.main()
