import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_resolver import Resolving


class ResolverFires(Resolving):
    def fires(self):
        return self.w.rows("SELECT job, chunk, stage, coworker, run_id, status, tokens_in, tokens_out, cache_read FROM fires WHERE stage='resolve'")

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
