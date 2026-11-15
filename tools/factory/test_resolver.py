import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, ready, D


class Problems(Base):
    def setUp(self):
        super().setUp()
        self.cfg["resolver"] = {"detect": True, "resolve": False}

    def bad(self, n, body=None):
        return {"number": n, "title": "bad %d" % n, "body": body or ready().replace("**Files**", "Files"), "comments": []}

    def records(self):
        return {k: json.loads(v) for k, v in self.d.store.get_all("problems").items()}


class Tickets(Problems):
    def test_each_problem_key_gets_one_labelled_issue_with_its_key_line_and_evidence(self):
        self.w.issues.append(self.bad(6))
        self.tick(2)
        self.assertEqual(len(self.w.problems), 1)
        p = self.w.problems[0]
        self.assertEqual(p["title"], "Factory problem: unreadable #6")
        self.assertEqual(p["labels"], ["factory-problem"])
        self.assertIn("Problem-Key: unreadable #6\n", p["body"])
        self.assertIn("files: no **Files** heading", p["body"])
        self.assertEqual(self.records()["unreadable #6"]["issue"], p["number"])

    def test_new_evidence_edits_the_body_once_and_the_same_evidence_does_not(self):
        self.w.issues.append(self.bad(6))
        self.tick()
        self.w.issue(6)["body"] = self.w.issue(6)["body"].replace("**Depends on**: none", "")
        self.tick(3)
        n = str(self.w.problems[0]["number"])
        self.assertEqual(len([c for c in self.w.gh_calls if c[:3] == ["issue", "edit", n]]), 1)
        self.assertIn("dependency line", self.w.problems[0]["body"])

    def test_a_key_gone_for_three_beats_is_closed_with_a_cleared_comment_and_not_opened_again(self):
        self.w.issues.append(self.bad(6))
        self.tick()
        self.w.issue(6)["body"] = ready()
        self.tick(2)
        p = self.w.problems[0]
        self.assertEqual(p["state"], "OPEN")
        self.tick()
        self.assertEqual(p["state"], "CLOSED")
        self.assertEqual(p["comments"], ["cleared at 1970-01-01T00:16:40Z"])
        self.assertEqual(self.records()["unreadable #6"]["state"], "closed")
        self.tick()
        self.assertEqual(len(self.w.problems), 1)

    def test_a_key_back_within_three_beats_keeps_its_issue_open(self):
        self.w.issues.append(self.bad(6))
        self.tick()
        broken = self.w.issue(6)["body"]
        self.w.issue(6)["body"] = ready()
        self.tick(2)
        self.w.issue(6)["body"] = broken
        self.tick()
        self.w.issue(6)["body"] = ready()
        self.tick(2)
        self.assertEqual(self.w.problems[0]["state"], "OPEN")
        self.assertEqual(len(self.w.problems), 1)

    def test_at_most_ten_new_issues_a_beat_and_thirty_open_logged_once_when_capped(self):
        self.w.issues += [self.bad(n) for n in range(10, 45)]
        self.tick()
        self.assertEqual(len(self.w.problems), 10)
        self.tick(2)
        self.assertEqual(len(self.w.problems), 30)
        self.tick(2)
        self.assertEqual(len(self.w.problems), 30)
        self.assertEqual(self.out.getvalue().count("problems capped: 5 not opened, 30 open"), 1)
        self.assertNotIn("problems capped", " ".join(D.HEARD))

    def test_an_ended_job_is_a_problem_while_its_issue_is_open_and_not_once_it_is_closed(self):
        self.w.open_numbers |= {5}
        self.tick()
        self.w.finish("b1", "BLOCKED: the issue cannot be done as written")
        self.tick(2)
        self.assertEqual([p["title"] for p in self.w.problems], ["Factory problem: ended #5"])
        self.assertIn("job #5 ended blocked: BLOCKED: the issue cannot be done as written; pull request none",
                      self.w.problems[0]["body"])
        self.w.open_numbers -= {5}
        self.tick(13)
        self.assertEqual(self.w.problems[0]["state"], "CLOSED")

    def test_with_detect_off_no_problem_issue_is_opened(self):
        del self.cfg["resolver"]
        self.w.issues.append(self.bad(6))
        self.tick(3)
        self.assertEqual(self.w.problems, [])
        self.assertEqual(self.records(), {})


