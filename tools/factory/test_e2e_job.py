import os, sys, tempfile, unittest
from types import SimpleNamespace as NS
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakegh, ghclient, runner_loop as R
from test_intake import OK1, OK2, plan
from test_ready_start import Eng, T0


class Client(ghclient.Client):
    merged = False
    def branch_sha(self, branch): return "basesha"
    def pr_by_head(self, branch): return {"number": 5, "state": "open", "merged": self.merged, "merge_sha": None}


class E2EJob(unittest.TestCase):
    def test_issue_to_second_chunk_ready(self):
        f = fakegh.Fake(issues={71: {"title": "t", "body": plan(OK1, OK2.replace("depends on: -", "depends on: A1").replace("/a.py", "/b.py").replace("/test_a.py", "/test_b.py")), "author_association": "OWNER"}},
                        diffs={("basesha", "chunk/71-A1"): "DIFF"})
        f.start(); os.environ["GH_TOKEN_TEST"] = "t"; applied = []
        saved = (R.CO, R.AP, R.TR, R.PB, R.EV)
        R.EV = NS(stage_check=lambda *a: ("OK", ""))
        R.CO = NS(Checkout=lambda p, u, b: NS(ensure=lambda: "p"))
        R.AP = NS(apply=lambda w, p, a: applied.append(p) or "applied")
        R.TR = NS(run=lambda b, h, c: {"verdict": "ok"})
        R.PB = NS(publish=lambda *a: None)
        try:
            gh = Client(f.url, "o/r", token_env="GH_TOKEN_TEST")
            with tempfile.TemporaryDirectory() as d, mock.patch.object(R.subprocess, "run", lambda *a, **k: NS(returncode=0)):
                cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(d, "t.json"), "store_file": os.path.join(d, "l.db"),
                       "triggers": [{"stage": "build", "coworker": "CODE", "agent": "ag1", "slug": "factory-build"}]}
                eng = Eng(); eng.now = T0
                r = R.build(cfg, eng, clock=lambda: T0, gh=gh)
                try:
                    self.assertEqual(R.intake_issue(r.st, gh, "o/r", 71)[1], [])
                    r.tick()
                    self.assertEqual([x["chunk"] for x in r.st.running()], ["A1"])
                    eng.runs["run1"]["status"] = "done"
                    r.tick()
                    self.assertEqual(applied, ["DIFF"])
                    self.assertIn("published:A1", r.st.get_all("71"))
                    gh.merged = True
                    r.tick(); r.tick()
                    self.assertEqual(r.st.get_ready("71", "A1")["state"], "merged")
                    self.assertEqual([x["chunk"] for x in r.st.running()], ["A2"])
                finally:
                    r.st.close()
        finally:
            R.CO, R.AP, R.TR, R.PB, R.EV = saved; f.stop()


if __name__ == "__main__":
    unittest.main()
