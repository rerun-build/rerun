import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_loop as R, limits as L

T0 = 1_800_000_000.0


class FakeEngine:
    def __init__(self):
        self.runs, self.fires, self.cancelled, self.n = {}, [], [], 0

    def list_triggers(self, agent):
        return [{"slug": "factory-challenge", "token": "tok-secret"}]

    def create_trigger(self, *a, **k):
        raise AssertionError("trigger exists")

    def fire_trigger(self, agent, slug, token, payload):
        self.n += 1
        rid = "run%d" % self.n
        self.fires.append((slug, payload))
        self.runs[rid] = {"id": rid, "status": "running", "startedAt": R.iso(self.now), "triggerSlug": slug}
        return rid, "s"

    def get_run(self, agent, rid):
        return self.runs.get(rid)

    def run_steps(self, agent, rid):
        return []

    def list_runs(self, agent, **k):
        return list(self.runs.values())

    def cancel(self, agent, rid):
        self.cancelled.append(rid)
        self.runs[rid]["status"] = "cancelled"
        return True


class TestRunner(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "tok.json"),
                    "store_file": os.path.join(self.d.name, "ledger.db"),
                    "triggers": [{"stage": "challenge", "coworker": "DA", "agent": "ag1", "slug": "factory-challenge"}]}
        self.eng = FakeEngine()
        self.now = T0
        self.eng.now = T0
        self.runner = self.make()

    def make(self):
        return self.make_with(self.cfg)

    def make_with(self, cfg):
        self.eng.now = self.now
        return R.build(cfg, self.eng, clock=lambda: self.now)

    def tearDown(self):
        self.runner.st.close()
        self.d.cleanup()

    def tick(self, dt=30):
        self.now += dt
        self.eng.now = self.now
        self.runner.tick()

    def fires(self):
        return self.runner.st.db.execute("SELECT * FROM fires ORDER BY id").fetchall()

    def test_done_recorded_within_one_tick(self):
        self.runner.st.enqueue("60", "challenge", "C7")
        self.tick()
        self.assertEqual(len(self.eng.fires), 1)
        self.assertEqual(self.eng.fires[0][1]["job"], "60")
        self.assertEqual(self.fires()[0]["status"], "running")
        self.eng.runs["run1"].update(status="done", inputTokens=5, outputTokens=2)
        self.tick()
        f = self.fires()[0]
        self.assertEqual((f["status"], f["tokens_in"], f["tokens_out"]), ("done", 5, 2))
        self.assertIsNotNone(f["ended_at"])

    def test_long_run_cancelled(self):
        self.runner.st.enqueue("60", "challenge")
        self.tick()
        self.tick(700)
        self.assertEqual(self.eng.cancelled, ["run1"])
        self.assertEqual(self.fires()[0]["status"], "cancelled")
        self.tick()
        self.assertEqual(len(self.eng.fires), 1)

    def test_error_refired_exactly_once(self):
        self.runner.st.enqueue("60", "challenge")
        self.tick()
        self.eng.runs["run1"].update(status="error", error="boom")
        self.tick()
        self.assertEqual(len(self.eng.fires), 2)
        self.eng.runs["run2"].update(status="error", error="boom")
        self.tick()
        self.tick()
        self.assertEqual(len(self.eng.fires), 2)
        self.assertEqual([f["status"] for f in self.fires()], ["error", "failed"])

    def test_engine_restart_row_refired_once(self):
        self.runner.st.enqueue("60", "challenge")
        self.tick()
        self.eng.runs["run1"].update(status="error", error=L.RESTARTED)
        self.tick()
        self.assertEqual(len(self.eng.fires), 2)

    def test_runner_restart_continues_without_double_fire(self):
        self.runner.st.enqueue("60", "challenge")
        self.tick()
        self.runner.st.close()
        self.runner = self.make()
        self.tick()
        self.assertEqual(len(self.eng.fires), 1)
        self.eng.runs["run1"].update(status="done")
        self.runner.st.close()
        self.runner = self.make()
        self.tick()
        self.assertEqual(len(self.eng.fires), 1)
        self.assertEqual(self.fires()[0]["status"], "done")

    def test_crash_between_intent_and_fire_resolved_not_refired(self):
        self.runner.st.enqueue("60", "challenge")
        orig = self.eng.fire_trigger

        def lost(*a):
            orig(*a)
            raise R.E.EngineError("timeout")
        self.eng.fire_trigger = lost
        self.tick()
        self.assertEqual(self.fires()[0]["status"], "intent")
        self.runner.st.close()
        self.eng.fire_trigger = orig
        self.runner = self.make()
        self.tick()
        self.assertEqual(len(self.eng.fires), 1)
        self.assertEqual(self.fires()[0]["run_id"], "run1")

    def test_enqueue_writes_inbox_file_only_and_loop_ingests_it(self):
        inbox = R.inbox_path(self.cfg)
        self.assertEqual(os.path.dirname(inbox), self.d.name)
        R.enqueue(inbox, "61", "challenge", "C1")
        self.assertEqual(len(os.listdir(inbox)), 1)
        self.assertEqual(self.runner.st.queued(), [])
        self.tick()
        self.assertEqual(os.listdir(inbox), [])
        self.assertEqual(len(self.eng.fires), 1)
        self.assertEqual(self.eng.fires[0][1], {"job": "61", "stage": "challenge", "chunk": "C1"})
        self.assertEqual(self.fires()[0]["chunk"], "C1")
        self.assertEqual(self.runner.st.queued(), [])

    def test_bad_inbox_file_is_set_aside(self):
        inbox = R.inbox_path(self.cfg)
        os.makedirs(inbox)
        with open(os.path.join(inbox, "0001-x.json"), "w") as f:
            f.write("{not json")
        R.enqueue(inbox, "61", "challenge")
        self.tick()
        self.assertEqual(len(self.eng.fires), 1)
        self.assertEqual(os.listdir(inbox), ["0001-x.json.bad"])

    def test_not_before_holds_a_queue_row_back(self):
        self.runner.st.enqueue("61", "challenge", not_before=R.iso(T0 + 100))
        self.tick()
        self.assertEqual(len(self.eng.fires), 0)
        self.tick(100)
        self.assertEqual(len(self.eng.fires), 1)

    def test_no_step_stall_counts_from_run_start_not_now(self):
        self.runner.cfg.update(stall_s=100, run_limit_s=5000)
        self.runner.st.enqueue("60", "challenge")
        self.tick(0)
        self.assertEqual(len(self.eng.fires), 1)
        self.tick(90)
        self.assertEqual(self.eng.cancelled, [])
        self.tick(30)
        self.assertEqual(self.eng.cancelled, ["run1"])
        self.assertIn("stalled", self.fires()[0]["error"])

    def test_r2_challenge_hold_is_cancelled_before_the_stub_would_finish(self):
        import trigger as T
        STUB_HOLD = 1800
        shipped = {e["stage"]: e for e in T.load_config()["triggers"]}["challenge-hold"]
        self.assertLess(shipped["run_limit_s"] * 5, STUB_HOLD)
        cfg = dict(self.cfg, run_limit_s=2700, stall_s=600)
        cfg["triggers"] = [dict(cfg["triggers"][0], stage="challenge-hold", slug="factory-challenge", run_limit_s=shipped["run_limit_s"])]
        self.runner.st.close()
        self.runner = self.make_with(cfg)
        self.runner.st.enqueue("r2", "challenge-hold")
        self.tick(0)
        elapsed = 0
        while not self.eng.cancelled and elapsed < STUB_HOLD:
            self.tick(30)
            elapsed += 30
        self.assertEqual(self.eng.cancelled, ["run1"])
        self.assertLess(elapsed, STUB_HOLD)
        self.assertLessEqual(elapsed, shipped["run_limit_s"] + 30)
        f = self.fires()[0]
        self.assertEqual(f["status"], "cancelled")
        self.assertIn("limit %d s" % shipped["run_limit_s"], f["error"])


