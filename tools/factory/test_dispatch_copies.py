import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import World, PR_LINE, ready

LINE = "carries the issue number in its name"


def issue(n):
    return {"number": n, "title": "Fix %d" % n, "body": ready(), "comments": []}


class Copies(unittest.TestCase):
    def make(self, runs, issues, extra=()):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.w = World(issues)
        self.cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "auto_plan_marker": True,
                    "ledger_file": os.path.join(tmp.name, "ledger.db"),
                    "json_state_file": os.path.join(tmp.name, "dispatch.json"),
                    "heartbeat_file": os.path.join(tmp.name, "heartbeat"),
                    "types": {"coder": {"max_jobs": 8, "coworkers": [{"id": "c1", "name": "C1", "runs": runs}, *extra]},
                              "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]}}}
        self.w.ledger = self.cfg["ledger_file"]
        self.d = D.Dispatcher(self.cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        self.addCleanup(self.d.close)

    def beat(self, n=1):
        for _ in range(n):
            self.d.once()

    def copies(self):
        return {int(j): c for j, c in ((j, self.d.store.get_job(j).get("copy")) for j in ("1", "2", "3", "4")
                                        if self.d.store.get_job(j))}

    def test_three_runs_of_one_coder_build_three_jobs_at_once_with_their_copy_on_the_ledger(self):
        self.make(3, [issue(n) for n in (1, 2, 3, 4)])
        self.beat()
        self.assertEqual([s[0] for s in self.w.sends], ["c1", "c1", "c1"])
        self.assertEqual(self.copies(), {1: 1, 2: 2, 3: 3, 4: None})
        self.assertEqual(self.d.store.get_job("4")["state"], "queued")
        self.w.runs["run2"] = {"status": "done", "output": PR_LINE, "error": None}
        self.beat()
        self.assertEqual(len(self.w.sends), 4)
        self.assertIn("rerun #4", self.w.sends[3][1])
        self.assertEqual(self.d.store.get_job("4")["copy"], 2)

    def test_each_send_carries_its_copy_number_as_copy_index(self):
        self.make(3, [issue(n) for n in (1, 2, 3, 4)])
        self.beat()
        self.assertEqual([a.get("copyIndex") for a in self.w.send_args if a["agentId"] == "c1"], [1, 2, 3])

    def test_with_one_run_each_a_coworker_takes_one_job_and_the_briefs_carry_the_file_name_line(self):
        self.make(1, [issue(1), issue(2)])
        self.beat(2)
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.d.store.get_job("2")["state"], "queued")
        j = {"issue": 1, "title": "t", "round": 1}
        self.assertIn(LINE, D.build_brief(j))
        self.assertIn(LINE, D.fix_brief(j, 3, "no"))

    def test_the_build_brief_gives_lint_and_type_check_calls_of_their_own(self):
        b = D.build_brief({"issue": 1, "title": "t", "round": 1})
        self.assertIn("a shell call of their own", b)
        self.assertIn("`timeoutMs` set above the default of 120000", b)
        self.assertIn("never chain them with the commit or `pr-open`", b)

    def test_the_replan_brief_runs_issuecheck_before_saving(self):
        b = D.replan_brief({"issue": 7, "title": "Fix x", "reason": "r"}, "o/r", 1)
        self.assertIn("tools/factory/issuecheck.py", b)
        self.assertIn("save only when it prints OK", b)

    def test_the_briefs_say_where_a_file_outside_the_change_goes(self):
        j = {"issue": 1, "title": "t", "round": 1}
        for b in (D.build_brief(j), D.fix_brief(j, 3, "no")):
            for s in ("goes into `/tmp`", "carries the issue number in its name",
                      "removed once it is used",
                      "Never put one in your worktree or in the folder above it"):
                self.assertIn(s, b)

    def test_a_coworker_with_an_unresolved_send_gets_no_further_send(self):
        self.make(3, [issue(n) for n in (1, 2, 3)], extra=[{"id": "b2", "name": "B2", "runs": 1}])
        real, state = self.w.account, {"first": True}

        def account(tool, args):
            if tool == "send_message" and state["first"]:
                state["first"] = False
                raise D.Error("account send_message failed: TimeoutError")
            return real(tool, args)
        self.d.account = account
        self.beat()
        j1 = self.d.store.get_job("1")
        self.assertEqual((j1["state"], j1["agent"]), ("building", "c1"))
        self.assertTrue(j1["sending"])
        self.assertFalse(j1.get("run"))
        self.assertEqual([(s[0], "rerun #2" in s[1]) for s in self.w.sends], [("b2", True)])
        self.assertEqual(self.d.store.get_job("2")["agent"], "b2")
        self.assertEqual(self.d.store.get_job("3")["state"], "queued")
        for n in ("1", "2", "3"):
            run = self.d.store.get_job(n).get("run")
            if run:
                self.assertIn("rerun #%s" % n, [s[1] for s in self.w.sends if s[0] and self.w.order[self.w.sends.index(s)][0] == run][0])
        self.beat(D.LOST_BEATS)
        self.assertEqual(self.d.store.get_job("1")["state"], "queued")
        before = len(self.w.sends)
        self.w.clock += 3600
        self.beat()
        self.assertTrue(any(s[0] == "c1" for s in self.w.sends[before:]))

    def test_the_resend_of_a_failed_attempt_waits_while_its_coworker_has_an_unresolved_send(self):
        self.make(3, [issue(2)])
        self.beat()
        self.assertTrue(self.d.store.get_job("2").get("run"))
        self.w.issues.append(issue(1))
        real, state = self.w.account, {"first": True}

        def account(tool, args):
            if tool == "send_message" and state["first"]:
                state["first"] = False
                raise D.Error("account send_message failed: TimeoutError")
            return real(tool, args)
        self.d.account = account
        self.beat()
        j1 = self.d.store.get_job("1")
        self.assertEqual(j1["state"], "building")
        self.assertTrue(j1["sending"])
        self.assertFalse(j1.get("run"))
        self.w.runs[self.d.store.get_job("2")["run"]] = {"status": "error", "output": None, "error": "boom"}
        sent = len(self.w.sends)
        self.beat()
        self.assertEqual(len(self.w.sends), sent)
        self.assertEqual(self.d.store.get_job("2")["state"], "queued")
        self.assertTrue(self.d.store.get_job("1")["sending"])
        self.beat(D.LOST_BEATS)
        self.w.clock += 3600
        self.beat(3)
        self.assertEqual(sorted(s[0] for s in self.w.sends[sent:]), ["c1", "c1"])
        for n in ("1", "2"):
            run = self.d.store.get_job(n).get("run")
            self.assertTrue(run)
            msg = [s[1] for s, (r, _) in zip(self.w.sends, self.w.order) if r == run][0]
            self.assertIn("rerun #%s" % n, msg)


if __name__ == "__main__":
    unittest.main()
