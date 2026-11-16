import json, os, stat, subprocess, unittest
from unittest import mock
from test_factory import FactoryCase, FULL, F, git, write
from test_dispatch import Base, HEAD

PIN = "ruff==0.17.5"
WORKFLOW = "name: Factory tools\njobs:\n  test:\n    steps:\n      - name: Lint\n        run: pipx run %s check tools/factory\n" % PIN


def plan(lines):
    return "SMALL FIX\n\n**Run**\n```\n" + "".join(line + "\n" for line in lines) + "```\n"


def run(name, status="completed", conclusion=None):
    return {"name": name, "status": status, "conclusion": conclusion, "workflow_id": 1}


class PrOpenPreflight(FactoryCase):
    def setUp(self):
        super().setUp()
        dev = self.make_clone("dev-push")
        git(dev, "checkout", "--quiet", "dev")
        os.makedirs(os.path.join(dev, ".github/workflows"))
        write(dev, ".github/workflows/factory-tools.yml", WORKFLOW)
        git(dev, "add", "-A")
        git(dev, "commit", "--quiet", "-m", "workflow")
        git(dev, "push", "--quiet", "origin", "HEAD:refs/heads/dev")
        git(self.clone, "fetch", "--quiet", "origin")
        self.uvx_args = os.path.join(self.tmp, "uvx-args")
        self.uvx = os.path.join(self.tmp, "no-uvx")

    def fake_uvx(self, code=0, says=""):
        self.uvx = os.path.join(self.tmp, "uvx")
        write(self.tmp, "uvx", "#!/bin/sh\necho \"$@\" > %s\nprintf '%%s\\n' '%s'\nexit %d\n" % (self.uvx_args, says, code))
        os.chmod(self.uvx, os.stat(self.uvx).st_mode | stat.S_IEXEC)

    def open_pr(self, lines=(), fix=False, runs=(), commits=("work.txt",)):
        p = self.wt(issue="7", chunk="1")
        for name in commits:
            os.makedirs(os.path.dirname(os.path.join(p, name)), exist_ok=True)
            self.commit(p, name)
        body = os.path.join(self.tmp, "body.md")
        write(self.tmp, "body.md", "\n".join(F.PR_HEADS) + "\n")
        real_run, self.pushes = F.run, []

        def fake_run(cmd, *a, **k):
            if cmd[0] != F.GH:
                if "push" in cmd:
                    self.pushes.append(cmd)
                return real_run(cmd, *a, **k)
            if cmd[1] == "api" and "/actions/runs" in cmd[2]:
                if runs is None:
                    return subprocess.CompletedProcess(cmd, 1, "", "HTTP 502")
                return subprocess.CompletedProcess(cmd, 0, json.dumps({"workflow_runs": list(runs)}), "")
            if cmd[1] == "api":
                return subprocess.CompletedProcess(cmd, 0, json.dumps({"number": 7, "body": plan(lines)}), "")
            if cmd[1] == "pr" and cmd[2] == "list":
                out = [{"number": 9, "url": "https://github.com/%s/pull/9" % FULL, "headRefOid": "1234567abcdef"}] if fix else []
                return subprocess.CompletedProcess(cmd, 0, json.dumps(out), "")
            return subprocess.CompletedProcess(cmd, 0, "https://github.com/%s/pull/9\n" % FULL, "")

        ctx = (p, FULL, "chunk/7-1", "dev", "7", "1")
        argv = ["--fix"] if fix else ["--title", "t", "--body-file", body]
        with mock.patch.object(F, "wt_context", lambda: ctx), mock.patch.object(F, "run", fake_run), \
                mock.patch.dict(os.environ, {"FACTORY_UVX": self.uvx}):
            return self.call(F.cmd_pr_open, argv)

    def pushed(self):
        return self.remote_sha("refs/heads/chunk/7-1") != ""

    def test_a_failing_run_line_refuses_before_the_push_with_its_last_lines(self):
        line = "echo first; for i in $(seq 1 30); do echo row$i; done; exit 3"
        code, out = self.open_pr(["echo fine", line])
        self.assertEqual(code, 2, out)
        self.assertIn("the Run line `%s` fails here (exit 3), nothing is pushed. Its last lines:" % line, out)
        self.assertIn("row30", out)
        self.assertNotIn("row10\n", out)
        self.assertNotIn("\nfirst\n", out)
        self.assertFalse(self.pushed())

    def test_passing_run_lines_open_the_pull_request(self):
        code, out = self.open_pr(["echo one", "true"])
        self.assertEqual(code, 0, out)
        self.assertIn("Run line passed: echo one", out)
        self.assertIn("Run line passed: true", out)
        self.assertTrue(self.pushed())
        self.assertEqual(len(self.pushes), 1)

    def test_a_line_whose_tool_is_not_on_the_server_is_named_and_does_not_refuse(self):
        code, out = self.open_pr(["no-such-tool-here --x"])
        self.assertEqual(code, 0, out)
        self.assertIn("not run on this server: no-such-tool-here --x", out)
        self.assertTrue(self.pushed())

    def refused_at_127(self, line):
        code, out = self.open_pr([line])
        self.assertEqual(code, 2, out)
        self.assertIn("the Run line `%s` fails here (exit 127)" % line, out)
        self.assertFalse(self.pushed())

    def test_exit_127_from_inside_a_line_refuses(self):
        self.refused_at_127("sh -c 'exit 127'")

    def test_a_missing_tool_inside_a_script_refuses(self):
        self.refused_at_127("sh -c no-such-tool-here")

    def test_a_missing_tool_after_cd_or_an_assignment_is_named_and_does_not_refuse(self):
        code, out = self.open_pr(["cd . && no-such-tool-here", "FOO=1 no-such-tool-here"])
        self.assertEqual(code, 0, out)
        self.assertIn("not run on this server: cd . && no-such-tool-here", out)
        self.assertIn("not run on this server: FOO=1 no-such-tool-here", out)
        self.assertTrue(self.pushed())

    def test_a_fix_whose_runs_cannot_be_read_says_so_and_is_pushed(self):
        code, out = self.open_pr(["true"], fix=True, runs=None)
        self.assertEqual(code, 0, out)
        self.assertIn("could not read the workflow runs of the head 1234567", out)
        self.assertTrue(self.pushed())

    def test_a_fix_runs_the_lines_too(self):
        code, out = self.open_pr(["exit 4"], fix=True)
        self.assertEqual(code, 2, out)
        self.assertIn("the Run line `exit 4` fails here (exit 4)", out)
        self.assertFalse(self.pushed())

    def test_a_fix_is_refused_while_a_run_of_the_head_is_queued_or_in_progress(self):
        runs = [run("CI", status="queued"), run("Factory tools", status="in_progress"), run("Image", conclusion="success")]
        code, out = self.open_pr(["true"], fix=True, runs=runs)
        self.assertEqual(code, 2, out)
        self.assertIn("a workflow run of the pull request's head 1234567 is not finished (queued: CI; running: Factory tools)", out)
        self.assertIn("ci-wait rerun 9", out)
        self.assertNotIn("Run line passed", out)
        self.assertFalse(self.pushed())

    def test_a_fix_is_pushed_once_every_run_of_the_head_has_ended(self):
        code, out = self.open_pr(["true"], fix=True, runs=[run("CI", conclusion="failure"), run("Factory tools", conclusion="success")])
        self.assertEqual(code, 0, out)
        self.assertIn("PUSHED fix", out)
        self.assertTrue(self.pushed())
        self.assertEqual(len(self.pushes), 1)

    def test_a_lint_finding_under_tools_factory_refuses_with_the_findings(self):
        self.fake_uvx(1, "tools/factory/x.py:1:1: F401 unused import")
        code, out = self.open_pr(commits=("tools/factory/x.py",))
        self.assertEqual(code, 2, out)
        self.assertIn("F401 unused import", out)
        self.assertEqual(open(self.uvx_args).read().split(), [PIN, "check", "tools/factory"])
        self.assertFalse(self.pushed())

    def test_a_clean_lint_opens_the_pull_request(self):
        self.fake_uvx(0, "All checks passed!")
        code, out = self.open_pr(commits=("tools/factory/x.py",))
        self.assertEqual(code, 0, out)
        self.assertEqual(open(self.uvx_args).read().split(), [PIN, "check", "tools/factory"])
        self.assertTrue(self.pushed())

    def test_no_lint_runs_for_a_change_outside_tools_factory(self):
        self.fake_uvx(1, "finding")
        code, out = self.open_pr(commits=("tools/other/x.py", "tools/factory/notes.txt"))
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(self.uvx_args))
        self.assertTrue(self.pushed())

    def test_a_linter_that_could_not_run_is_named_and_does_not_refuse(self):
        self.fake_uvx(2, "error: failed to download ruff")
        code, out = self.open_pr(commits=("tools/factory/x.py",))
        self.assertEqual(code, 0, out)
        self.assertIn("lint not run: ruff==0.17.5 did not run here (exit 2): error: failed to download ruff", out)
        self.assertTrue(self.pushed())

    def test_without_uvx_on_the_server_the_lint_is_named_and_does_not_refuse(self):
        code, out = self.open_pr(commits=("tools/factory/x.py",))
        self.assertEqual(code, 0, out)
        self.assertIn("lint not run: ", out)
        self.assertTrue(self.pushed())


