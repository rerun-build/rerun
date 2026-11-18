import os, subprocess, sys, tempfile, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gate as G
import learn
from test_jobcost import agent

OLD, NEW = "special-place-ai-heaven/rerun", "special-place-ai-heaven/moldwright"


class BothNamesAreOneRepository(unittest.TestCase):
    def test_the_gate_takes_a_pr_body_with_either_name(self):
        with mock.patch.object(G, "gh_json", return_value={"body": ""}):
            for body_repo, gate_repo in ((OLD, NEW), (NEW, OLD), ("rerun", NEW)):
                self.assertEqual(G.ledger_builders(gate_repo, body_repo, 9, [], "factory/job-9"), ([], None), (body_repo, gate_repo))
            self.assertIn("PR body names", G.ledger_builders(NEW, "special-place-ai-heaven/testpilot", 9, [], "factory/job-9")[1])

    def test_job_cost_under_the_new_name_finds_the_runs_tagged_with_the_folder_name(self):
        root = tempfile.mkdtemp()
        agent(root, "a0", "JOB rerun#84\nTask: a")
        for arg in ("moldwright#84", NEW + "#84"):
            r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "jobcost.py"), arg], capture_output=True, text=True,
                               env=dict(os.environ, JOBCOST_AGENTS=root), timeout=60)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("JOB rerun#84: 1 runs", r.stdout, arg)

    def test_a_learn_brief_tags_the_job_by_its_folder_name(self):
        self.assertTrue(learn.brief({}, NEW, 5).startswith("JOB rerun#5 LEARN"))


if __name__ == "__main__":
    unittest.main()
