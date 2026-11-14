import json, os, re, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import store as ledger_store

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "packages", "contracts")
SAMPLE = os.path.join(ROOT, "fixtures", "factory-snapshot.sample.json")
NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


class History(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, reason=None, at=None, **data):
        d = {"issue": n, "title": "T%d" % n, "body": "**Depends on**: none\n"}
        d.update(data)
        self.st.put_job(str(n), state, d, reason, at=at)

    def build(self):
        return snapshot.build_snapshot(self.st, CFG, NOW, None)

    def job(self, n):
        return next(j for j in self.build()["jobs"] if j["issue"] == n)

    def fire(self_, n, coworker="CODE", tin=0, tout=0, close=True):
        rid = "run-%d-%d" % (n, len(self_.st.db.execute("SELECT id FROM fires").fetchall()))
        fid = self_.st.intent(str(n), "", "build", coworker=coworker)
        self_.st.fired(fid, rid)
        if close:
            self_.st.close_run(rid, "done", tokens_in=tin, tokens_out=tout)
        return rid

    def test_history_is_the_state_changes_oldest_first(self):
        self.put(1, "building", at="2026-11-14T01:00:00Z")
        self.put(1, "building", at="2026-11-14T01:30:00Z")
        self.put(1, "reviewing", at="2026-11-14T02:00:00Z")
        self.put(1, "building", reason="fix it", at="2026-11-14T03:00:00Z")
        h = self.job(1)["history"]
        self.assertEqual([(x["state"], x["at"], x["reason"]) for x in h], [
            ("building", "2026-11-14T01:00:00Z", None), ("reviewing", "2026-11-14T02:00:00Z", None),
            ("building", "2026-11-14T03:00:00Z", "fix it")])
        self.assertEqual(set(h[0]), {"state", "at", "reason", "runId"})

    def test_history_is_cut_to_30_and_reasons_to_300(self):
        for i in range(40):
            self.put(1, "building" if i % 2 == 0 else "reviewing", reason="r" * 400 + str(i))
        h = self.job(1)["history"]
        self.assertEqual(len(h), 30)
        self.assertTrue(all(len(x["reason"]) == 300 for x in h))
        self.assertEqual(h[-1]["state"], "reviewing")

    def test_runs_come_from_the_fires_of_the_job(self):
        self.put(2, "building")
        r1 = self.fire(2, tin=10, tout=20)
        r2 = self.fire(2, close=False)
        runs = self.job(2)["runs"]
        self.assertEqual(len(runs), 2)
        self.assertEqual(set(runs[0]), {"stage", "coworkerId", "status", "startedAt", "endedAt", "tokensIn", "tokensOut", "runId"})
        self.assertEqual((runs[0]["stage"], runs[0]["status"], runs[0]["tokensIn"], runs[0]["tokensOut"], runs[0]["runId"]),
                         ("build", "done", 10, 20, r1))
        self.assertIsNotNone(runs[0]["endedAt"])
        self.assertEqual((runs[1]["status"], runs[1]["endedAt"], runs[1]["tokensIn"], runs[1]["runId"]), ("running", None, 0, r2))

    def test_runs_are_cut_to_the_last_12(self):
        self.put(3, "building")
        ids = [self.fire(3) for _ in range(15)]
        self.assertEqual([r["runId"] for r in self.job(3)["runs"]], ids[-12:])

    def test_run_coworker_id_is_looked_up_by_name(self):
        self.put(4, "building")
        self.fire(4, "CODE")
        self.fire(4, "GONE")
        self.assertEqual([r["coworkerId"] for r in self.job(4)["runs"]], ["b1", "GONE"])

    def test_pool_coworkers_carry_their_id(self):
        self.put(5, "queued")
        pools = self.build()["pools"]
        self.assertEqual(pools[0]["coworkers"][0]["id"], "b1")
        self.assertEqual(pools[1]["coworkers"][0]["id"], "r1")

    def test_300_jobs_with_full_history_stay_under_the_cap(self):
        cap = int(re.search(r"FACTORY_SNAPSHOT_MAX_BYTES = (\d+) \* 1024", open(os.path.join(ROOT, "src", "factory-snapshot.ts")).read()).group(1)) * 1024
        for n in range(1, 301):
            end = n % 2 == 1
            for i in range(31):
                self.put(n, "building" if i % 2 == 0 else "reviewing", reason="x" * 300, at="2026-11-14T00:%02d:%02dZ" % (n // 60, n % 60))
            if end:
                self.put(n, "merged", at="2026-11-14T00:%02d:%02dZ" % (n // 60, n % 60))
            for _ in range(12):
                self.fire(n)
        snap = self.build()
        self.assertLessEqual(len(json.dumps(snap, separators=(",", ":")).encode()), cap)
        self.assertEqual(len(snap["jobs"]), 300)
        ended = [j for j in snap["jobs"] if j["state"] == "merged"]
        self.assertTrue(any(j["history"] == [] and j["runs"] == [] for j in ended))
        self.assertTrue(any(j["history"] and j["runs"] for j in snap["jobs"] if j["state"] != "merged"))

    def test_the_picture_validates_against_the_contract_shape(self):
        sample = json.load(open(SAMPLE))
        jk = set().union(*[set(j) for j in sample["jobs"]])
        hk = set().union(*[set(h) for j in sample["jobs"] for h in j.get("history", [])])
        rk = set().union(*[set(r) for j in sample["jobs"] for r in j.get("runs", [])])
        pk = set().union(*[set(c) for p in sample["pools"] for c in p["coworkers"]])
        self.put(6, "building", reason="a")
        self.put(6, "reviewing")
        self.fire(6)
        snap = self.build()
        for j in snap["jobs"]:
            self.assertLessEqual(set(j), jk)
            for h in j["history"]:
                self.assertLessEqual(set(h), hk)
            for r in j["runs"]:
                self.assertLessEqual(set(r), rk)
        for p in snap["pools"]:
            for c in p["coworkers"]:
                self.assertEqual(set(c), pk)


if __name__ == "__main__":
    unittest.main()
