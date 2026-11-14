import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T

TOKENS = "SELECT tokens_in, tokens_out FROM fires WHERE run_id=?"


class Counting:
    """The world's account, counting the get_run reads of each run."""

    def __init__(self, world):
        self.world, self.reads, self.account_orig = world, {}, world.account
        world.account = self.call

    def call(self, tool, args):
        if tool == "get_run":
            self.reads[args["runId"]] = self.reads.get(args["runId"], 0) + 1
        return self.account_orig(tool, args)


class RunTokens(T.Base):
    def finish_with(self, agent, output, tin, tout, status="done"):
        self.w.finish(agent, output, status=status)
        rid = [r for r, a in self.w.order if a == agent][-1]
        self.w.runs[rid].update(inputTokens=tin, outputTokens=tout)
        return rid

    def test_a_done_run_writes_its_token_counts_into_its_fire(self):
        self.tick()
        rid = self.finish_with("b1", T.PR_LINE, 1200, 300)
        self.tick()
        self.assertEqual(self.w.rows(TOKENS, rid), [(1200, 300)])

    def test_the_counts_come_from_the_read_that_ends_the_run_not_from_an_extra_one(self):
        count = Counting(self.w)
        self.tick(3)  # sent, then two beats while it runs
        rid = [r for r, a in self.w.order if a == "b1"][-1]
        before = count.reads.get(rid, 0)
        self.finish_with("b1", T.PR_LINE, 50, 7)
        self.tick()
        self.assertEqual(count.reads[rid], before + 1)
        self.tick(3)
        self.assertEqual(count.reads[rid], before + 1)  # the next beats read other runs, never this one again
        self.assertEqual(self.w.rows(TOKENS, rid), [(50, 7)])

    def test_an_errored_run_keeps_its_counts_too(self):
        self.tick()
        rid = self.finish_with("b1", "", 400, 9, status="error")
        self.tick()
        self.assertEqual(self.w.rows(TOKENS, rid), [(400, 9)])

    def test_a_run_without_counts_leaves_zero_and_says_so_once(self):
        self.tick()
        rid = self.finish_with("b1", T.PR_LINE, None, None)
        self.tick(4)
        self.assertEqual(self.w.rows(TOKENS, rid), [(0, 0)])
        self.assertEqual(self.out.getvalue().count("token counts of run %s" % rid), 1)


if __name__ == "__main__":
    unittest.main()
