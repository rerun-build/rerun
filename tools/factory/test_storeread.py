import os, sqlite3, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import storeread
import store as ledger_store

NOW = 1794000000.0


class StoreRead(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = os.path.join(tmp.name, "l.db")
        st = ledger_store.Store(self.path)
        at = storeread.iso(NOW - 3600)
        st.add_failure("ended blocked", 5, station="build", reason="wt new rerun 5 refused at abcdef1234", at=at)
        st.add_failure("ended blocked", 6, station="build", reason="wt new rerun 6 refused at 1234567abc", at=at)
        st.add_failure("problem", 7, station="resolve", reason="dead #7: waits on #9", at=storeread.iso(NOW - 9 * 86400))
        st.put_job("5", "blocked", {"issue": 5, "title": "T", "body": ""}, "why", at=at)
        fid = st.intent("5", "", "build", coworker="CODE", at=storeread.iso(NOW - 4000))
        st.fired(fid, "run-1")
        st.close_run("run-1", "error", at=at, error="interrupted: engine restarted")
        st.set("escaped", "5|reopened", '{"job": "5"}')
        st.db.close()

    def read(self):
        db = sqlite3.connect("file:%s?mode=ro" % self.path, uri=True)
        self.addCleanup(db.close)
        return storeread.report(db, NOW)

    def test_groups_carry_their_counts_per_window_and_fold_reasons_that_differ_only_in_numbers(self):
        text = self.read()
        self.assertIn("ended blocked @ build: 2 | 2 | 2 |", text)
        self.assertIn("problem @ resolve: 1 | 0 | 0 |", text)
        self.assertIn("  2 x wt new rerun N refused at <sha>", text)
        self.assertNotIn("dead #N: waits on #N", text)

    def test_end_states_runs_errors_and_escapes_are_listed(self):
        text = self.read()
        self.assertIn("blocked | 1 | 1 | 1 | 1", text)
        self.assertIn("build | 1 | 0 | 1 |", text)
        self.assertIn("  1 x build: interrupted: engine restarted", text)
        self.assertIn("5|reopened", text)

    def test_the_store_is_opened_read_only(self):
        db = sqlite3.connect("file:%s?mode=ro" % self.path, uri=True)
        self.addCleanup(db.close)
        with self.assertRaises(sqlite3.OperationalError):
            db.execute("DELETE FROM failures")


if __name__ == "__main__":
    unittest.main()