class SetupEngine:
    def __init__(self):
        self.conns, self.agents, self.default, self.posts, self.triggers = [], [], None, [], {}
    def _call(self, method, path, query=None, payload=None):
        if method == "POST":
            self.posts.append(path)
        if (method, path) == ("GET", "/connections"):
            return {"connections": list(self.conns), "default": self.default}
        if (method, path) == ("POST", "/connections"):
            c = dict(payload, id="conn%d" % (len(self.conns) + 1))
            self.conns.append(c)
            return c
        if (method, path) == ("PUT", "/connections/default"):
            self.default = dict(payload)
            return self.default
        if (method, path) == ("GET", "/agents"):
            return {"agents": [{"id": a["id"], "name": a["config"]["name"]} for a in self.agents]}
        if (method, path) == ("POST", "/agents"):
            a = {"id": "ag-%s" % payload["config"]["name"], "config": payload["config"]}
            self.agents.append(a)
            return a
        raise AssertionError((method, path))
    def list_triggers(self, agent):
        return [t for (a, _), t in self.triggers.items() if a == agent]
    def create_trigger(self, agent, name, body, model=None, **k):
        self.posts.append("trigger")
        t = {"slug": name, "token": "tok-" + name, "model": model}
        self.triggers[(agent, name)] = t
        return t


