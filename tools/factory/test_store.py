import json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store as S


class TestStore(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.p = os.path.join(self.d.name, "ledger.db")
        self.s = S.Store(self.p)

    def tearDown(self):
        self.s.close()
        self.d.cleanup()

    def test_wal(self):
        self.assertEqual(self.s.db.execute("PRAGMA journal_mode").fetchone()[0], "wal")

    def test_crash_between_intent_and_fire(self):
        fid = self.s.intent("60", "5", "build", "larry", "factory-build")
        self.s.close()
        self.s = S.Store(self.p)
        pend = self.s.pending("60")
        self.assertEqual([p["id"] for p in pend], [fid])
        self.assertIsNone(pend[0]["run_id"])
        self.assertEqual(self.s.resume("60")["last"]["status"], "intent")
        self.s.abandon(fid)
        self.assertEqual(self.s.pending("60"), [])

    def test_fire_and_close(self):
        fid = self.s.intent("60", "5", "build")
        self.s.fired(fid, "r1")
        self.assertEqual(self.s.running("60")[0]["run_id"], "r1")
        self.s.close_run("r1", "done", tokens_in=10, tokens_out=2)
        r = self.s.resume("60")
        self.assertEqual((r["running"], r["pending"]), ([], []))
        self.assertEqual((r["last"]["status"], r["last"]["tokens_in"]), ("done", 10))

    def test_refire_count(self):
        self.assertEqual(self.s.refires("60", "5", "build"), 0)
        self.s.fired(self.s.intent("60", "5", "build"), "r1")
        self.assertEqual(self.s.refires("60", "5", "build"), 0)
        self.s.close_run("r1", "error", error="engine restarted")
        f2 = self.s.intent("60", "5", "build")
        self.assertEqual(self.s.refires("60", "5", "build"), 1)
        self.assertEqual(self.s.pending("60")[0]["refire"], 1)
        self.assertEqual(self.s.refires("60", "6", "build"), 0)
        self.assertNotEqual(f2, 0)

    def test_resume_kv(self):
        self.s.set("60", "stage", "BUILD")
        self.s.set("60", "stage", "TEST")
        self.s.close()
        self.s = S.Store(self.p)
        self.assertEqual(self.s.resume("60")["state"], {"stage": "TEST"})
        self.assertIsNone(self.s.resume("61")["last"])

    def test_r6_foreign_runs(self):
        self.s.fired(self.s.intent("60", "5", "build"), "r1")
        self.assertEqual(self.s.foreign(["r1"]), [])
        self.assertEqual(self.s.foreign(["r1", "x9", "x8"]), ["x9", "x8"])
        self.assertEqual(self.s.foreign([]), [])

    def test_fires_may_share_a_run_id(self):
        a, b = self.s.intent("60", "A", "build"), self.s.intent("60", "B", "build")
        self.s.fired(a, "r1")
        self.s.fired(b, "r1")
        self.s.close_run("r1", "done")
        self.assertEqual([r[0] for r in self.s.db.execute("SELECT status FROM fires")], ["done", "done"])

    def test_single_writer(self):
        with self.assertRaises(RuntimeError):
            S.Store(self.p)
        code = "import sys;sys.path.insert(0,%r);import store;store.Store(%r)" % (os.path.dirname(os.path.abspath(__file__)), self.p)
        r = subprocess.run([sys.executable, "-c", code], capture_output=True)
        self.assertNotEqual(r.returncode, 0)

    def test_put_job_writes_its_transition_in_one_transaction(self):
        self.s.put_job("171", "queued", {"issue": 171, "pr": 5, "head": "abc", "round": 0})
        self.s.put_job("171", "building", {"issue": 171, "pr": 5, "head": "abc", "round": 1}, reason="fired", run_id="r1")
        tr = self.s.transitions_of("171")
        self.assertEqual([(t["from_state"], t["to_state"]) for t in tr], [(None, "queued"), ("queued", "building")])
        self.assertTrue(all(t["at"].endswith("Z") for t in tr))
        j = self.s.get_job("171")
        self.assertTrue(j["updated_at"].endswith("Z"))
        self.assertEqual((j["state"], j["pr"], j["head"], j["round"]), ("building", 5, "abc", 1))
        self.assertEqual(tr[1]["run_id"], "r1")
        before = (self.s.jobs(), self.s.transitions_of("171"))
        with self.assertRaises(ValueError):
            self.s.put_job("171", "nonsense", {})
        self.assertEqual((self.s.jobs(), self.s.transitions_of("171")), before)
        self.s.put_job("171", "building", {"issue": 171}, reason="resend")
        self.assertEqual(len(self.s.transitions_of("171")), 3)
        self.assertEqual(self.s.transitions_of("171")[2]["from_state"], "building")

    def test_retries_and_reset(self):
        self.s.put_job("9", "queued", {})
        self.assertEqual(self.s.retries("9", "ci"), 0)
        self.assertEqual(self.s.bump_retry("9", "ci"), 1)
        self.assertEqual(self.s.bump_retry("9", "ci"), 2)
        self.assertEqual(self.s.retries("9", "ci"), 2)
        self.s.put_job("9", "building", {}, reset_retries=True)
        self.assertEqual(self.s.retries("9", "ci"), 0)

    def test_steps_seen(self):
        fid = self.s.intent("1", "", "build")
        a = self.s.steps_seen(fid, 3, at="2026-01-01T00:00:00Z")
        self.assertEqual(a, "2026-01-01T00:00:00Z")
        self.assertEqual(self.s.steps_seen(fid, 3, at="2026-01-01T00:05:00Z"), "2026-01-01T00:00:00Z")
        self.assertEqual(self.s.steps_seen(fid, 4, at="2026-01-01T00:06:00Z"), "2026-01-01T00:06:00Z")

    def test_import_json_runs_once(self):
        f = os.path.join(self.d.name, "state.json")
        doc = {"jobs": {"171": {"issue": 171, "state": "review_wait", "pr": 181, "round": 1},
                        "9": {"issue": 9, "state": "building", "pr": 3, "round": 0}}}
        with open(f, "w") as fh:
            json.dump(doc, fh)
        self.assertEqual(self.s.import_json(f), 2)
        self.assertFalse(os.path.exists(f))
        self.assertTrue(os.path.exists(f + ".imported"))
        self.assertEqual([j["issue"] for j in self.s.jobs()], [9, 171])
        self.assertEqual(self.s.transitions_of("171")[0]["reason"], "imported")
        snap = (self.s.jobs(), self.s.transitions_of("171"))
        doc["jobs"]["171"]["state"] = "merged"
        with open(f, "w") as fh:
            json.dump(doc, fh)
        self.assertEqual(self.s.import_json(f), 0)
        self.assertEqual((self.s.jobs(), self.s.transitions_of("171")), snap)

    def test_import_json_missing_file_sets_marker(self):
        self.assertEqual(self.s.import_json(os.path.join(self.d.name, "none.json")), 0)
        self.assertIsNotNone(self.s.db.execute("SELECT v FROM kv WHERE job='-' AND k='imported_json'").fetchone())

    def test_old_ledger_gains_typed_columns(self):
        self.s.db.execute("ALTER TABLE fires DROP COLUMN steps_at")
        self.s.close()
        self.s = S.Store(self.p)
        cols = {r[1]: r[2] for r in self.s.db.execute("PRAGMA table_info(fires)")}
        self.assertEqual(cols["steps_at"], "TEXT")
        self.assertEqual(cols["steps"], "INTEGER")


if __name__ == "__main__":
    unittest.main()