class Resolving(Problems):
    def setUp(self):
        super().setUp()
        cw = lambda ids: [{"id": i, "name": i.upper(), "runs": 1} for i in ids]
        self.cfg["types"] = {"coder": {"max_jobs": 8, "coworkers": cw(["b1", "b2"])}, "reviewer": {"coworkers": cw(["r1", "r2"])},
                             "resolver": {"coworkers": [{"id": "h1", "name": "HOUSE", "runs": 2}]}}
        self.cfg["resolver"] = {"detect": True, "resolve": True}
        self.w.issues = [self.bad(6)]

    def house(self, key="unreadable #6"):
        return [m for a, m, _ in self.w.sends if a == "h1" and '"%s"' % key in m]

    def rec(self, key="unreadable #6"):
        return self.records()[key]


class Station(Resolving):
    def test_with_resolve_off_a_problem_gets_its_issue_and_nothing_goes_to_house(self):
        self.cfg["resolver"]["resolve"] = False
        self.tick(4)
        self.assertEqual(len(self.w.problems), 1)
        self.assertEqual(self.house(), [])
        self.assertEqual(self.rec()["state"], "resolve_wait")

    def test_a_waiting_problem_goes_to_house_with_its_brief_and_the_three_final_forms_as_goal(self):
        got = []
        orig = self.w.account
        self.w.account = lambda tool, args: (got.append(args) if tool == "send_message" else None) or orig(tool, args)
        self.tick()
        msg = self.house()[0]
        for text in ("unreadable #6", "files: no **Files** heading", "https://github.com/o/r/issues/900", "o/r",
                     "`DO: requeue #<n>`", "`DO: clear-hold <kind>`", "`DO: rerun-ci #<pr>`", "`DO: wait-off #<n>`",
                     "push to dev", "merge", "force-push", "workflow files", "secrets", "on the server", D.NO_COMMENTS,
                     "`RESOLVED: <one sentence of what changed>`", "`FILED: #<n>`", "`ESCALATE: <the step only Rob can take"):
            self.assertIn(text, msg)
        self.assertTrue(msg.endswith(D.TAIL))
        goal = [a for a in got if a["agentId"] == "h1"][0]["goal"]
        self.assertEqual(goal, {"lastLineForms": [{"prefix": "RESOLVED: ", "rest": "sentence"}, {"prefix": "FILED: ", "rest": "sentence"},
                                                  {"prefix": "ESCALATE: ", "rest": "sentence"}], "turnLimit": 3})
        self.assertEqual((self.rec()["state"], self.rec()["run"]), ("resolving", "run1"))

    def test_house_takes_at_most_its_two_copies_and_the_third_problem_waits_for_a_free_one(self):
        self.w.issues = [self.bad(n) for n in (6, 7, 8)]
        self.tick(2)
        self.assertEqual(len([a for a, _, _ in self.w.sends if a == "h1"]), 2)
        self.assertEqual(sorted(r.get("copy") for r in self.records().values() if r["state"] == "resolving"), [1, 2])
        self.w.runs["run1"] = {"status": "done", "output": "RESOLVED: the plan line was fixed"}
        self.tick()
        self.assertEqual(len([a for a, _, _ in self.w.sends if a == "h1"]), 3)

    def test_no_problem_is_sent_while_a_hold_is_on(self):
        self.d = self.new()
        D.holds.arm(self.d.store, "plan limit", self.w.clock + 600)
        self.tick(2)
        self.assertEqual(self.house(), [])
        D.holds.clear(self.d.store, "plan limit")
        self.tick()
        self.assertEqual(len(self.house()), 1)

    def test_resolved_goes_to_verify_and_the_issue_closes_with_the_line_once_the_key_is_gone(self):
        self.tick(2)
        self.w.issue(6)["body"] = ready()
        self.w.finish("h1", "Fixed it.\nRESOLVED: the plan line names the dev commit now")
        self.tick()
        self.assertEqual(self.rec()["state"], "verify")
        self.tick(2)
        self.assertEqual(self.w.problems[0]["state"], "OPEN")
        self.tick()
        self.assertEqual(self.w.problems[0]["state"], "CLOSED")
        self.assertEqual(self.w.problems[0]["comments"], ["cleared at 1970-01-01T00:16:40Z: RESOLVED: the plan line names the dev commit now"])

    def test_still_there_after_six_beats_is_sent_again_and_after_the_second_attempt_goes_to_the_owner(self):
        self.tick(2)
        self.w.finish("h1", "RESOLVED: first try")
        self.tick(6)
        self.assertEqual(len(self.house()), 1)
        self.tick()
        self.assertEqual(len(self.house()), 2)
        self.assertIn("This is attempt 2. The attempt before ended with: RESOLVED: first try", self.house()[1])
        self.w.finish("h1", "RESOLVED: second try")
        self.tick(7)
        p = self.w.problems[0]
        self.assertIn("owner", p["labels"])
        self.assertEqual(p["comments"], ["ESCALATE: the problem is still there after 2 attempts; the last one ended with: RESOLVED: second try"])
        self.tick(3)
        self.assertEqual(len(self.house()), 2)

    def test_escalate_labels_the_owner_and_stops_until_rob_removes_the_label(self):
        self.tick(2)
        self.w.finish("h1", "ESCALATE: Rob runs `gh label create x`")
        self.tick(3)
        p = self.w.problems[0]
        self.assertEqual(p["labels"], ["factory-problem", "owner"])
        self.assertEqual(p["comments"], ["ESCALATE: Rob runs `gh label create x`"])
        self.assertEqual(len(self.house()), 1)
        line = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        self.assertTrue(line.endswith(" | problems 1 open, 1 owner"), line)
        p["labels"].remove("owner")
        self.tick()
        self.assertEqual(len(self.house()), 2)
        self.assertEqual(self.rec()["state"], "resolving")

    def test_a_run_without_a_final_line_is_asked_once_again_then_escalated(self):
        self.tick(2)
        self.w.finish("h1", "I looked around.")
        self.tick()
        self.assertEqual(len(self.house()), 2)
        self.assertIn("Your last run on this problem ended without a final line.", self.house()[1])
        self.w.finish("h1", "still nothing", status="error")
        self.tick(2)
        self.assertEqual(len(self.house()), 2)
        self.assertIn("owner", self.w.problems[0]["labels"])
        self.assertIn("ESCALATE: HOUSE ended twice without a final line", self.w.problems[0]["comments"][0])

    def test_a_run_past_the_run_limit_is_cancelled_and_asked_again(self):
        self.cfg["clocks"] = {"run_limit_s": 100}
        self.tick(2)
        self.w.clock += 101
        self.tick()
        self.assertEqual(self.w.cancels[0], ("h1", "run1"))
        self.assertEqual(len(self.house()), 2)

    def test_filed_holds_the_verify_clock_while_the_filed_job_is_live(self):
        self.tick(2)
        self.w.finish("h1", "FILED: #77")
        self.tick()
        self.d.store.put_job("77", "waiting", {"issue": 77, "title": "fix"})
        self.tick(9)
        self.assertEqual(len(self.house()), 1)
        self.assertEqual(self.rec()["filed"], 77)
        self.d.store.put_job("77", "merged", {"issue": 77, "relabelled": True, "commented": True})
        self.tick(6)
        self.assertEqual(len(self.house()), 2)

    def test_a_house_run_takes_one_of_the_slots(self):
        self.cfg["slots"] = 1
        self.tick(2)
        self.assertEqual(len(self.house()), 1)
        self.w.issues.append({"number": 5, "title": "Fix x", "body": ready(), "comments": []})
        self.tick(2)
        self.assertEqual([a for a, _, _ in self.w.sends], ["h1"])


