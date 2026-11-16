import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, HEAD, PR_LINE, wf
from test_dispatch_proof import ProofBase


def fix_briefs(w):
    return [s for s in w.sends if "One fix round" in s[1]]


class Rounds(Base):
    def round(self):
        return self.w.rows("SELECT round FROM jobs WHERE job='5'")[0][0]

    def reject(self):
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: wrong sum")
        self.tick()

    def test_a_conflict_update_keeps_the_review_fix_round(self):
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick()
        self.w.mergeable = "CONFLICTING"
        self.tick(2)
        self.assertEqual(self.state(), "fixing")
        self.w.mergeable = "MERGEABLE"
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick()
        self.assertEqual((self.state(), self.round()), ("review_wait", 1))
        self.tick()
        self.reject()
        self.assertEqual(self.state(), "fix_wait")
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.assertEqual(self.round(), 2)
        self.reject()
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual(len(fix_briefs(self.w)), 2)

    def test_a_ci_fix_keeps_the_review_fix_round(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("e2e", "failure")]
        self.tick(2)
        self.assertEqual(self.state(), "fixing")
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.assertEqual((self.state(), self.round()), ("reviewing", 1))
        self.reject()
        self.assertEqual(self.state(), "fix_wait")


class ProofRounds(ProofBase):
    def test_a_ci_fix_keeps_the_proof_fix_round(self):
        self.w.workflows[HEAD] = [wf("e2e", "failure")]
        self.to_checks()
        self.tick(2)
        self.assertEqual(self.state(), "fixing")
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.tick(3)
        self.assertEqual(self.state(), "proving")
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")


if __name__ == "__main__":
    unittest.main()
