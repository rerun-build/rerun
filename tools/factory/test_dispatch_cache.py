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

    def test_a_done_run_is_closed_in_the_ledger_with_the_time_it_ended(self):
        self.tick()
        rid = self.finish_with("b1", T.PR_LINE, 1200, 300, 900)
        self.w.runs[rid]["finishedAt"] = "2026-11-17T10:00:00.250Z"
        self.tick()
        self.assertEqual(self.w.rows("SELECT status, ended_at, tokens_in, tokens_out, cache_read FROM fires WHERE run_id=?", rid),
                         [("done", "2026-11-17T10:00:00.250Z", 1200, 300, 900)])

    def test_an_errored_run_is_closed_as_an_error_and_keeps_its_counts(self):
        self.tick()
        rid = self.finish_with("b1", "", 400, 9, 250, status="error")
        self.tick()
        self.assertEqual(self.w.rows("SELECT status, ended_at IS NOT NULL, tokens_in FROM fires WHERE run_id=?", rid), [("error", 1, 400)])

    def old_run(self, rid, job, status):
        st = self.d.store
        st.fired(st.intent(job, "", "build", coworker=self.d.names["b1"]), rid)
        st.db.execute("UPDATE fires SET intent_at=? WHERE run_id=?", ("1969-12-01T00:00:00Z", rid))
        st.db.commit()
        self.w.runs[rid] = {"status": status, "finishedAt": "2026-01-01T00:20:00Z", "inputTokens": 70, "outputTokens": 5, "cachedInputTokens": 40}

    def test_runs_left_open_by_an_older_dispatcher_are_closed_with_what_the_engine_says(self):
        self.tick()
        self.old_run("old1", "7", "done")
        self.old_run("old2", "8", "error")
        self.old_run("old3", "9", "running")
        self.old_run("old4", "plan:3", "done")
        self.tick()
        got = dict((r[0], r[1:]) for r in self.w.rows("SELECT run_id, status, ended_at, tokens_in, cache_read FROM fires WHERE run_id LIKE ?", "old%"))
        self.assertEqual(got["old1"], ("done", "2026-01-01T00:20:00Z", 70, 40))
        self.assertEqual(got["old2"][0], "error")
        self.assertEqual(got["old3"][:2], ("running", None))
        self.assertEqual(got["old4"][:2], ("running", None))
        self.assertEqual(self.w.rows("SELECT status FROM fires WHERE run_id=?", [r for r, a in self.w.order if a == "b1"][-1]), [("running",)])

    def test_old_runs_that_cannot_be_read_do_not_keep_later_ones_from_being_closed(self):
        self.tick()
        inner = self.d.account

        def account(tool, args, timeout=30):
            if tool == "get_run" and args["runId"].startswith("gone"):
                raise T.D.Error("account get_run failed: the tool reported an error")
            return inner(tool, args)

        self.d.account = account
        for n in range(70):
            self.old_run("gone%d" % n, str(100 + n), "done")
        self.old_run("old1", "7", "done")
        self.tick(6)
        self.assertEqual(self.w.rows("SELECT status FROM fires WHERE run_id=?", "old1"), [("done",)])

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
