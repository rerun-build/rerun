import os
import unittest
from unittest import mock

import dispatch as D
from test_dispatch import Base, PR_LINE


class Home(Base):
    def setUp(self):
        super().setUp()
        self.cfg.update(repo="p/q", home="o/r")
        self.w.report_answer = {"kept": True}

    def repos(self, calls):
        out = set()
        for a in calls:
            if "-R" in a:
                out.add(a[a.index("-R") + 1])
            out.update(x.split("/")[1] + "/" + x.split("/")[2] for x in a if x.startswith("repos/"))
        return out

    def test_issues_and_pull_requests_are_read_from_the_project(self):
        self.to_review()
        job = [a for a in self.w.gh_calls if a[:2] in (["issue", "list"], ["issue", "view"], ["pr", "view"], ["pr", "list"])
               and "Factory control in:title" not in a]
        self.assertTrue(job)
        self.assertEqual(self.repos(job), {"p/q"})

    def test_the_refresh_reads_the_home_when_the_project_is_another_repository(self):
        with mock.patch.dict(os.environ, {"FACTORY_CODE_SHA": "a" * 40, "FACTORY_DATA_DIR": self.dir.name}):
            self.tick(D.REFRESH_BEATS)
        asked = [a for a in self.w.gh_calls if a[0] == "api" and "factory-tools.yml" in a[-1]]
        self.assertTrue(asked)
        self.assertEqual(self.repos(asked), {"o/r"})

    def test_the_control_issue_and_the_digest_stay_at_home(self):
        self.tick(6)
        control = [a for a in self.w.gh_calls if "Factory control in:title" in a]
        self.assertGreaterEqual(len(control), 2)
        self.assertEqual(self.repos(control), {"o/r"})

    def test_the_briefs_name_the_project_and_its_tools_take_it(self):
        self.to_review()
        build, review = self.w.sends[0][1], self.w.sends[1][1]
        self.assertIn('p/q #5, "Fix x"', build)
        self.assertNotIn("rerun", build.split("\n")[0])
        self.assertIn("pull request #42 of p/q, for job #5", review)
        j = dict(self.d.jobs()[0])
        self.assertIn("pull request #42 of p/q (job #5)", D.fix_brief(j, 42, "r"))
        self.assertIn("/data/tools/bin/packet p/q 42", D.proof_brief(j, 42, "abcdef1", ["a"]))
        self.assertIn("/data/tools/bin/wt new p/q 5 a2", D.build_brief(dict(j, take=2)))
        self.assertEqual(self.w.rows("SELECT json_extract(data, '$.repo') FROM jobs WHERE job='5'")[0][0], "p/q")

    def test_at_home_the_briefs_read_as_before(self):
        self.cfg.update(repo="o/r", home="o/r")
        self.to_review()
        self.assertIn('rerun #5, "Fix x"', self.w.sends[0][1])
        self.assertIn("pull request #42 of rerun, for job #5", self.w.sends[1][1])
        self.assertIsNone(self.w.rows("SELECT json_extract(data, '$.repo') FROM jobs WHERE job='5'")[0][0])

    def test_a_line_that_takes_nothing_new_still_finishes_its_jobs(self):
        self.tick()
        self.d.taking = self.d.reporting = False
        self.w.issues.append({"number": 6, "title": "New", "body": self.w.issues[0]["body"], "comments": []})
        before = len(self.w.reports)
        self.w.finish("b1", PR_LINE)
        self.tick(2)
        self.assertEqual(self.job_ids(), ["5"])
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual(len(self.w.reports), before)

    def test_runs_of_other_lines_count_as_running(self):
        self.d = self.new()
        self.d.others = lambda: [("b1", None)]
        self.tick()
        self.assertEqual(self.w.sends[0][0], "b2")

    def test_the_answer_of_the_report_is_kept_and_cleared_when_the_app_is_away(self):
        self.w.report_answer = {"kept": True, "project": {"repo": "p/q"}}
        self.d = self.new()
        self.d.extra = lambda: {"home": "o/r"}
        self.tick()
        self.assertEqual(self.d.answer, {"kept": True, "project": {"repo": "p/q"}})
        self.assertEqual(self.w.reports[-1]["home"], "o/r")
        self.assertEqual(self.w.reports[-1]["repo"], "p/q")
        self.w.report_answer = None
        self.tick()
        self.assertIsNone(self.d.answer)


if __name__ == "__main__":
    unittest.main()
