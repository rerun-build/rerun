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

    def test_set_many_orders_state_last_and_rolls_back_mid_write(self):
        seen = []
        real = self.s.set

        def spy(job, k, v):
            seen.append(k)
            return real(job, k, v)

        self.s.set = spy
        self.s.set_many("accept:10", [("state", "running"), ("agent", "a1"), ("fire", 1)])
        self.s.set = real
        self.assertEqual(seen, ["agent", "fire", "state"])
        self.assertEqual(self.s.get_all("accept:10"), {"agent": "a1", "fire": "1", "state": "running"})
        self.assertEqual(self.s.moved("accept:10")["state"], "running")

        self.s.db.execute(
            "CREATE TEMP TRIGGER kill_second AFTER INSERT ON kv "
            "WHEN (SELECT COUNT(*) FROM kv WHERE job=NEW.job) >= 2 "
            "BEGIN SELECT RAISE(ABORT, 'killed mid-write'); END")
        with self.assertRaises(Exception):
            for k, v in (("state", "running"), ("agent", "a1")):
                self.s.set("torn:1", k, v)
        self.assertEqual(self.s.get_all("torn:1"), {"state": "running"})

        with self.assertRaises(Exception):
            self.s.set_many("clean:1", [("state", "running"), ("agent", "a1"), ("fire", 2)])
        self.assertEqual(self.s.get_all("clean:1"), {})
        self.assertIsNone(self.s.moved("clean:1"))
        self.assertFalse(self.s.db.in_transaction)

    def test_intent_set_and_forget_are_atomic_and_nest_inside_dequeue_to_intent(self):
        self.s.set("p:1", "state", "planned")
        self.s.db.execute(
            "CREATE TEMP TRIGGER kill_moves AFTER INSERT ON moves "
            "WHEN NEW.job='p:2' BEGIN SELECT RAISE(ABORT, 'killed before moves'); END")
        with self.assertRaises(Exception):
            self.s.set("p:2", "state", "planned")
        self.assertEqual(self.s.get_all("p:2"), {})
        self.assertIsNone(self.s.moved("p:2"))

        self.s.db.execute(
            "CREATE TEMP TRIGGER kill_forget AFTER DELETE ON moves "
            "WHEN OLD.job='p:1' BEGIN SELECT RAISE(ABORT, 'killed mid-forget'); END")
        with self.assertRaises(Exception):
            self.s.forget("p:1")
        self.assertEqual(self.s.get_all("p:1"), {"state": "planned"})
        self.assertIsNotNone(self.s.moved("p:1"))

        self.s.db.execute(
            "CREATE TEMP TRIGGER kill_intent AFTER UPDATE ON ready_chunks "
            "WHEN NEW.job='60' BEGIN SELECT RAISE(ABORT, 'killed mid-intent'); END")
        with self.assertRaises(Exception):
            self.s.intent("60", "c1", "build")
        self.assertEqual(self.s.pending("60"), [])
        self.assertIsNone(self.s.get_ready("60", "c1"))

        self.s.db.execute("DROP TRIGGER kill_intent")
        qid = self.s.enqueue("60", "build", "c1")
        fid = self.s.dequeue_to_intent(qid, "60", "c1", "build", lease_paths=["a.py"], lease_expires="2099-01-01T00:00:00Z")
        self.assertEqual([p["id"] for p in self.s.pending("60")], [fid])
        self.assertEqual(self.s.queued(), [])

    def test_fire_batch_rolls_back_all_chunks_and_fires_atomically_on_crash(self):
        import runner_loop as R
        from test_batch_run import Eng, T0
        cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "t.json"),
               "store_file": os.path.join(self.d.name, "batch.db"),
               "triggers": [{"stage": "build", "coworker": "CODE", "agent": "ag1", "slug": "factory-build"}]}
        eng = Eng()
        eng.now = T0
        r = R.build(cfg, eng, clock=lambda: T0)
        self.addCleanup(r.st.close)
        for c in "AB":
            r.st.add_ready("j", c, paths=[c + ".py"])
        r.st.db.execute(
            "CREATE TEMP TRIGGER kill_second_lease AFTER INSERT ON leases "
            "WHEN NEW.chunk='B' BEGIN SELECT RAISE(ABORT, 'killed mid-pre-fire'); END")
        with self.assertRaises(Exception):
            r.fire_batch(r.st.ready_list())
        self.assertEqual(r.st.pending("j"), [])
        self.assertEqual(r.st.open_leases(), [])
        self.assertEqual(sorted(c["chunk"] for c in r.st.ready_list("j")), ["A", "B"])

        r.st.db.execute("DROP TRIGGER kill_second_lease")
        r.st.db.execute(
            "CREATE TEMP TRIGGER kill_second_fired AFTER UPDATE OF status ON fires "
            "WHEN NEW.chunk='B' AND NEW.status='running' BEGIN SELECT RAISE(ABORT, 'killed mid-post-fire'); END")
        with self.assertRaises(Exception):
            r.fire_batch(r.st.ready_list())
        statuses = [row[0] for row in r.st.db.execute("SELECT status FROM fires ORDER BY chunk").fetchall()]
        self.assertEqual(statuses, ["intent", "intent"])


if __name__ == "__main__":
    unittest.main()
