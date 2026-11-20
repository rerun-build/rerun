import unittest

import briefs


class ResolverIssuecheck(unittest.TestCase):
    def test_the_resolver_brief_runs_issuecheck_before_filing(self):
        brief = briefs.resolver_brief("o/r", "k", {"issue": 1, "evidence": "e"})
        self.assertIn("python3 -I tools/factory/issuecheck.py <file>", brief)
        self.assertIn("open it only when it prints OK", brief)


if __name__ == "__main__":
    unittest.main()