class TestSetup(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        os.environ.pop("FACTORY_DATA_DIR", None)
        self.cfg = {"store_file": os.path.join(self.d.name, "ledger.db"),
                    "token_file": os.path.join(self.d.name, "tok.json"),
                    "triggers": [
                        {"stage": "challenge", "coworker": "DA", "agent_name": "challenge", "slug": "factory-challenge", "model": "stub-fast"},
                        {"stage": "challenge", "coworker": "DA", "agent_name": "challenge-hold", "slug": "factory-challenge-hold", "model": "stub-hold"}]}
    def tearDown(self):
        self.d.cleanup()
    def test_creates_then_second_run_creates_nothing(self):
        eng = SetupEngine()
        R.setup(eng, self.cfg)
        self.assertEqual(sorted(eng.posts), ["/agents", "/agents", "/connections", "trigger", "trigger"])
        self.assertEqual(eng.default, {"connectionId": "conn1", "model": "stub-fast"})
        self.assertEqual({a["config"]["name"]: a["config"]["model"] for a in eng.agents}, {"challenge": "stub-fast", "challenge-hold": "stub-hold"})
        state = R.read_state(self.cfg)
        self.assertEqual(state["agents"], {"challenge": "ag-challenge", "challenge-hold": "ag-challenge-hold"})
        self.assertTrue(state_path_in_volume(self.cfg, self.d.name))
        eng.posts.clear()
        out = R.setup(eng, self.cfg)
        self.assertEqual(eng.posts, [])
        self.assertTrue(all("created" not in l for l in out), out)
        self.assertEqual(R.read_state(self.cfg), state)
    def test_reuses_by_name_when_state_file_is_lost(self):
        eng = SetupEngine()
        R.setup(eng, self.cfg)
        os.unlink(R.state_path(self.cfg))
        eng.posts.clear()
        R.setup(eng, self.cfg)
        self.assertEqual(eng.posts, [])
        self.assertEqual(len(eng.agents), 2)
    def test_run_reads_ids_from_state_and_waits_without_it(self):
        with self.assertRaises(R.NeedsSetup):
            R.load_runtime(self.cfg)
        R.setup(SetupEngine(), self.cfg)
        rt = R.load_runtime(self.cfg)
        self.assertEqual([e["agent"] for e in rt["triggers"]], ["ag-challenge", "ag-challenge-hold"])
        self.assertNotIn("agent", self.cfg["triggers"][0])
    def test_store_path_default_is_the_data_dir_and_state_sits_beside_it(self):
        os.environ["FACTORY_DATA_DIR"] = "/vol"
        try:
            self.assertEqual(R.store_path({}), "/vol/ledger.db")
            self.assertEqual(R.state_path({}), "/vol/runner-state.json")
        finally:
            os.environ.pop("FACTORY_DATA_DIR")
    def test_shipped_runner_json_is_a_template_without_ids(self):
        import trigger as T
        for e in T.load_config()["triggers"]:
            self.assertNotIn("agent", e)
            self.assertTrue(e["agent_name"] and e["model"].startswith("stub-"))


def state_path_in_volume(cfg, d):
    return os.path.dirname(R.state_path(cfg)) == d == os.path.dirname(R.store_path(cfg))


if __name__ == "__main__":
    unittest.main()
