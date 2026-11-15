import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_loop as R
import tempfile
from test_chain_failure import Eng, T0


class MergedState(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "t.json"),
               "store_file": os.path.join(self.d.name, "l.db"),
               "triggers": [{"stage": "build", "coworker": "CODE", "agent": "ag1", "slug": "factory-build"}]}
        self.eng = Eng()
        self.eng.now = T0
        self.r = R.build(cfg, self.eng, clock=lambda: T0)

    def tearDown(self):
        self.r.st.close()
        self.d.cleanup()

    def state(self, c):
        return self.r.st.get_ready("j", c)["state"]

    def test_merged_job_pr_marks_both_chunks_merged(self):
        seen = []
        self.r.pr_by_head = lambda b: seen.append(b) or {"number": 1, "state": "closed", "merged": True, "merge_sha": "m"}
        for c in "AB":
            self.r.st.add_ready("j", c)
            self.r.st.set_ready_state("j", c, "running")
            self.r.st.set("j", "published:" + c, "1")
        self.r.st.add_ready("j", "C")
        self.r.st.set_ready_state("j", "C", "running")
        self.r.see_merges()
        self.assertEqual([self.state(c) for c in "ABC"], ["merged", "merged", "running"])
        self.assertEqual(seen, ["factory/job-j"])

    def test_open_pr_leaves_state(self):
        self.r.pr_by_head = lambda b: {"number": 1, "state": "open", "merged": False, "merge_sha": None}
        self.r.st.add_ready("j", "A")
        self.r.st.set_ready_state("j", "A", "running")
        self.r.st.set("j", "published:A", "1")
        self.r.tick()
        self.assertEqual(self.state("A"), "running")


if __name__ == "__main__":
    unittest.main()
