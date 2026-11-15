import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store

NOW = limits.ts("2026-11-15T12:00:00Z")
BODY = "**Depends on**: none\n"


class Anomalies(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, hhmmss, reason=None):
        self.st.put_job(str(n), state, {"issue": n, "title": "T", "body": BODY}, reason, at="2026-11-15T%sZ" % hhmmss)

    def fixture(self, proofs=(70, 71, 72, 73, 74)):
        self.put(51, "queued", "09:00:00")
        self.put(51, "building", "10:00:00")
        self.put(52, "queued", "09:00:00")
        self.put(52, "building", "11:30:00")
        for n, a, b in ((53, "proof failed: 2", "proof failed: 2"), (54, "a", "b")):
            self.put(n, "fix_wait", "08:00:00", a)
            self.put(n, "fixing", "08:10:00", None)
            self.put(n, "fix_wait", "08:20:00", b)
        for n in proofs:
            self.put(n, "proving", "09:00:00", None)
            self.put(n, "fix_wait" if n <= 72 else "checks", "09:30:00", None)

    def fire(self, issue, at, tin, tout, rid):
        fid = self.st.intent(str(issue), "", "build", at=at)
        self.st.fired(fid, rid)
        self.st.close_run(rid, "done", at=at, tokens_in=tin, tokens_out=tout)

    def test_the_fixture_lists_the_three_kinds_in_order(self):
        self.fixture()
        self.assertEqual(digest.anomalies(self.st, {}, NOW), [
            {"kind": "past_clock", "issue": 51, "detail": "building for 7200 s, limit 2700 s"},
            {"kind": "repeat_block", "issue": 53, "detail": "proof failed: 2"},
            {"kind": "proof_fail_rate", "issue": None, "detail": "3 of 5 proofs failed in 24 h"},
        ])

    def test_budget_burn_is_strictly_above_the_cap(self):
        self.fixture()
        self.fire(51, "2026-11-15T11:30:00Z", 1000, 500, "r1")
        self.fire(52, "2026-11-15T09:00:00Z", 9000, 1000, "r2")
        last = digest.anomalies(self.st, {"budget_tokens_per_hour": 1000}, NOW)[-1]
        self.assertEqual(last, {"kind": "budget_burn", "issue": None, "detail": "1500 tokens in the last hour, budget 1000"})
        for cfg in ({"budget_tokens_per_hour": 1500}, {}):
            self.assertNotIn("budget_burn", [a["kind"] for a in digest.anomalies(self.st, cfg, NOW)])

    def test_a_merged_job_with_a_repeated_reason_is_not_listed(self):
        self.put(60, "fix_wait", "08:00:00", "x")
        self.put(60, "fixing", "08:10:00", None)
        self.put(60, "fix_wait", "08:20:00", "x")
        self.put(60, "merged", "08:30:00", "x")
        self.assertEqual(digest.anomalies(self.st, {}, NOW), [])

    def test_three_failed_of_three_proofs_is_below_the_minimum_of_four(self):
        self.fixture(proofs=())
        for n in (70, 71, 72):
            self.put(n, "proving", "09:00:00", None)
            self.put(n, "fix_wait", "09:30:00", None)
        kinds = [a["kind"] for a in digest.anomalies(self.st, {}, NOW)]
        self.assertNotIn("proof_fail_rate", kinds)


if __name__ == "__main__":
    unittest.main()
