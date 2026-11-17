import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import learn
import store as S


class TestLearn(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.s = S.Store(os.path.join(self.d.name, "ledger.db"))

    def tearDown(self):
        self.s.close()
        self.d.cleanup()

    def fire(self, job, stage, run, status, tin, tout, cr=None, cw=None, error=None, coworker="B1"):
        fid = self.s.intent(job, "", stage, coworker)
        self.s.fired(fid, run)
        self.s.close_run(run, status, tokens_in=tin, tokens_out=tout, cache_read=cr, cache_write=cw, error=error)

    def test_the_record_of_a_job_with_one_fix_round(self):
        data = {"issue": 5, "pr": 42, "round": 1, "review": "R" * 2000}
        for st in ("queued", "building", "building", "review_wait", "reviewing", "fix_wait", "fixing",
                   "review_wait", "reviewing", "checks", "merged"):
            self.s.put_job("5", st, data, reason="x" * 250 if st == "fix_wait" else None)
        self.fire("5", "build", "a1", "done", 1000, 100, 500, 50)
        self.fire("5", "review", "a2", "done", 400, 40, coworker="R1")
        self.fire("5", "fix", "a3", "done", 300, 30)
        self.fire("5", "review", "a4", "error", 200, 20, error="boom", coworker="R1")
        self.fire("6", "build", "a5", "done", 999, 99)
        self.fire("5", "learn", "a6", "done", 5, 5)
        rec = learn.record(self.s, "5")
        self.assertEqual(rec["state"], "merged")
        self.assertEqual(rec["pr"], 42)
        self.assertEqual(len(rec["review"]), 1500)
        self.assertEqual(len(rec["transitions"]), 10)
        self.assertEqual(rec["transitions_total"], 10)
        self.assertEqual(rec["rounds"], 1)
        self.assertEqual([len(t["reason"] or "") for t in rec["transitions"] if t["to"] == "fix_wait"], [200])
        self.assertEqual(len(rec["fires"]), 4)
        self.assertEqual(rec["fires_total"], 4)
        self.assertEqual(rec["not_done"], 1)
        self.assertEqual(rec["tokens"], {"in": 1900, "out": 190, "cache_read": 500, "cache_write": 50})
        self.assertEqual(set(rec), {"job", "state", "pr", "review", "transitions", "transitions_total", "rounds",
                                    "fires", "fires_total", "not_done", "tokens", "briefs"})

    def test_the_record_keeps_the_last_40_state_changes(self):
        self.s.put_job("7", "building", {})
        for i in range(44):
            self.s.put_job("7", "review_wait" if i % 2 == 0 else "building", {})
        rec = learn.record(self.s, "7")
        self.assertEqual(rec["transitions_total"], 45)
        self.assertEqual(len(rec["transitions"]), 40)
        self.assertEqual(rec["transitions"][0]["to"], "review_wait")

    def test_the_brief_carries_the_record_and_the_answer_format(self):
        self.s.put_job("5", "merged", {"pr": 42})
        rec = learn.record(self.s, "5")
        text = learn.brief(rec, "o/r", 5)
        self.assertTrue(text.startswith("JOB r#5 LEARN"))
        for s in ("https://github.com/o/r/issues/5", "at most 3", "brain page", "PROPOSALS: ", "NO PROPOSALS: "):
            self.assertIn(s, text)
        block = text.split("```json\n", 1)[1].split("\n```", 1)[0]
        self.assertEqual(json.loads(block), rec)


if __name__ == "__main__":
    unittest.main()
