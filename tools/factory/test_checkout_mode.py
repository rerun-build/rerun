import os
from unittest import mock

import test_factory as T
from test_clone_new import CloneCase

F = T.F
HERE = os.path.dirname(os.path.abspath(__file__))


class Mode(CloneCase):
    def wt_new(self, chunk, fault=None):
        def boom(*a, **k):
            raise RuntimeError("tool fault")
        with mock.patch.object(F, "plan_check", lambda *a: None), mock.patch.object(F, "api", lambda *a, **k: {"default_branch": "main"}), \
                mock.patch.object(F, "MIN_FREE_GB", 0), mock.patch.object(F, "MIN_FREE_MEM_GB", 0), \
                mock.patch.dict(os.environ, {"PATH": self.env["PATH"]}):
            if fault == "tool":
                with mock.patch.object(self.C, "new", boom):
                    try:
                        return self.call(F.cmd_wt, ["new", T.REPO, "7", chunk])
                    except RuntimeError:
                        return "traceback", ""
            if fault == "transient":
                with mock.patch.object(self.C, "new", lambda *a, **k: self.C.transient("GitHub answered 502")):
                    return self.call(F.cmd_wt, ["new", T.REPO, "7", chunk])
            return self.call(F.cmd_wt, ["new", T.REPO, "7", chunk])

    def test_the_default_is_worktree_and_the_setting_lives_in_state(self):
        self.assertEqual(self.C.mode(), "worktree")
        self.assertTrue(self.C.mode_path().startswith(F.STATE + os.sep))
        with open(self.C.mode_path(), "w") as f:
            f.write("{not json")
        self.assertEqual(self.C.mode(), "worktree")

    def test_clone_needs_the_canary_record(self):
        code, out = self.call(F.cmd_wt, ["mode", "clone"])
        self.assertEqual(code, 2, out)
        self.assertIn("needs the canary record", out)
        self.assertEqual(self.C.mode(), "worktree")
        code, out = self.call(F.cmd_wt, ["mode", "clone", "--canary", "https://github.com/x/y/issues/1#c"])
        self.assertEqual(code, 0, out)
        self.assertEqual(self.C.mode(), "clone")

    def test_in_clone_mode_wt_new_makes_a_clone(self):
        self.call(F.cmd_wt, ["mode", "clone", "--canary", "u"])
        code, out = self.wt_new("1")
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.isdir(os.path.join(self.folder("1"), ".git")))

    def test_one_tool_fault_in_the_first_five_jobs_switches_back(self):
        self.call(F.cmd_wt, ["mode", "clone", "--canary", "u"])
        for c in ("1", "2"):
            self.assertEqual(self.wt_new(c)[0], 0)
        self.assertEqual(self.wt_new("3", fault="tool")[0], "traceback")
        self.assertEqual(self.C.mode(), "worktree")

    def test_after_the_watch_three_tool_faults_in_a_row_switch_back_and_two_do_not(self):
        self.call(F.cmd_wt, ["mode", "clone", "--canary", "u"])
        for c in "12345":
            self.assertEqual(self.wt_new(c)[0], 0)
        self.wt_new("6", fault="tool")
        self.wt_new("7", fault="tool")
        self.assertEqual(self.C.mode(), "clone")
        self.wt_new("8", fault="tool")
        self.assertEqual(self.C.mode(), "worktree")
        self.assertIn("3 tool faults in a row", self.C.mode_record()["why"])

    def test_outside_failures_never_count(self):
        self.call(F.cmd_wt, ["mode", "clone", "--canary", "u"])
        for c in "123456":
            code, out = self.wt_new(c, fault="transient")
            self.assertEqual(code, 3, out)
        self.assertEqual(self.C.mode(), "clone")

    def test_the_canary_procedure_names_every_step(self):
        with open(os.path.join(HERE, "CANARY.md")) as f:
            text = f.read()
        for need in ("mirror check rerun", "--clone", "pr-open --fix", "CONFLICT:", "MERGED earlier as", "wt janitor --apply",
                     "wt restore", "1, 4 and 8", "wt mode clone --canary", "first five clone jobs"):
            self.assertIn(need, text)

    def test_the_checkout_files_need_a_second_reviewer(self):
        import roster
        with open(os.path.join(HERE, "roster.json")) as f:
            ro = roster.load(f.read())
        for f_ in ("tools/factory/clones.py", "tools/factory/factory.py", "tools/factory/install.sh", "tools/factory/bin/wt"):
            self.assertIn(roster.GATE_SENSITIVE, roster.required(ro, [f_]), f_)