class ChecksAfterPush(Base):
    def failures(self):
        return [tuple(r) for r in self.w.rows("SELECT kind, station FROM failures ORDER BY id")]

    def test_a_red_workflow_run_on_a_pushed_head_is_a_failure_event_of_the_build(self):
        self.to_checks()
        self.w.workflows[HEAD] = [dict(run("CI", conclusion="failure"), id=11)]
        self.w.run_jobs = {"11": [{"steps": [{"name": "Lint", "conclusion": "success"}]}]}
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.assertIn(("ci red after push", "build"), self.failures())
        self.assertNotIn(("lint red after push", "build"), self.failures())
        self.assertEqual([tuple(r) for r in self.w.rows("SELECT coworker FROM failures WHERE kind='ci red after push'")], [("B1",)])

    def test_a_red_lint_step_is_its_own_failure_event(self):
        self.to_checks()
        self.w.workflows[HEAD] = [dict(run("Factory tools", conclusion="failure"), id=12), run("Factory tools", conclusion="failure")]
        self.w.run_jobs = {"12": [{"steps": [{"name": "Checkout", "conclusion": "success"}, {"name": "Lint", "conclusion": "failure"}]}]}
        self.tick()
        self.assertIn(("ci red after push", "build"), self.failures())
        self.assertIn(("lint red after push", "build"), self.failures())

    def test_a_second_red_result_on_the_same_head_is_not_counted_again(self):
        self.to_checks()
        self.w.workflows[HEAD] = [dict(run("CI", conclusion="failure"), id=11)]
        self.w.run_jobs = {"11": [{"steps": [{"name": "Lint", "conclusion": "success"}]}]}
        self.tick(2)
        self.assertEqual(self.state(), "fixing")
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.w.finish("r1", "VERDICT: ACCEPT @abcdef1")
        self.tick(2)
        self.assertEqual(self.state(), "failed")
        self.assertEqual(self.failures().count(("ci red after push", "build")), 1)


if __name__ == "__main__":
    unittest.main()
