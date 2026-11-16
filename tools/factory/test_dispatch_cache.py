import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T

COUNTS = "SELECT tokens_in, tokens_out, cache_read FROM fires WHERE run_id=?"


class RunCache(T.Base):
    def finish_with(self, agent, output, tin, tout, cached, status="done"):
        self.w.finish(agent, output, status=status)
        rid = [r for r, a in self.w.order if a == agent][-1]
        self.w.runs[rid].update(inputTokens=tin, outputTokens=tout, cachedInputTokens=cached)
        return rid

    def test_a_done_run_writes_its_cached_input_tokens_with_its_counts(self):
        self.tick()
        rid = self.finish_with("b1", T.PR_LINE, 1200, 300, 900)
        self.tick()
        self.assertEqual(self.w.rows(COUNTS, rid), [(1200, 300, 900)])

    def test_an_errored_run_keeps_its_cached_input_tokens(self):
        self.tick()
        rid = self.finish_with("b1", "", 400, 9, 250, status="error")
        self.tick()
        self.assertEqual(self.w.rows(COUNTS, rid), [(400, 9, 250)])

    def test_a_run_without_cached_input_tokens_leaves_null(self):
        self.tick()
        rid = self.finish_with("b1", T.PR_LINE, 50, 7, None)
        self.tick()
        self.assertEqual(self.w.rows(COUNTS, rid), [(50, 7, None)])


if __name__ == "__main__":
    unittest.main()
