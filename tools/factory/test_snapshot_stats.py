import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import store as ledger_store

NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


class RunStats(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def run_of(self, seconds, status, ended_ago=3600, end_form="%sZ"):
        n = len(self.st.db.execute("SELECT id FROM fires").fetchall())
        end = NOW - ended_ago
        fid = self.st.intent("5", "c%d" % n, "build", coworker="CODE", at=snapshot.iso(end - seconds))
        self.st.fired(fid, "run-%d" % n)
        if status:
            self.st.close_run("run-%d" % n, status, at=end_form % snapshot.iso(end)[:-1])

    def stats(self):
        return snapshot.build_snapshot(self.st, CFG, NOW, None)["runStats"]

    def test_counts_the_runs_that_ended_done_or_in_error_in_the_last_day(self):
        self.run_of(100, "done")
        self.run_of(200, "done")
        self.run_of(60, "error")
        self.run_of(500, "cancelled")
        self.run_of(500, None)
        self.run_of(900, "done", ended_ago=25 * 3600)
        self.assertEqual(self.stats(), {"since": snapshot.iso(NOW - 86400), "finished": 3, "errors": 1, "avgRunS": 120.0})

    def test_no_finished_run_gives_zero_and_no_average(self):
        self.run_of(500, None)
        self.assertEqual(self.stats(), {"since": snapshot.iso(NOW - 86400), "finished": 0, "errors": 0, "avgRunS": None})

    def test_an_end_time_the_account_wrote_with_milliseconds_counts(self):
        self.run_of(90, "done", end_form="%s.000Z")
        self.assertEqual((self.stats()["finished"], self.stats()["avgRunS"]), (1, 90.0))


if __name__ == "__main__":
    unittest.main()
