import unittest

import briefs


class Briefs(unittest.TestCase):
    J = {"issue": 7, "title": "Note x", "extra": "PLAN."}

    def test_each_brief_names_the_job_its_files_and_one_pull_request(self):
        r = briefs.research_brief(self.J)
        d = briefs.design_brief(self.J)
        for b in (r, d):
            for s in ("rerun #7", "Note x", "(#7)", "Closes #7",
                      "one pull request into dev", "special-place-administrator",
                      "call no other coworker", "BLOCKED: plan:",
                      "issue number in its name", "goes into `/tmp`", "the folder above it",
                      "/data/tools/bin/pr-open --template"):
                self.assertIn(s, b)
            self.assertNotIn("Final state", b)
        for s in ("source", "date", "/data/tools/bin/wt new rerun 7 r1"):
            self.assertIn(s, r)
        for s in ("options", "/data/tools/bin/wt new rerun 7 d1"):
            self.assertIn(s, d)

    def test_research_and_design_briefs_name_the_last_commented_commit_and_a_new_worktree_per_take(self):
        again = dict(self.J, take=2)
        for b in (briefs.research_brief(self.J), briefs.design_brief(self.J)):
            self.assertIn("86d04999", b)
        self.assertIn("/data/tools/bin/wt new rerun 7 r2", briefs.research_brief(again))
        self.assertIn("/data/tools/bin/wt new rerun 7 d2", briefs.design_brief(again))
        self.assertIn("/data/tools/bin/wt new rerun 7 r1", briefs.research_brief(self.J))

    def test_the_resolver_brief_runs_issuecheck_before_filing(self):
        b = briefs.resolver_brief("o/r", "ended #1", {"issue": 7, "evidence": "e"})
        self.assertIn("tools/factory/issuecheck.py", b)
        self.assertIn("never file a body it rejected", b)


if __name__ == "__main__":
    unittest.main()
