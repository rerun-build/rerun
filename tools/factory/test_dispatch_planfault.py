import json, os, sys, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proof
import test_dispatch_proof as P

HEAD = P.HEAD
PLAN2 = "ASK 2: NOT MET (plan) the Run block lacks the test line"


def lines(*notmet):
    out = []
    for n in range(1, 6):
        if n in notmet:
            out.append("ASK %d: NOT MET (plan) Files lacks a path" % n)
        else:
            out.append("ASK %d: MET a/b.py:%d test_%d" % (n, n, n))
    return "\n".join(out)


class Judge(unittest.TestCase):
    def test_every_not_met_of_kind_plan_is_a_plan_result(self):
        for last in ("PROOF: PASS @abcdef1", "PROOF: FAIL @abcdef1: 2, 4"):
            kind, why = proof.judge(lines(2, 4) + "\n" + last, 5, HEAD)
            self.assertEqual(kind, "plan")
            self.assertEqual(why, "ASK 2: NOT MET (plan) Files lacks a path\nASK 4: NOT MET (plan) Files lacks a path")
        kind, why = proof.judge("ASK 1: NOT MET (plan) " + "x" * 3000 + "\nPROOF: FAIL @abcdef1: 1", 5, HEAD)
        self.assertEqual(kind, "plan")
        self.assertEqual(len(why), 1500)

    def test_one_plain_not_met_keeps_it_a_fail(self):
        out = lines(2) + "\nASK 3: NOT MET no test\nPROOF: FAIL @abcdef1: 2, 3"
        self.assertEqual(proof.judge(out, 5, HEAD)[0], "fail")
        out = lines(2) + "\nASK 3: NOT MET no test\nPROOF: PASS @abcdef1"
        self.assertEqual(proof.judge(out, 5, HEAD)[0], "fail")

    def test_a_plan_line_under_another_commit_is_none(self):
        self.assertEqual(proof.judge(lines(2) + "\nPROOF: FAIL @1234567: 2", 5, HEAD)[0], "none")


class Flow(P.ProofBase):
    def setUp(self):
        super().setUp()
        self.cfg["types"] = {
            "coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
            "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}, {"id": "r2", "name": "R2", "runs": 1}]},
            "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}]},
        }

    def data(self):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])

    def builder_sends(self):
        return [s for s in self.w.sends if s[0] == "b1"]

    def planner_sends(self):
        return [s for s in self.w.sends if s[0] == "p1"]

    def test_a_plan_proof_returns_the_job_and_the_re_plan_carries_the_provers_lines(self):
        self.to_proving()
        self.w.finish("r2", lines(2) + "\nPROOF: FAIL @abcdef1: 2")
        self.tick(2)
        self.assertEqual(self.state(), "returned")
        self.assertTrue(self.data()["reason"].startswith("plan: proof:"))
        self.assertEqual(len(self.builder_sends()), 1)
        sent = self.planner_sends()
        self.assertEqual(len(sent), 1)
        self.assertIn("ASK 2: NOT MET (plan) Files lacks a path", sent[0][1])
        self.assertIn("#42", sent[0][1])
        self.assertEqual(self.data()["replans"], 1)

    def test_a_plan_proof_in_round_two_is_returned_not_rejected(self):
        self.to_proving()
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4, 5")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.tick()
        self.w.finish("b1", "PUSHED: fix")
        self.tick(2)
        self.w.finish("r1", P.T.ACCEPT)
        self.tick(2)
        self.tick()
        self.w.finish("r2", lines(3) + "\nPROOF: FAIL @abcdef1: 3")
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertTrue(self.data()["reason"].startswith("plan: proof:"))

    def test_a_review_reject_plan_goes_to_the_re_plan(self):
        self.to_review()
        verdict = "VERDICT: REJECT (plan) @abcdef1: Files lacks a path"
        self.w.finish("r1", "no\n" + verdict)
        self.tick(2)
        self.assertEqual(self.state(), "returned")
        self.assertTrue(self.data()["reason"].startswith("plan: review: VERDICT: REJECT (plan)"))
        self.assertEqual(len(self.builder_sends()), 1)
        sent = self.planner_sends()
        self.assertEqual(len(sent), 1)
        self.assertIn(verdict, sent[0][1])

    def test_a_plain_reject_still_goes_to_the_fix(self):
        self.to_review()
        self.w.finish("r1", "no\nVERDICT: REJECT @abcdef1: wrong")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual(self.planner_sends(), [])

    def test_after_two_re_plans_a_plan_result_ends_unsolvable_without_a_send(self):
        for _ in range(3):
            self.to_proving()
            self.w.finish("r2", lines(2) + "\nPROOF: FAIL @abcdef1: 2")
            self.tick(3)
            self.w.unlabelled.clear()
        self.assertEqual(self.state(), "unsolvable")
        self.assertEqual(len(self.planner_sends()), 2)
        self.assertEqual(self.data()["replans"], 2)
        self.assertTrue(self.data()["reason"].startswith("plan: proof:"))
        self.tick(3)
        self.assertEqual(len(self.planner_sends()), 2)


    def test_the_proof_and_review_briefs_name_the_plan_form(self):
        self.to_proving()
        self.assertIn("ASK <n>: NOT MET (plan) <", self.w.sends[-1][1])
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4, 5")
        self.tick(2)
        self.w.finish("b1", "PUSHED: fix")
        self.tick(2)
        self.assertIn("VERDICT: REJECT (plan) @<first 7 characters>: <one sentence>", self.w.sends[-1][1])

    def test_the_re_plan_brief_carries_the_kept_lines(self):
        self.to_proving()
        self.w.finish("r2", lines(2) + "\nPROOF: FAIL @abcdef1: 2")
        self.tick(2)
        brief = self.planner_sends()[0][1]
        self.assertIn("Pull request #42 is open", brief)
        self.assertIn("ASK 2: NOT MET (plan) Files lacks a path", brief)


if __name__ == "__main__":
    unittest.main()
