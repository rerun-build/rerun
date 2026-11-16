import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import problems
import resolver
from test_dispatch import Base, HEAD, ready, wf

SHA = "feedface12345678"
ACCEPT = "ok\nVERDICT: ACCEPT @abcdef1"
PR5 = "Done.\nPR: https://github.com/o/r/pull/42"
PR6 = "Done.\nPR: https://github.com/o/r/pull/43"


def job(n, state, **kw):
    return dict({"issue": n, "state": state}, **kw)


def merged(n, result, since, pr, **kw):
    return job(n, "merged", own_merge=True, pr=pr, merge_sha=SHA, dev_result=result, dev_since=since,
               dev_why="Factory tools: failure" if result == "red" else "ok", **kw)


class Watch(unittest.TestCase):
    def find(self, jobs):
        return problems.Watch().find(jobs, {}, set(), "L", 0.0, [], "", False)

    def test_the_latest_dev_result_red_is_the_problem_dev_red(self):
        got = self.find([merged(5, "red", 100.0, 43)])
        self.assertIn("dev red", got)
        line = got["dev red"]
        self.assertIn("dev is red at feedfac after the merge of pull request #43 (job #5): Factory tools: failure", line)
        self.assertIn("gh run rerun", line)
        self.assertIn("FILED", line)

    def test_a_later_green_result_ends_it(self):
        got = self.find([merged(5, "red", 100.0, 43), merged(6, "green", 200.0, 44)])
        self.assertNotIn("dev red", got)

    def test_unproved_results_neither_open_nor_end_it(self):
        self.assertIn("dev red", self.find([merged(5, "red", 100.0, 43), merged(6, "unproved", 200.0, 44)]))
        self.assertNotIn("dev red", self.find([merged(5, "green", 100.0, 43), merged(6, "unproved", 200.0, 44)]))


class Kinds(unittest.TestCase):
    def test_dev_red_is_a_kind_ranked_first_and_cleared_like_a_job_problem(self):
        self.assertEqual(resolver.KINDS[0], "dev red")
        self.assertEqual(resolver.SYSTEMIC, ("idle line", "repeating error"))
        self.assertEqual(resolver.rank("dev red")[0], 0)
        self.assertNotIn("dev red", resolver.SYSTEMIC)


class DevRed(Base):
    builders = ["b1"]

    def setUp(self):
        super().setUp()
        self.cfg["resolver"] = {"detect": True, "resolve": False}
        self.cfg["reviewers"] = [{"id": "r1", "name": "R1"}]

    def records(self):
        return {k: json.loads(v) for k, v in self.d.store.get_all("problems").items()}

    def reasons(self, n):
        return [r[0] for r in self.w.rows("SELECT reason FROM transitions WHERE job=? ORDER BY id", str(n))]

    def merge_first_red(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.w.workflows[SHA] = [wf("Factory tools", "failure", wid=2)]
        self.tick(2)
        self.assertEqual(self.state(5), "merged")

    def second_to_checks(self):
        self.w.issues.append({"number": 6, "title": "B", "comments": [],
                              "body": ready().replace("a/b.py", "c/d.py").replace("a/test_b.py", "c/test_d.py")})
        self.w.pr_state = "OPEN"
        self.tick()
        self.w.finish("b1", PR6)
        self.tick(2)
        self.w.finish("r1", ACCEPT)
        self.tick()
        self.tick(2)

    def test_a_red_dev_opens_one_problem_issue(self):
        self.merge_first_red()
        self.assertEqual(len(self.w.problems), 1)
        p = self.w.problems[0]
        self.assertEqual(p["title"], "Factory problem: dev red")
        self.assertIn("dev is red at feedfac", p["body"])
        self.assertEqual(self.records()["dev red"]["issue"], p["number"])

    def test_no_merge_while_dev_red_is_open(self):
        self.merge_first_red()
        self.second_to_checks()
        self.assertEqual(self.state(6), "checks")
        self.assertEqual(len(self.w.merges), 1)
        self.assertEqual(len([r for r in self.reasons(6) if r and "dev is red" in r]), 1)

    def test_the_merge_goes_on_when_the_problem_is_closed(self):
        self.merge_first_red()
        self.second_to_checks()
        self.w.workflows[SHA] = [wf("Factory tools", "success", wid=2)]
        self.tick(6)
        self.assertEqual(self.state(6), "merged")
        self.assertEqual(self.w.problems[0]["state"], "CLOSED")
        self.assertEqual(len(self.w.merges), 2)

    def test_the_job_the_resolver_filed_for_it_is_merged_while_dev_is_red(self):
        self.merge_first_red()
        self.second_to_checks()
        r = self.records()["dev red"]
        r["filed"] = 6
        self.d.store.set("problems", "dev red", json.dumps(r))
        self.tick()
        self.assertEqual(self.state(6), "merged")
        self.assertEqual(self.w.problems[0]["state"], "OPEN")


if __name__ == "__main__":
    unittest.main()
