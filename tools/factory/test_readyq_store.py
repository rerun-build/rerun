import os, sqlite3, tempfile, unittest
import store


class ReadyStore(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.p = os.path.join(self.d, "s.db")

    def test_survives_reopen_and_old_db(self):
        db = sqlite3.connect(self.p)
        db.execute("CREATE TABLE fires(id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, chunk TEXT NOT NULL DEFAULT '', "
                   "stage TEXT NOT NULL, coworker TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL DEFAULT '', intent_at TEXT NOT NULL, "
                   "run_id TEXT, status TEXT NOT NULL DEFAULT 'intent', ended_at TEXT, tokens_in INTEGER NOT NULL DEFAULT 0, "
                   "tokens_out INTEGER NOT NULL DEFAULT 0, error TEXT, refire INTEGER NOT NULL DEFAULT 0)")
        db.execute("INSERT INTO fires(job,stage,intent_at) VALUES('j','build','2026-01-01T00:00:00Z')")
        db.commit(); db.close()
        s = store.Store(self.p)
        self.assertEqual(s.fire_count("j"), 1)
        s.add_ready("j", "A", paths=["a.py", "test_a.py"], builder="code", deps=[])
        s.add_ready("j", "B", paths=["b.py"], builder="code", deps=["A"])
        self.assertEqual([r["chunk"] for r in s.ready_list("j")], ["A", "B"])
        self.assertEqual(s.bump_attempt("j", "A"), 1)
        s.set_ready_state("j", "A", "leased")
        s.close()
        s = store.Store(self.p)
        self.assertEqual([r["chunk"] for r in s.ready_list("j")], ["B"])
        a = s.get_ready("j", "A")
        self.assertEqual((a["state"], a["attempts"], a["paths"], a["deps"]), ("leased", 1, ["a.py", "test_a.py"], []))
        self.assertEqual(s.attempts("j", "B"), 0)
        s.close()


if __name__ == "__main__":
    unittest.main()