class Do(Resolving):
    def setUp(self):
        super().setUp()
        self.w.open_numbers = {129}

    def run_with(self, out, status="done"):
        self.tick()
        self.w.finish("h1", out, status=status)
        self.tick()

    def results(self):
        return [c for p in self.w.problems for c in p["comments"] if c.startswith("The dispatcher ran the DO lines")]

    def test_requeue_relabels_a_job_that_ended_blocked_and_intake_takes_it_on_the_next_beat(self):
        self.w.issues.append({"number": 7, "title": "T7", "body": ready(), "comments": []})
        self.w.unlabelled.add(7)
        self.d = self.new()
        self.d.store.put_job("7", "blocked", {"issue": 7, "title": "T7", "relabelled": True, "commented": True, "reason": "x"})
        self.run_with("DO: requeue #7\nDO: requeue #6\nRESOLVED: requeued #7")
        self.assertIn(["issue", "edit", "7", "-R", "o/r", "--add-label", "factory", "--remove-label", "factory-blocked"], self.w.gh_calls)
        self.assertEqual(self.results(), ["The dispatcher ran the DO lines of run run1:\n"
                                          "- DO: requeue #7 -> #7 labelled factory again; intake takes it on the next beat\n"
                                          "- not allowed: DO: requeue #6"])
        self.tick()
        self.assertIn(self.state(7), ("queued", "building"))
        self.tick(3)
        self.assertEqual(len([c for c in self.w.gh_calls if c[:3] == ["issue", "edit", "7"]]), 1)

    def test_clear_hold_lifts_a_named_hold_and_refuses_an_unknown_kind(self):
        self.tick()
        D.holds.arm(self.d.store, "plan limit", self.w.clock + 600)
        self.w.finish("h1", "DO: clear-hold plan limit\nDO: clear-hold everything\nRESOLVED: hold lifted")
        self.tick()
        self.assertIsNone(D.holds.active(self.d.store, self.w.clock))
        self.assertEqual(self.results()[0].split("\n")[1:], ["- DO: clear-hold plan limit -> hold plan limit cleared",
                                                             "- not allowed: DO: clear-hold everything"])

    def test_rerun_ci_reruns_the_failed_jobs_of_the_latest_failed_run_per_workflow_of_a_job_pr(self):
        self.d = self.new()
        self.d.store.put_job("9", "checks", {"issue": 9, "pr": 42, "head": "abcdef1234567890", "checks_since": 1e12})
        self.w.workflows["abcdef1234567890"] = [
            {"id": 11, "workflow_id": 1, "name": "ci", "status": "completed", "conclusion": "failure"},
            {"id": 10, "workflow_id": 1, "name": "ci", "status": "completed", "conclusion": "success"},
            {"id": 9, "workflow_id": 3, "name": "image", "status": "completed", "conclusion": "failure"},
            {"id": 13, "workflow_id": 3, "name": "image", "status": "completed", "conclusion": "success"}]
        self.run_with("DO: rerun-ci #42\nDO: rerun-ci #99\nRESOLVED: CI runs again")
        self.assertEqual(self.w.reruns, [["run", "rerun", "11", "-R", "o/r", "--failed"]])
        self.assertEqual(self.results()[0].split("\n")[1:], ["- DO: rerun-ci #42 -> re-ran the failed jobs of run 11 at abcdef1",
                                                             "- not allowed: DO: rerun-ci #99"])

    def test_wait_off_drops_the_wait_reason_of_a_job(self):
        self.d = self.new()
        self.d.store.put_job("8", "waiting", {"issue": 8, "title": "T8", "wait_reason": "dependency"})
        self.run_with("DO: wait-off #8\nRESOLVED: dropped")
        self.assertNotIn("wait_reason", self.d.store.get_job("8"))
        self.assertIn("- DO: wait-off #8 -> wait reason of #8 dropped", self.results()[0])

    def test_any_other_line_is_refused_and_echoed_without_at_signs_or_backticks(self):
        self.run_with("Look: DO: requeue #7 inside a sentence\nDO: ping @someone `rm -rf /`\nRESOLVED: nothing")
        self.assertEqual(self.results(), ["The dispatcher ran the DO lines of run run1:\n- not allowed: DO: ping someone 'rm -rf /'"])

    def test_do_lines_run_only_from_a_finished_run_the_dispatcher_sent_and_at_most_ten(self):
        self.tick()
        self.w.problems[0]["comments"].append("DO: clear-hold plan limit")
        self.w.finish("h1", "DO: requeue #7\nRESOLVED: x", status="error")
        self.tick()
        self.assertEqual(self.results(), [])
        self.w.finish("h1", "\n".join(["DO: wait-off #%d" % n for n in range(12)] + ["RESOLVED: y"]))
        self.tick()
        lines = self.results()[0].split("\n")
        self.assertEqual(len(lines), 12)
        self.assertEqual(lines[-1], "- 2 more DO lines not run: at most 10 a run")


class Shipped(unittest.TestCase):
    def test_the_shipped_settings_detect_problems_send_none_and_carry_house_with_two_copies(self):
        cfg = D.settings()
        self.assertEqual(cfg["resolver"], {"detect": True, "resolve": False})
        self.assertEqual(cfg["types"]["resolver"], {"coworkers": [{"id": "a7ff1339-e891-4047-aea1-972c5ba2c5c3", "name": "HOUSE", "runs": 2}]})


if __name__ == "__main__":
    unittest.main()
