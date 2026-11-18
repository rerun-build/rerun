import json
import unittest

import dispatch as D
from test_dispatch import Base

BODY = """PLAN READY (cut of #3; facts read on dev 1234567)
**Depends on**: none
**Worker**: coder
**Files**
- `a/b.py`
- `a/test_b.py`
**Test file**: `a/test_b.py`
**Change**
- `do_it()` in a/b.py takes a limit
"""
TOUCHED = {"count": 1, "files": [{"filename": "a/b.py", "status": "modified", "patch": "@@ -1 +1 @@\n-def do_it():\n+def do_it(limit):"}]}
ELSEWHERE = {"count": 1, "files": [{"filename": "a/b.py", "status": "modified", "patch": "@@ -9 +9 @@\n+LIMIT = 3"}]}


class Recheck(Base):
    def setUp(self):
        super().setUp()
        self.w.issues = [{"number": 5, "title": "Fix x", "body": BODY, "comments": []}]
        self.cfg["planning"] = {"recheck": {"tries": 1}}
        self.compare, self.compare_fails, self.queries = TOUCHED, False, []

    def new(self):
        def gh(args):
            if args[0] == "api" and "/compare/" in args[1] and "--jq" in args and "$want" in args[args.index("--jq") + 1]:
                self.queries.append(args[1])
                if self.compare_fails:
                    raise D.Error("gh api failed: HTTP 502")
                return json.dumps(self.compare)
            return self.w.gh(args)
        return D.Dispatcher(self.cfg, self.w.account, gh, now=lambda: self.w.clock)

    def job(self):
        return self.d.store.get_job("5")

    def builds(self):
        return [s for s in self.w.sends if s[0] in ("b1", "b2")]

    def test_dev_changing_a_named_function_sends_the_job_to_a_recheck_before_any_build(self):
        self.tick()
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(self.builds(), [])
        self.assertEqual(self.queries, ["repos/o/r/compare/1234567...dev"])
        j = self.job()
        self.assertEqual((j["rechecks"], j["recheck"]["from"]), (1, "1234567"))
        self.assertIn("do_it", j["recheck"]["why"][0])
        self.tick()
        self.assertEqual((self.state(), self.builds()), ("waiting", []))

    def test_a_fresh_answer_lets_the_job_build_and_the_count_stops_a_second_recheck(self):
        self.tick()
        self.d.store.set("recheck:5", "attempt", "1")
        self.d.store.set("recheck:5", "state", "fresh")
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertEqual(len(self.builds()), 1)
        self.assertEqual(self.job()["rechecks"], 1)
        self.assertNotIn("recheck", self.job())

    def test_a_blocked_answer_returns_the_job_to_the_planner(self):
        self.tick()
        self.d.store.set("recheck:5", "attempt", "1")
        self.d.store.set("recheck:5", "state", "blocked")
        self.d.store.set("recheck:5", "why", "plan: dev already caps do_it")
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.job()["reason"], "plan: dev already caps do_it")

    def test_a_change_that_names_nothing_the_job_relies_on_builds_at_once(self):
        self.compare = ELSEWHERE
        self.tick()
        self.assertEqual(self.state(), "building")

    def test_a_failed_diff_read_builds_on_what_the_job_has(self):
        self.compare_fails = True
        self.tick()
        self.assertEqual(self.state(), "building")

    def test_without_recheck_settings_dev_is_not_read(self):
        del self.cfg["planning"]
        self.tick()
        self.assertEqual((self.state(), self.queries), ("building", []))


if __name__ == "__main__":
    unittest.main()
