import json, os, sys, unittest, unittest.mock
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
        self.assertTrue(p["body"].startswith("```\nProblem-Key: unreadable #6\n"), p["body"])
        self.assertIn("files: no **Files** heading", p["body"])
        self.assertEqual(self.records()["unreadable #6"]["issue"], p["number"])

    def test_a_job_that_ended_before_the_first_watched_beat_is_no_problem(self):
        self.w.open_numbers |= {5, 8}
        self.d = self.new()
        self.d.store.put_job("8", "blocked", {"issue": 8, "relabelled": True, "commented": True, "reason": "old"}, at="2020-01-01T00:00:00Z")
        self.tick(3)
        self.assertEqual(self.w.problems, [])

    def test_a_repeating_error_ranks_first_among_new_keys(self):
        self.w.issues = [self.bad(n) for n in range(10, 25)]
        self.d = self.new()
        for _ in range(5):
            D.log("-", "reconcile: gh issue view failed")
        self.tick()
        self.assertEqual(len(self.w.problems), 10)
        rep = next(p for p in self.w.problems if p["title"] == "Factory problem: repeating error")
        self.assertIn("reconcile: gh issue view failed (5 times in the last hour)", rep["body"])

    def test_the_system_wide_kinds_wait_under_the_open_cap_too(self):
        self.w.issues = [self.bad(n) for n in range(10, 45)]
        self.tick(3)
        for _ in range(5):
            D.log("-", "reconcile: gh issue view failed")
        self.tick()
        self.assertEqual(len(self.w.problems), 30)
        self.assertNotIn("Factory problem: repeating error", [p["title"] for p in self.w.problems])

    def test_the_idle_line_counts_queued_work_and_carries_the_beat_line_of_its_tenth_beat(self):
        self.w.issues = [{"number": 8, "title": "T8", "body": ready(), "comments": []}]
        self.d = self.new()
        self.d.store.put_job("8", "queued", {"issue": 8, "title": "T8", "body": ready(), "round": 1, "not_before": 1e12})
        self.tick(10)
        idle = next(p for p in self.w.problems if p["title"] == "Factory problem: idle line")
        self.assertIn(" beat 10 | ", idle["body"])

    def test_a_key_that_comes_back_reopens_its_old_issue_with_the_new_evidence(self):
        self.w.issues.append(self.bad(6))
        self.tick()
        broken = self.w.issue(6)["body"]
        self.w.issue(6)["body"] = ready()
        self.tick(3)
        self.assertEqual(self.w.problems[0]["state"], "CLOSED")
        self.w.issue(6)["body"] = broken.replace("**Depends on**: none", "")
        self.tick()
        self.assertEqual(len(self.w.problems), 1)
        self.assertEqual(self.w.problems[0]["state"], "OPEN")
        self.assertIn("dependency line", self.w.problems[0]["body"])
        self.assertIn(["issue", "reopen", str(self.w.problems[0]["number"]), "-R", "o/r"], self.w.gh_calls)

    def test_a_system_wide_kind_closes_only_after_120_beats_gone(self):
        self.tick(10)
        for _ in range(5):
            D.log("-", "reconcile: gh issue view failed")
        self.tick()
        rep = next(p for p in self.w.problems if p["title"] == "Factory problem: repeating error")
        self.w.clock += 3601
        self.tick(119)
        self.assertEqual(rep["state"], "OPEN")
        self.tick()
        self.assertEqual(rep["state"], "CLOSED")

    def test_a_system_wide_kind_is_not_closed_in_the_first_ten_beats_after_a_start(self):
        self.d = self.new()
        for _ in range(5):
            D.log("-", "reconcile: gh issue view failed")
        self.tick()
        rep = next(p for p in self.w.problems if p["title"] == "Factory problem: repeating error")
        r = self.records()["repeating error"]
        r["absent"] = 119
        self.d.store.set("problems", "repeating error", json.dumps(r))
        self.tick(fresh=True)
        self.tick(9)
        self.assertEqual(rep["state"], "OPEN")
        self.tick()
        self.assertEqual(rep["state"], "CLOSED")

    def test_the_first_gh_error_in_the_tickets_pass_stops_it_for_this_beat(self):
        self.w.issues += [self.bad(n) for n in (6, 7, 8)]
        orig, fails = self.w.gh, [1]

        def gh(args):
            if args[:2] == ["issue", "create"] and fails:
                fails.pop()
                raise D.Error("gh issue create failed: exit 1")
            return orig(args)
        self.w.gh = gh
        self.tick()
        self.assertEqual(self.w.problems, [])
        self.assertIn("problems: gh issue create failed: exit 1", self.out.getvalue())
        self.tick()
        self.assertEqual(len(self.w.problems), 3)

    def test_an_open_issue_with_the_same_problem_key_is_adopted_and_not_opened_twice(self):
        self.w.problems.append({"number": 950, "title": "Factory problem: unreadable #6", "body": "```\nProblem-Key: unreadable #6\n```",
                                "comments": [], "labels": ["factory-problem"], "state": "OPEN"})
        self.w.issues.append(self.bad(6))
        self.tick(2)
        self.assertEqual(len(self.w.problems), 1)
        self.assertEqual(self.records()["unreadable #6"]["issue"], 950)
        self.assertIn("files: no **Files** heading", self.w.problems[0]["body"])

    def test_a_deleted_problem_issue_is_forgotten_and_the_keys_after_it_still_move(self):
        self.w.issues += [self.bad(6), self.bad(7)]
        self.tick()
        six, seven = (next(p for p in self.w.problems if p["title"] == "Factory problem: unreadable #%d" % n) for n in (6, 7))
        self.w.delete(six["number"])
        for n in (6, 7):
            self.w.issue(n)["body"] = self.w.issue(n)["body"].replace("**Depends on**: none", "")
        self.w.issues.append(self.bad(8))
        self.tick()
        self.assertIn("dependency line", seven["body"])
        self.assertIn("Factory problem: unreadable #8", [p["title"] for p in self.w.problems])
        self.assertNotEqual(self.records()["unreadable #6"]["issue"], six["number"])
        self.tick()
        self.assertEqual(len([p for p in self.w.problems if p["title"] == "Factory problem: unreadable #6"]), 1)
        self.assertIn("its issue is gone, forgotten", self.out.getvalue())

    def test_a_reopened_problem_starts_without_its_old_line_or_transient_count(self):
        self.w.issues.append(self.bad(6))
        self.tick()
        r = self.records()["unreadable #6"]
        r.update(state="closed", transient=3, line="RESOLVED: old", filed=77)
        self.d.store.set("problems", "unreadable #6", json.dumps(r))
        self.tick()
        r = self.records()["unreadable #6"]
        self.assertEqual((r["state"], r["transient"], r["line"], r["filed"]), ("resolve_wait", 0, None, None))

    def test_an_ending_records_when_the_job_ended(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: the issue cannot be done as written")
        self.tick()
        self.assertTrue(self.d.store.get_job("5").get("ended_at"))

    def test_a_resolver_that_raises_leaves_the_rest_of_the_beat_running(self):
        def boom(*a):
            raise TypeError("x")
        with unittest.mock.patch.object(D.resolver.Resolver, "beat", boom):
            self.tick()
        self.assertEqual(self.w.sends[0][0], "b1")
        self.assertIn("problems: TypeError", self.out.getvalue())

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
        self.assertEqual(p["comments"], ["```\nESCALATE: the problem is still there after 2 attempts; the last one ended with: RESOLVED: second try\n```"])
        self.tick(3)
        self.assertEqual(len(self.house()), 2)

    def test_escalate_labels_the_owner_and_stops_until_rob_removes_the_label(self):
        self.tick(2)
        self.w.finish("h1", "ESCALATE: Rob runs `gh label create x`")
        self.tick(3)
        p = self.w.problems[0]
        self.assertEqual(p["labels"], ["factory-problem", "owner"])
        self.assertEqual(p["comments"], ["```\nESCALATE: Rob runs `gh label create x`\n```"])
        self.assertEqual(len(self.house()), 1)
        line = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        self.assertTrue(line.endswith(" | problems 1 open, 1 owner"), line)
        self.w.unlabel(p["number"], "owner", "special-place-administrator")
        self.tick()
        self.assertEqual(len(self.house()), 2)
        self.assertEqual(self.rec()["state"], "resolving")

    def test_an_owner_label_removed_by_anyone_but_rob_is_put_back_and_nothing_is_sent(self):
        self.tick(2)
        self.w.finish("h1", "ESCALATE: Rob decides")
        self.tick()
        p = self.w.problems[0]
        self.w.unlabel(p["number"], "owner", "house-bot")
        self.tick(2)
        self.assertIn("owner", p["labels"])
        self.assertEqual(len(self.house()), 1)

    def test_a_problem_sent_six_times_goes_to_the_owner_instead_of_a_seventh_send(self):
        self.d = self.new()
        D.holds.arm(self.d.store, "plan limit", self.w.clock + 600)
        self.tick()
        r = self.rec()
        r["sends"] = 6
        self.d.store.set("problems", "unreadable #6", json.dumps(r))
        D.holds.clear(self.d.store, "plan limit")
        self.tick()
        self.assertEqual(self.house(), [])
        self.assertIn("owner", self.w.problems[0]["labels"])
        self.assertIn("sent to HOUSE 6 times", self.w.problems[0]["comments"][0])

    def test_robs_newest_removal_counts_on_an_issue_with_a_long_history(self):
        self.tick(2)
        self.w.finish("h1", "ESCALATE: Rob decides")
        self.tick()
        p = self.w.problems[0]
        p["events"] = [{"label": {"name": "owner"}, "actor": {"login": "house-bot"}}] * 150
        self.w.unlabel(p["number"], "owner", "special-place-administrator")
        self.tick()
        self.assertEqual(len(self.house()), 2)

    def test_a_send_logged_without_a_run_id_does_not_raise(self):
        orig = self.w.account
        self.w.account = lambda tool, args: (orig(tool, args) and {"status": "running"}) if tool == "send_message" and args["agentId"] == "h1" else orig(tool, args)
        self.tick()
        self.assertNotIn("problems: KeyError", self.out.getvalue())
        self.assertIn("(run None)", self.out.getvalue())

    def test_the_brief_keeps_house_off_the_labels_the_dispatcher_reads(self):
        self.tick()
        self.assertIn("Never add or remove the labels `factory-problem`, `owner`, `factory` or `factory-blocked`", self.house()[0])

    def test_a_send_answered_without_a_run_id_is_not_sent_again_every_beat(self):
        orig = self.w.account
        self.w.account = lambda tool, args: (orig(tool, args) and {}) if tool == "send_message" and args["agentId"] == "h1" else orig(tool, args)
        self.tick(3)
        self.assertEqual(len(self.house()), 1)
        self.assertEqual((self.rec()["state"], self.rec()["run"]), ("resolving", None))

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

    def test_filed_holds_the_verify_clock_while_the_filed_issue_is_open(self):
        self.tick(2)
        self.w.finish("h1", "FILED: #77")
        self.w.open_numbers |= {77}
        self.tick(10)
        self.assertEqual(len(self.house()), 1)
        self.w.open_numbers -= {77}
        self.tick(6)
        self.assertEqual(len(self.house()), 2)

    def test_a_failed_owner_label_is_tried_again_and_never_reads_as_rob_removing_it(self):
        orig, fails = self.w.gh, [1]

        def gh(args):
            if "--add-label" in args and "owner" in args and fails:
                fails.pop()
                raise D.Error("gh issue edit failed: exit 1")
            return orig(args)
        self.w.gh = gh
        self.tick(2)
        self.w.finish("h1", "ESCALATE: Rob decides")
        self.tick(4)
        p = self.w.problems[0]
        self.assertEqual(p["labels"], ["factory-problem", "owner"])
        self.assertEqual(p["comments"], ["```\nESCALATE: Rob decides\n```"])
        self.assertEqual(len(self.house()), 1)

    def test_a_send_that_raised_keeps_the_copy_until_the_run_limit_then_sends_again(self):
        self.cfg["clocks"] = {"run_limit_s": 100}
        self.w.cut_off_next_send = True
        self.tick(3)
        self.assertEqual(len(self.house()), 1)
        self.assertEqual((self.rec()["state"], self.rec()["run"]), ("resolving", None))
        self.w.clock += 101
        self.tick()
        self.assertEqual(len(self.house()), 2)

    def test_a_waiting_problem_whose_key_is_gone_is_not_sent(self):
        self.d = self.new()
        D.holds.arm(self.d.store, "plan limit", self.w.clock + 600)
        self.tick()
        self.w.issue(6)["body"] = ready()
        D.holds.clear(self.d.store, "plan limit")
        self.tick(2)
        self.assertEqual(self.house(), [])

    def test_a_plan_limit_error_arms_the_hold_and_is_not_a_missing_line(self):
        self.tick(2)
        self.w.runs["run1"] = {"status": "error", "error": "AI_APICallError: You've hit your session limit · resets 3pm"}
        self.tick()
        self.assertEqual(D.holds.active(self.d.store, self.w.clock)["kind"], "plan limit")
        self.assertEqual(self.rec()["state"], "resolve_wait")
        self.assertFalse(self.rec().get("asked"))

    def test_a_transient_error_is_sent_again_without_counting_as_a_missing_line(self):
        self.tick(2)
        self.w.runs["run1"] = {"status": "error", "error": "provider_overloaded"}
        self.tick()
        self.assertEqual(len(self.house()), 2)
        self.assertNotIn("ended without a final line", self.house()[1])

    def test_a_get_run_that_keeps_failing_is_given_up_after_the_run_limit(self):
        self.cfg["clocks"] = {"run_limit_s": 100}
        orig = self.w.account

        def account(tool, args):
            if tool == "get_run" and args["agentId"] == "h1":
                raise D.Error("account get_run failed: HTTP 404")
            return orig(tool, args)
        self.w.account = account
        self.tick(3)
        self.assertEqual(len(self.house()), 1)
        self.w.clock += 101
        self.tick()
        self.assertEqual(len(self.house()), 2)

    def test_switching_resolve_off_frees_house_and_lets_a_resolving_problem_close(self):
        self.tick()
        self.assertEqual(self.d.running(), [("h1", 1)])
        self.cfg["resolver"]["resolve"] = False
        self.assertEqual(self.d.running(), [])
        self.w.issue(6)["body"] = ready()
        self.tick(3)
        self.assertEqual(self.w.problems[0]["state"], "CLOSED")

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
        self.d.store.put_job("9", "checks", {"issue": 9, "pr": 42, "head": "abcdef1234567890", "checks_since": 1e12, "checks_rerun": "abcdef1234567890"})
        self.w.workflows["abcdef1234567890"] = [
            {"id": 11, "workflow_id": 1, "name": "ci", "status": "completed", "conclusion": "failure"},
            {"id": 10, "workflow_id": 1, "name": "ci", "status": "completed", "conclusion": "success"},
            {"id": 9, "workflow_id": 3, "name": "image", "status": "completed", "conclusion": "failure"},
            {"id": 13, "workflow_id": 3, "name": "image", "status": "completed", "conclusion": "success"}]
        self.run_with("DO: rerun-ci #42\nDO: rerun-ci #99\nRESOLVED: CI runs again")
        self.assertEqual(self.w.reruns, [["run", "rerun", "11", "-R", "o/r", "--failed"]])
        self.assertEqual(self.results()[0].split("\n")[1:], ["- DO: rerun-ci #42 -> re-ran the failed jobs of run 11 at abcdef1",
                                                             "- not allowed: DO: rerun-ci #99"])

    def test_requeue_refuses_a_job_already_taken_three_times(self):
        self.d = self.new()
        self.d.store.put_job("7", "blocked", {"issue": 7, "title": "T7", "relabelled": True, "commented": True, "take": 3})
        self.run_with("DO: requeue #7\nRESOLVED: no")
        self.assertNotIn(["issue", "edit", "7", "-R", "o/r", "--add-label", "factory", "--remove-label", "factory-blocked"], self.w.gh_calls)
        self.assertIn("- not allowed: DO: requeue #7 (taken 3 times; Rob decides)", self.results()[0])

    def test_wait_off_drops_a_stale_back_off_so_the_job_starts_on_the_next_beat(self):
        self.d = self.new()
        self.d.store.put_job("8", "queued", {"issue": 8, "title": "T8", "body": ready(), "round": 1, "worker": "coder",
                                             "not_before": self.w.clock + 3600, "wait_reason": "back-off"})
        self.run_with("DO: wait-off #8\nRESOLVED: dropped")
        self.assertIn("- DO: wait-off #8 -> back-off and wait reason of #8 dropped", self.results()[0])
        self.assertEqual([a for a, _, _ in self.w.sends if a == "b1"], [])
        self.tick()
        self.assertEqual(self.state(8), "building")

    def test_any_other_line_is_refused_and_echoed_without_at_signs_or_backticks(self):
        self.run_with("Look: DO: requeue #7 inside a sentence\nDO: ping @someone `rm -rf /`\nRESOLVED: nothing")
        self.assertEqual(self.results(), ["The dispatcher ran the DO lines of run run1:\n- not allowed: DO: ping someone 'rm -rf /'"])

    def test_a_repeated_do_line_runs_once_and_one_inside_a_code_block_not_at_all(self):
        self.d = self.new()
        self.d.store.put_job("8", "waiting", {"issue": 8, "title": "T8", "wait_reason": "dependency"})
        self.run_with("DO: wait-off #8\nDO: wait-off #8\n```\nDO: clear-hold plan limit\n```\nRESOLVED: x")
        self.assertEqual(self.results(), ["The dispatcher ran the DO lines of run run1:\n- DO: wait-off #8 -> back-off and wait reason of #8 dropped"])

    def test_a_code_block_that_is_never_closed_hides_every_do_line_after_it(self):
        self.d = self.new()
        self.d.store.put_job("8", "waiting", {"issue": 8, "title": "T8", "wait_reason": "dependency"})
        self.run_with("```\nDO: wait-off #8\nRESOLVED: x")
        self.assertEqual(self.results(), [])

    def test_do_lines_run_only_from_a_finished_run_the_dispatcher_sent_and_at_most_four(self):
        self.tick()
        self.w.problems[0]["comments"].append("DO: clear-hold plan limit")
        self.w.finish("h1", "DO: requeue #7\nRESOLVED: x", status="error")
        self.tick()
        self.assertEqual(self.results(), [])
        self.w.finish("h1", "\n".join(["DO: wait-off #%d" % n for n in range(12)] + ["RESOLVED: y"]))
        self.tick()
        lines = self.results()[0].split("\n")
        self.assertEqual(len(lines), 6)
        self.assertEqual(lines[-1], "- 8 more DO lines not run: at most 4 a run")


class TakeCap(Base):
    def test_intake_ends_a_relabelled_job_taken_a_fourth_time_unsolvable_and_says_so_once(self):
        self.w.issues.append({"number": 7, "title": "T7", "body": ready(), "comments": []})
        self.d = self.new()
        self.d.store.put_job("7", "blocked", {"issue": 7, "title": "T7", "body": ready(), "relabelled": True, "commented": True, "take": 3})
        self.tick(3)
        self.assertEqual(self.state(7), "unsolvable")
        self.assertEqual(len(self.w.issue(7)["comments"]), 1)
        self.assertIn("taken 3 times with this text", self.w.issue(7)["comments"][0])
        self.assertIn("It is not sent again unless the issue text changes", self.w.issue(7)["comments"][0])

    def test_a_changed_issue_text_resets_the_take_count(self):
        self.w.issues.append({"number": 7, "title": "T7", "body": ready("new plan"), "comments": []})
        self.d = self.new()
        self.d.store.put_job("7", "blocked", {"issue": 7, "title": "T7", "body": ready(), "relabelled": True, "commented": True, "take": 3})
        self.tick()
        self.assertNotEqual(self.state(7), "blocked")
        self.assertEqual(self.d.store.get_job("7")["takes"], 1)


class Shipped(unittest.TestCase):
    def test_the_shipped_settings_detect_and_resolve_problems_with_house_and_two_copies(self):
        cfg = D.settings()
        self.assertEqual(cfg["resolver"], {"detect": True, "resolve": True})
        self.assertEqual(cfg["types"]["resolver"], {"coworkers": [{"id": "a7ff1339-e891-4047-aea1-972c5ba2c5c3", "name": "HOUSE", "runs": 2}]})


if __name__ == "__main__":
    unittest.main()
