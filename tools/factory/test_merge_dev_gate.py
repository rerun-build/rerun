import contextlib, io, json, os, shutil, subprocess, sys, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import factory as F
from test_dispatch import Base, HEAD, wf

PR = {"base": {"ref": "dev"}, "head": {"ref": "chunk/7-1", "sha": "a" * 40}, "state": "open", "draft": False, "merge_commit_sha": "0" * 40}
OTHER_HEAD = "9876543210fedcba"
SHA = "feedface12345678"
WRAPPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "gh")


class MergeDevGate(unittest.TestCase):
    def merge(self, gate_code, dispatcher="1"):
        calls = []

        def fake_api(path, *a, **k):
            return [] if path.endswith("/files?per_page=100") else {"default_branch": "main"} if path.count("/") == 2 else PR

        def fake_run(cmd, *a, **k):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, gate_code if cmd[1].endswith("gate.py") else 0, "GATE", "")

        green = [{"name": "ci", "status": "completed", "conclusion": "success", "id": 1, "url": ""}]
        out = io.StringIO()
        env = dict(os.environ)
        if dispatcher is None:
            env.pop("FACTORY_DISPATCHER", None)
        else:
            env["FACTORY_DISPATCHER"] = dispatcher
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(F, "api", fake_api), \
                mock.patch.object(F, "run", fake_run), mock.patch.object(F, "checks", lambda *a: green), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                F.cmd_merge_dev(["rerun", "9"])
                code = 0
            except SystemExit as e:
                code = e.code
        return code, calls, out.getvalue()

    def test_refused_without_pass_at_head(self):
        code, calls, _ = self.merge(1)
        self.assertNotEqual(code, 0)
        self.assertFalse(any(c[1:3] == ["pr", "merge"] for c in calls))
        self.assertTrue(any(c[1].endswith("gate.py") for c in calls))

    def test_merges_when_gate_passes(self):
        code, calls, _ = self.merge(0)
        self.assertEqual(code, 0)
        self.assertTrue(any(c[1:3] == ["pr", "merge"] for c in calls))

    def test_non_dispatcher_environment_cannot_merge(self):
        code, calls, out = self.merge(0, dispatcher=None)
        self.assertEqual(code, 2)
        self.assertIn("restricted to the factory dispatcher", out)
        self.assertEqual(calls, [])
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "merge-dev")))
        if shutil.which("sh"):
            with tempfile.TemporaryDirectory() as d:
                key, real, log = os.path.join(d, "key"), os.path.join(d, "gh"), os.path.join(d, "log")
                with open(key, "w") as f:
                    f.write("shared\n")
                with open(real, "w") as f:
                    f.write('#!/bin/sh\necho "$*" >> "$LOG"\n')
                os.chmod(real, 0o755)
                env = dict(os.environ, FACTORY_GH_KEY=key, FACTORY_GH_APP=os.path.join(d, "no-app"), FACTORY_GH_REAL=real, LOG=log)
                env.pop("FACTORY_DISPATCHER", None)
                for args in (["pr", "merge", "9"], ["api", "-X", "PUT", "repos/o/r/pulls/9/merge"]):
                    p = subprocess.run(["sh", WRAPPER] + args, capture_output=True, text=True, env=env)
                    self.assertEqual(p.returncode, 64, args)
                self.assertFalse(os.path.exists(log))


class DispatchMergeAndHold(Base):
    def test_holds_merge_on_same_beat_dev_turns_red_and_rejects_mismatched_merged_head(self):
        self.cfg["resolver"] = {"detect": True, "resolve": False}
        self.d = self.new()
        self.d.save({"issue": 1, "title": "A", "body": "Fix\n", "state": "merged", "own_merge": True,
                     "pr": 41, "head": HEAD, "merge_sha": SHA, "dev_since": 900.0}, "seeded")
        self.d.save({"issue": 2, "title": "B", "body": "Fix\n", "state": "checks", "pr": 42,
                     "head": HEAD, "checks_since": 950.0, "round": 1, "worker": "coder"}, "seeded")
        self.w.workflows[SHA] = [wf("Factory tools", "failure", wid=2)]
        self.w.workflows[HEAD] = [wf("ci", "success", wid=1)]
        self.tick()
        self.assertEqual(self.d.store.get_job("1")["dev_result"], "red")
        self.assertEqual(self.state(2), "checks")
        self.assertEqual(self.w.merges, [])
        self.assertTrue(self.d.store.get_job("2").get("dev_hold"))

        self.d.save({"issue": 3, "title": "C", "body": "Fix\n", "state": "checks", "pr": 43,
                     "head": HEAD, "checks_since": 950.0, "round": 1, "worker": "coder"}, "seeded")
        self.w.workflows[SHA] = [wf("Factory tools", "success", wid=2)]
        real_gh, seen = self.w.gh, {"merged_43": False}

        def gh(args):
            a = list(args)
            if a[:3] == ["pr", "merge", "43"]:
                seen["merged_43"] = True
                raise D.Error("gh pr merge failed: exit 1: Head branch was modified")
            if a[:3] == ["pr", "view", "43"] and seen["merged_43"]:
                return json.dumps({"state": "MERGED", "headRefOid": OTHER_HEAD})
            return real_gh(a)

        self.d.gh = gh
        self.tick(4)
        j3 = self.d.store.get_job("3")
        self.assertEqual(j3["state"], "merged")
        self.assertFalse(j3.get("own_merge"))
        self.assertEqual(j3["reason"], "merged outside the delegator")


if __name__ == "__main__":
    unittest.main()
