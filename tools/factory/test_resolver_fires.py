import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_resolver import Resolving
from test_dispatch import D


class ResolverFires(Resolving):
    def fires(self):
        return self.w.rows("SELECT job, chunk, stage, coworker, run_id, status, tokens_in, tokens_out, cache_read FROM fires WHERE stage='resolve'")

    def past_the_limit(self, wrap=None, tokens=False):
        self.cfg["clocks"] = {"run_limit_s": 100}
        if wrap:
            orig = self.w.account
            self.w.account = lambda tool, args, **kw: wrap(orig, tool, args, **kw)
        self.tick(2)
        if tokens:
            self.w.runs["run1"].update(inputTokens=700, outputTokens=80, cachedInputTokens=500)
        self.w.clock += 101
        self.tick()
        return self.w.rows("SELECT status, run_id, tokens_in, tokens_out, cache_read, error FROM fires WHERE stage='resolve' ORDER BY id")

    def test_send_without_run_id_closes_lost_at_the_run_limit(self):
        def no_run_id(orig, tool, args, **kw):
            out = orig(tool, args, **kw)
            return {} if tool == "send_message" and args["agentId"] == "h1" else out
        rows = self.past_the_limit(wrap=no_run_id)
        self.assertEqual(rows[0][:2], ("lost", None))
        self.assertIn("no run id", rows[0][5])

    def test_run_cancelled_past_the_limit_closes_cancelled_with_its_tokens(self):
        rows = self.past_the_limit(tokens=True)
        self.assertEqual(rows[0][:5], ("cancelled", "run1", 700, 80, 500))

    def test_cancelled_run_keeps_the_last_tokens_when_get_run_fails_after_the_cancel(self):
        def get_run_fails_after_cancel(orig, tool, args, **kw):
            if tool == "get_run" and self.w.cancels:
                raise D.Error("account get_run failed: HTTP 500")
            return orig(tool, args, **kw)
        rows = self.past_the_limit(wrap=get_run_fails_after_cancel, tokens=True)
        self.assertEqual(rows[0][:5], ("cancelled", "run1", 700, 80, 500))

    def test_run_whose_get_run_keeps_failing_closes_lost(self):
        def get_run_fails(orig, tool, args, **kw):
            if tool == "get_run" and args["agentId"] == "h1":
                raise D.Error("account get_run failed: HTTP 404")
            return orig(tool, args, **kw)
        rows = self.past_the_limit(wrap=get_run_fails)
        self.assertEqual(rows[0][0], "lost")
        self.assertIn("get_run failed past the run limit", rows[0][5])

    def test_resolve_send_writes_a_running_fire(self):
        self.tick(2)
        number = str(self.w.problems[0]["number"])
        self.assertEqual(self.fires(), [(number, "", "resolve", "HOUSE", "run1", "running", 0, 0, None)])

    def test_done_resolve_run_closes_with_tokens(self):
        self.tick(2)
        self.w.finish("h1", "RESOLVED: fixed")
        self.w.runs["run1"].update(inputTokens=1200, outputTokens=340, cachedInputTokens=900)
        self.tick()
        row = self.fires()[0]
        self.assertEqual(row[5:], ("done", 1200, 340, 900))

    def test_error_resolve_run_closes_as_error(self):
        self.tick(2)
        self.w.finish("h1", "", status="error")
        self.w.runs["run1"].update(inputTokens=5, outputTokens=6)
        self.tick()
        self.assertEqual(self.fires()[0][5:], ("error", 5, 6, None))

    def test_raised_send_abandons_the_fire(self):
        self.w.cut_off_next_send = True
        self.tick(2)
        rows = self.w.rows("SELECT status, run_id, error FROM fires WHERE stage='resolve'")
        self.assertEqual(rows[0][:2], ("lost", None))
        self.assertIn("TimeoutError", rows[0][2])


if __name__ == "__main__":
    unittest.main()
