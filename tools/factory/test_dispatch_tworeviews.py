import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gatefiles
from test_dispatch import Base, HEAD, ready, wf

GATE = ready().replace("a/test_b.py", "tools/factory/test_proof.py").replace("a/b.py", "tools/factory/proof.py")

GATE_FILES = ["tools/factory/proof.py", "tools/factory/redgreen.py", "tools/factory/cutshape.py", "tools/factory/plancheck.py",
              "tools/factory/launch.py", "tools/factory/refresh.py", "tools/factory/control-bounds.json", "tools/factory/dispatch.json",
              "tools/factory/dispatch.py", "tools/factory/reviewpacket.py", "tools/factory/gatefiles.py", "tools/factory/gatefiles.json"]


class GateFiles(unittest.TestCase):
    def test_the_list_names_the_gate_files_and_itself(self):
        self.assertEqual(gatefiles.load(), tuple(GATE_FILES))

    def test_a_job_is_a_gate_job_when_one_of_its_files_is_on_the_list(self):
        files = gatefiles.load()
        self.assertTrue(gatefiles.touched(["tools/factory/proof.py", "tools/factory/test_proof.py"], files))
        self.assertFalse(gatefiles.touched(["tools/factory/test_proof.py"], files))
        self.assertFalse(gatefiles.touched(["tools/factory/proof.py"], None))
        self.assertFalse(gatefiles.touched(["tools/factory/proof.py"], []))


class TwoReviews(Base):
    def setUp(self):
        super().setUp()
        self.w.issues[0]["body"] = GATE

    def reasons(self):
        return [r[0] for r in self.w.rows("SELECT reason FROM transitions WHERE job=5 ORDER BY id")]

    def accept(self, who, head="abcdef1"):
        self.w.finish(who, "ok\nVERDICT: ACCEPT @%s" % head)
        self.tick()

    def test_one_accept_on_a_gate_job_asks_a_second_reviewer_who_is_another_coworker(self):
        self.to_review()
        self.accept("r1")
        self.assertEqual(self.state(), "review_wait")
        self.tick()
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual([a for a, _, _ in self.w.sends[1:]], ["r1", "r2"])
        self.assertEqual(self.w.merges, [])

    def test_two_accepts_of_the_same_head_by_two_reviewers_go_to_the_checks(self):
        self.to_review()
        self.accept("r1")
        self.tick()
        self.accept("r2")
        self.assertEqual(self.state(), "checks")
        self.assertEqual(self.w.merges, [])
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick(3)
        self.assertEqual(len(self.w.merges), 1)
        self.assertEqual(self.state(), "merged")

    def test_the_second_reviewer_rejecting_sends_the_fix_round_and_both_accepts_are_asked_again(self):
        self.to_review()
        self.accept("r1")
        self.tick()
        self.w.finish("r2", "bad\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick(2)
        self.assertEqual(self.state(), "fixing")
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.tick()
        third = self.w.sends[-1][0]
        self.assertEqual(self.state(), "reviewing")
        self.accept(third)
        self.assertEqual(self.state(), "review_wait")
        self.tick()
        self.assertNotEqual(self.w.sends[-1][0], third)
        self.assertEqual(self.state(), "reviewing")

    def test_a_job_with_no_gate_file_needs_one_accept_as_before(self):
        self.w.issues[0]["body"] = ready()
        self.to_checks()
        self.assertEqual(self.state(), "checks")

    def test_with_one_reviewer_in_the_pool_the_job_waits_and_says_why(self):
        self.cfg["reviewers"] = [{"id": "r1", "name": "R1"}]
        self.to_review()
        self.accept("r1")
        self.tick(2)
        self.assertEqual(self.state(), "review_wait")
        self.assertEqual([a for a, _, _ in self.w.sends].count("r1"), 1)
        self.assertEqual(len([r for r in self.reasons() if "second reviewer" in r]), 1)
