import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evidence as E
import test_evidence as T

FULL = T.FULL
REFS = "repos/%s/git/matching-refs/heads/chunk/71-c1" % FULL
OLD, NEW = "a" * 40, "b" * 40


def runs(sha, *states):
    return {"repos/%s/commits/%s/check-runs?per_page=100" % (FULL, sha): {"check_runs": [{"name": "t%d" % i, "status": s, "conclusion": c, "id": i} for i, (s, c) in enumerate(states)]}}


class EvidencePoll(unittest.TestCase):
    def test_ci_at_commit(self):
        data = {REFS: [{"ref": "refs/heads/chunk/71-c1", "object": {"sha": NEW}}]}
        data.update(runs(OLD, ("completed", "failure")))
        data.update(runs(NEW, ("completed", "success")))
        v, d = E.ci_at_commit(T.fake(data), FULL, "chunk/71-c1")
        self.assertEqual((v, d["sha"], d["ci"]), ("OK", NEW, "GREEN"))
        data.update(runs(NEW, ("completed", "success"), ("in_progress", None)))
        self.assertEqual(E.ci_at_commit(T.fake(data), FULL, "chunk/71-c1")[0], "WAITING")
        self.assertEqual(E.ci_at_commit(T.fake({REFS: []}), FULL, "chunk/71-c1")[0], "NONE")


if __name__ == "__main__":
    unittest.main()
