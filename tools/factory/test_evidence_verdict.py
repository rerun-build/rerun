import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evidence as E
import test_evidence as T

FULL = T.FULL
HEAD, OLD = "b" * 40, "a" * 40
PR = "repos/%s/pulls/7" % FULL
CM = "repos/%s/issues/7/comments?per_page=100" % FULL


def data(*bodies):
    return {PR: {"head": {"sha": HEAD}}, CM: [T.cm(i + 1, "09:%02d" % i, b) for i, b in enumerate(bodies)]}


class EvidenceVerdict(unittest.TestCase):
    def test_old_commit_refused(self):
        old = "Review ACCEPT @%s: LINUS ACCEPT @%s: ok" % (OLD[:8], OLD[:8])
        v, d = E.verdict(T.fake(data(old)), FULL, 7, "linus", "2026-11-12T08:00:00Z")
        self.assertEqual(v, "NONE")
        self.assertIn(OLD[:8], d)
        self.assertIn(HEAD[:8], d)
        new = "Review ACCEPT @%s: LINUS ACCEPT @%s: ok" % (HEAD[:8], HEAD[:8])
        self.assertEqual(E.verdict(T.fake(data(old, new)), FULL, 7, "linus", "2026-11-12T08:00:00Z")[0], "ACCEPT")


if __name__ == "__main__":
    unittest.main()
