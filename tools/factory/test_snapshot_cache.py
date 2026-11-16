import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import store as ledger_store

NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


class CacheRead(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)
        self.st.put_job("1", "building", {"issue": 1, "title": "T1", "body": "**Depends on**: none\n"}, None)
        self.n = 0

    def fire(self, cache_read):
        self.n += 1
        rid = "run-%d" % self.n
        fid = self.st.intent("1", "", "build", coworker="CODE")
        self.st.fired(fid, rid)
        self.st.close_run(rid, "done", tokens_in=1, tokens_out=2, cache_read=cache_read)

    def runs(self):
        snap = snapshot.build_snapshot(self.st, CFG, NOW, None)
        return next(j for j in snap["jobs"] if j["issue"] == 1)["runs"]

    def test_cache_read_is_shown(self):
        self.fire(700)
        self.assertEqual(self.runs()[0]["cacheRead"], 700)

    def test_zero_is_kept(self):
        self.fire(0)
        self.assertEqual(self.runs()[0]["cacheRead"], 0)

    def test_none_has_no_key(self):
        self.fire(None)
        self.assertNotIn("cacheRead", self.runs()[0])

    def test_mixed_runs_in_order(self):
        self.fire(700)
        self.fire(None)
        self.assertEqual([r.get("cacheRead") for r in self.runs()], [700, None])
