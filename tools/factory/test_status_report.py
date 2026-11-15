import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import status_report as S

KEY = "sk-dev-SECRET-KEY-0123456789"


class FakeEngine:
    def __init__(self, runs):
        self.runs, self._key = runs, KEY

    def get_run(self, agent, rid):
        return self.runs.get(rid)

    def list_runs(self, agent, status=None, limit=50):
        return [dict(r, id=i) for i, r in self.runs.items()]


def fire(run_id, status, intent="2026-11-12T10:00:00Z", ended="2026-11-12T10:01:10Z", stage="challenge", refire=0, job="j1"):
    return {"job": job, "chunk": "", "stage": stage, "coworker": "a1", "run_id": run_id, "status": status,
            "intent_at": intent, "ended_at": ended, "refire": refire}


def by(rows):
    return {r[0]: r for r in rows}


class TestReport(unittest.TestCase):
    def test_all_pass(self):
        fires = [fire("r-err", "error", ended="2026-11-12T10:00:30Z"), fire("r-ok", "done", refire=1),
                 fire("r-can", "cancelled", job="j2", stage="hold", ended="2026-11-12T10:30:00Z")]
        eng = FakeEngine({"r-err": {"status": "error"}, "r-ok": {"status": "done", "finishedAt": "2026-11-12T10:01:00Z"},
                          "r-can": {"status": "cancelled", "finishedAt": "2026-11-12T10:30:00Z"}})
        restart = S.ts("2026-11-12T10:00:45Z")
        r = by(S.report(fires, eng, ["a1"], restart))
        for k in ("R1", "R2", "R3", "R4", "R6"):
            self.assertEqual(r[k][1], "PASS", r[k])
        self.assertIn("seconds run-row-end-to-ledger=10", r["R1"][2])
        self.assertIn("refire count=1", r["R3"][2])
        self.assertIn("for a stage with no tools", r["R6"][2])

    def test_failures(self):
        fires = [fire("r1", "done", ended="2026-11-12T10:05:00Z"), fire("r2", "done"), fire("r3", "done")]
        eng = FakeEngine({"r1": {"status": "done", "finishedAt": "2026-11-12T10:01:00Z"}, "r2": {"status": "done"},
                          "r3": {"status": "done"}, "stray": {"status": "done"}})
        r = by(S.report(fires, eng, ["a1"], None))
        self.assertEqual([r[k][1] for k in ("R1", "R2", "R3", "R4", "R6")], ["FAIL"] * 5)
        self.assertIn("stray", r["R6"][2])

    def test_two_refires_fail_r3(self):
        fires = [fire("a", "error"), fire("b", "error", refire=1), fire("c", "done", refire=2)]
        eng = FakeEngine({"a": {"status": "error"}, "b": {"status": "error"}, "c": {"status": "done"}})
        self.assertEqual(by(S.report(fires, eng, ["a1"]))["R3"][1], "FAIL")

    def test_key_never_in_output(self):
        fires = [fire("r-ok", "done")]
        eng = FakeEngine({"r-ok": {"status": "done", "finishedAt": "2026-11-12T10:01:00Z"}})
        out = S.render(S.report(fires, eng, ["a1"], S.ts("2026-11-12T10:00:30Z")))
        self.assertNotIn(KEY, out)
        self.assertNotIn("SECRET", out)
        self.assertIn("R5: checked separately by the owner", out)

    def test_read_fires_uses_the_store_ledger(self):
        import tempfile, store
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "ledger.db")
            s = store.Store(p)
            fid = s.intent("j", "", "challenge", "a1")
            s.fired(fid, "r9")
            rows = S.read_fires(p)
            s.close()
        self.assertEqual((rows[0]["run_id"], rows[0]["status"]), ("r9", "running"))


class Report(unittest.TestCase):
    def test_three_review_fires_prints_3(self):
        F = lambda c, st, a, b, i=0: {"job": "j", "chunk": c, "stage": st, "coworker": "w" + c, "intent_at": "2026-01-01T00:00:%02dZ" % a,
                                      "ended_at": "2026-01-01T00:00:%02dZ" % b, "tokens_in": i, "tokens_out": 1}
        fires = [F("A", "build", 0, 9)] + [F(c, "review", 10 + n, 12 + n, 4) for n, c in enumerate("ABC")]
        out = "\n".join(S.measure_lines(fires, [], [], "2026-01-01T00:01:00Z"))
        self.assertIn("review job j: runs=3 tokens=15 coworkers=3 peak_chunks=1", out)
        self.assertIn("tokens per merged change: fresh_input=n/a", out)
        self.assertIn("queue depth=0", out)


class TestSharedStorePath(unittest.TestCase):
    def test_status_and_runner_read_the_same_store_path(self):
        import runner_loop as R, trigger as T
        cfg = T.load_config()
        self.assertEqual(cfg["store_file"], R.store_path(cfg))
        import inspect
        self.assertIn("R.store_path(cfg)", inspect.getsource(S.main))
        self.assertNotIn("ledger.db", inspect.getsource(S.main))


class StartTime(unittest.TestCase):
    @unittest.skipUnless(os.path.exists("/proc/1/stat") and hasattr(os, "sysconf"), "needs Linux /proc")
    def test_runner_start_time_is_readable_and_in_the_past(self):
        import time
        started = S.runner_started_at()
        self.assertIsInstance(started, int)
        self.assertLessEqual(started, int(time.time()) + 1)
        self.assertGreater(started, 1_600_000_000)

if __name__ == "__main__":
    unittest.main()
