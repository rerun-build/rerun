import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store
import tokenstats

NOW = 1000000.0


def job(name, ago, result=None, fix=0, replans=0):
    return {"job": name, "merged_at": NOW - ago, "dev_result": result, "fix_rounds": fix, "replans": replans}


class Bar(unittest.TestCase):
    def test_only_a_merge_whose_dev_result_is_green_is_solved_green(self):
        jobs = [job("1", 10, "green"), job("2", 10, "red"), job("3", 10, "unproved"), job("4", 10)]
        day = tokenstats.bar(jobs, [], [], NOW)["day"]
        self.assertEqual((day["solved"], day["solvedGreen"]), (4, 1))

    def test_day_and_week_are_two_windows(self):
        jobs = [job("1", 10, "green"), job("2", 3 * 86400, "green"), job("3", 9 * 86400, "green")]
        out = tokenstats.bar(jobs, [], [], NOW)
        self.assertEqual((out["day"]["solved"], out["week"]["solved"]), (1, 2))

    def test_tokens_per_issue_is_every_token_of_the_window_over_the_green_solved(self):
        jobs = [job("1", 10, "green"), job("2", 3 * 86400, "green"), job("3", 4 * 86400, "green")]
        fires = [{"at": NOW - 5, "tokens": 500}, {"at": NOW - 2 * 86400, "tokens": 3500}, {"at": NOW - 9 * 86400, "tokens": 999}]
        out = tokenstats.bar(jobs, fires, [], NOW)
        self.assertEqual(out["day"]["tokensPerIssue"], 500)
        self.assertEqual(out["week"]["tokensPerIssue"], 4000 / 3)

    def test_no_green_solved_gives_no_tokens_per_issue(self):
        out = tokenstats.bar([job("1", 10, "red")], [{"at": NOW - 5, "tokens": 500}], [], NOW)
        self.assertIsNone(out["day"]["tokensPerIssue"])

    def test_first_pass_needs_no_fix_round_and_no_re_plan(self):
        jobs = [job("1", 10), job("2", 10, fix=1), job("3", 10, replans=1), job("4", 10)]
        self.assertEqual(tokenstats.bar(jobs, [], [], NOW)["day"]["firstPassYield"], 0.5)

    def test_escaped_counts_each_solved_issue_once_in_the_window_of_its_escape(self):
        escaped = [{"job": "1", "at": NOW - 5}, {"job": "1", "at": NOW - 6}, {"job": "2", "at": NOW - 2 * 86400},
                   {"job": "3", "at": NOW - 9 * 86400}]
        out = tokenstats.bar([], [], escaped, NOW)
        self.assertEqual((out["day"]["escaped"], out["week"]["escaped"]), (1, 2))


class DigestBar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)
        self.now = limits.ts("2026-11-15T12:00:00Z")

    def put(self, n, state, at, **extra):
        data = {"issue": n, "title": "T", "body": "**Depends on**: none\n"}
        data.update(extra)
        self.st.put_job(str(n), state, data, "r", at="2026-11-15T%sZ" % at)

    def fire(self, job, stage, run, tin, tout):
        fid = self.st.intent(job, "", stage, at="2026-11-15T09:30:00Z")
        self.st.fired(fid, run)
        self.st.close_run(run, "done", tokens_in=tin, tokens_out=tout)

    def test_the_digest_carries_the_bar_from_the_store(self):
        self.put(1, "queued", "08:00:00")
        self.put(1, "merged", "09:00:00", dev_result="green")
        self.put(2, "queued", "08:00:00")
        self.put(2, "fix_wait", "08:30:00")
        self.put(2, "merged", "10:00:00")
        self.fire("1", "build", "r1", 600, 400)
        self.fire("plan:9", "plan", "r2", 700, 300)
        self.st.set("escaped", "2|reopened", json.dumps({"job": "2", "by": "reopened", "at": "2026-11-15T11:00:00Z"}))
        self.st.set("escaped", "3|bad", "not json")
        d = digest.build(self.st, {}, self.now)
        self.assertEqual(d["bar"]["day"], {"solved": 2, "solvedGreen": 1, "tokensPerIssue": 2000,
                                           "firstPassYield": 0.5, "escaped": 1})

    def test_an_empty_store_gives_zeros_and_nulls(self):
        empty = {"solved": 0, "solvedGreen": 0, "tokensPerIssue": None, "firstPassYield": None, "escaped": 0}
        self.assertEqual(digest.bar(self.st, self.now), {"day": empty, "week": empty})


if __name__ == "__main__":
    unittest.main()
