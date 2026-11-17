import contextlib, io, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import digest
import limits
import store as ledger_store

NOW = limits.ts("2026-11-17T12:00:00Z")
TABLE = {"models": {"m": {"input": 1, "cache_read": 0, "cache_write": 0, "output": 1}}}


def body(parent=None):
    if parent is None:
        return "**Depends on**: none\n"
    return "**Part of**: #%d\n**Depends on**: none\n" % parent


class Rework(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)
        self.n = 0

    def job(self, n, state="merged", dev="green", at="2026-11-16T09:00:00Z", parent=None):
        self.st.put_job(str(n), state, {"issue": n, "title": "T", "body": body(parent), "dev_result": dev}, None, at=at)

    def fire(self, job, stage, tin=1000000, tout=0, model="m"):
        self.n += 1
        run = "run%d" % self.n
        fid = self.st.intent(str(job), "", stage, model=model, at="2026-11-16T10:00:00Z")
        self.st.fired(fid, run)
        self.st.close_run(run, "done", at="2026-11-16T10:00:00Z", tokens_in=tin, tokens_out=tout)

    def test_build_and_fix_runs_per_issue_solved_green(self):
        self.job(1)
        self.fire(1, "build")
        self.fire(1, "build")
        self.fire(1, "fix of #90")
        self.fire(1, "review", tin=5000000)
        self.job(2)
        self.fire(2, "build")
        self.job(3, dev="red")
        self.fire(3, "build")
        self.fire(3, "build")
        self.fire(3, "build")
        runs, units, top = digest.rework(self.st, TABLE)
        self.assertEqual(runs, 2.0)
        self.assertEqual(units, 2.0)
        self.assertEqual(top, [("-", 2)])

    def test_only_the_last_twenty_solved_count(self):
        for n in range(1, 22):
            self.job(n, at="2026-11-16T%02d:00:00Z" % n)
            self.fire(n, "build")
        self.job(100, at="2026-11-01T00:00:00Z")
        self.fire(100, "build")
        self.fire(100, "build")
        runs, _, _ = digest.rework(self.st, TABLE)
        self.assertEqual(len(digest.solved_green(self.st)), 20)
        self.assertEqual(runs, 1.0)

    def test_no_issue_solved_green_measures_no_rework(self):
        self.job(1, dev="red")
        self.fire(1, "build")
        self.assertEqual(digest.rework(self.st, TABLE), (None, None, []))

    def test_top_names_the_plans_with_most_extra_runs(self):
        self.job(1, parent=8)
        for _ in range(5):
            self.fire(1, "build")
        self.job(2, parent=10)
        for _ in range(4):
            self.fire(2, "build")
        self.job(3, parent=7)
        self.fire(3, "build")
        self.job(4)
        for _ in range(3):
            self.fire(4, "build")
        _, _, top = digest.rework(self.st, TABLE)
        self.assertEqual(top, [("plan:8", 4), ("plan:10", 3), ("-", 2)])

    def test_above_the_threshold_raises_one_rework_anomaly(self):
        self.job(1, parent=8)
        for _ in range(5):
            self.fire(1, "build")
        self.job(2, parent=10)
        for _ in range(4):
            self.fire(2, "build")
        found = [a for a in digest.anomalies(self.st, {"rework_threshold": 1.3}, NOW) if a["kind"] == "rework"]
        self.assertEqual(len(found), 1)
        self.assertIsNone(found[0]["issue"])
        self.assertLessEqual(len(found[0]["detail"]), 200)
        self.assertIn("4.5 build and fix runs", found[0]["detail"])
        self.assertIn("plan:8 +4, plan:10 +3", found[0]["detail"])

    def test_at_or_below_the_threshold_raises_nothing(self):
        self.job(1)
        self.fire(1, "build")
        self.assertEqual([a for a in digest.anomalies(self.st, {"rework_threshold": 1.3}, NOW) if a["kind"] == "rework"], [])

    def test_the_threshold_is_held_to_its_bound(self):
        self.job(1)
        for _ in range(4):
            self.fire(1, "build")
        found = [a for a in digest.anomalies(self.st, {"rework_threshold": 50}, NOW) if a["kind"] == "rework"]
        self.assertEqual(len(found), 1)

    def test_a_bad_threshold_reads_as_one_point_three(self):
        self.job(1)
        for _ in range(2):
            self.fire(1, "build")
        for bad in (None, 0, -2, "x", True):
            found = [a for a in digest.anomalies(self.st, {"rework_threshold": bad}, NOW) if a["kind"] == "rework"]
            self.assertEqual(len(found), 1, bad)

    def test_the_alarm_is_one_failure_per_day(self):
        d = {"anomalies": [{"kind": "rework", "issue": None, "detail": "2.0 build and fix runs (1.00 cost units) per issue solved green, last 20, threshold 1.3"}]}
        digest.alarm(self.st, d, NOW)
        digest.alarm(self.st, d, NOW + 600)
        rows = [f for f in self.st.failures() if f["kind"] == "rework"]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["job"], rows[0]["station"]), ("-", "plan"))
        digest.alarm(self.st, d, NOW + 86400)
        self.assertEqual(len([f for f in self.st.failures() if f["kind"] == "rework"]), 2)
        digest.alarm(self.st, {"anomalies": []}, NOW + 2 * 86400)
        self.assertEqual(len([f for f in self.st.failures() if f["kind"] == "rework"]), 2)


class Beat(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.t = NOW
        self.n = 0

        def account(tool, args, timeout=30):
            return {}

        def gh(args):
            if args[0] == "issue":
                return json.dumps([{"number": 700, "title": "Factory control"}])
            return "[]"

        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"), "json_state_file": os.path.join(tmp.name, "d.json"),
               "heartbeat_file": os.path.join(tmp.name, "hb"),
               "builders": [{"id": "b1", "name": "B1"}], "reviewers": [{"id": "r1", "name": "R1"}]}
        self.d = D.Dispatcher(cfg, account, gh, now=lambda: self.t)
        self.addCleanup(self.d.close)

    def job(self, n, parent=None):
        self.d.store.put_job(str(n), "merged", {"issue": n, "title": "T", "body": body(parent), "dev_result": "green"}, None,
                             at="2026-11-16T09:00:00Z")

    def fire(self, job, stage):
        self.n += 1
        run = "beat%d" % self.n
        fid = self.d.store.intent(str(job), "", stage, model="m", at="2026-11-16T10:00:00Z")
        self.d.store.fired(fid, run)
        self.d.store.close_run(run, "done", at="2026-11-16T10:00:00Z", tokens_in=1000000, tokens_out=0)

    def beat(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.d.once()

    def rework_rows(self):
        return [f for f in self.d.store.failures() if f["kind"] == "rework"]

    def test_the_beat_raises_the_alarm_once(self):
        self.job(1, parent=8)
        for _ in range(5):
            self.fire(1, "build")
        self.job(2, parent=10)
        for _ in range(4):
            self.fire(2, "build")
        self.beat()
        rows = self.rework_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["job"], rows[0]["station"]), ("-", "plan"))
        self.assertIn("4.5 build and fix runs", rows[0]["reason"])
        self.t += 600
        self.beat()
        self.assertEqual(len(self.rework_rows()), 1)


if __name__ == "__main__":
    unittest.main()
