import json
import unittest

import planning
import store as S
from test_dispatch import Base, ready, World
from test_planning_result import BODY

PLAN = "## Plan\n\n### Result\nA person sees the queue on the floor.\n\n### Slices\n- one slice\n\n### Out of scope\nnone\n\n### Already on dev\ndev 02b0fcf"
PLAN2 = PLAN.replace("- one slice", "- one slice, and the floor says when the queue is empty")
ISSUE = {"number": 5, "title": "Fix x", "body": ready(), "comments": [PLAN], "labels": [{"name": "P0"}], "createdAt": "2026-11-01T00:00:00Z"}
CHANGE = """NOTE 1 CHANGE major
QUOTE: A person sees the queue on the floor.
PROBLEM: the floor shows nothing for an empty queue
EVIDENCE: apps/ui/floor.tsx: Floor returns null for []
FIX: say what the floor shows when the queue is empty
REVIEW: 1 notes"""
OWNER = """NOTE 1 OWNER major
QUOTE: A person sees the queue on the floor.
PROBLEM: whether members other than Rob see the queue is not settled
OPTION: only Rob: the issue names him
OPTION: every member of the workspace
CATEGORY: product
REVIEW: 1 notes"""


def settings(review, extra=None):
    cfg = {"plan_by": ["Boss"], "cut_by": ["Scope Shaper", "IKE"], "review": review}
    cfg.update(extra or {})
    return {"types": {
        "planner": {"coworkers": [{"id": "boss", "name": "Boss", "runs": 1}, {"id": "ss", "name": "Scope Shaper", "runs": 1},
                                  {"id": "ike", "name": "IKE", "runs": 1}]},
        "acceptor": {"coworkers": [{"id": "barbara", "name": "BARBARA", "runs": 1}]}},
        "planning": cfg}


class Station(Base):
    def build(self, review=None, extra=None, issues=None):
        self.w = World(issues if issues is not None else [dict(ISSUE, comments=[PLAN])])
        self.cfg.update(settings(review if review is not None else {"by": ["BARBARA"], "type": "acceptor", "mode": "on", "revisions": 1}, extra))
        self.store = S.Store(self.dir.name + "/plan.db")
        self.goals, self.created, self.questions, self.child_body = [], [], {}, BODY
        self.beat = 1

        def account(tool, args):
            if tool == "send_message":
                self.goals.append(args["goal"])
            return self.w.account(tool, args)

        def gh(args):
            if args[:2] == ["issue", "create"]:
                n = 900 + len(self.created)
                self.created.append(args)
                self.questions[n] = {"state": "OPEN", "comments": []}
                return "https://github.com/o/r/issues/%d\n" % n
            if args[:2] == ["issue", "view"] and int(args[2]) in self.questions:
                q = self.questions[int(args[2])]
                return json.dumps({"state": q["state"], "comments": [{"body": c, "author": {"login": "special-place-administrator"}} for c in q["comments"]]})
            if args[:2] == ["issue", "view"] and "--json" in args and "number" in args[args.index("--json") + 1]:
                return json.dumps({"number": int(args[2]), "title": "c", "body": self.child_body, "labels": []})
            if args[0] == "api" and "/compare/" in args[1]:
                return json.dumps({"status": "identical", "files": []})
            if args[0] == "api" and args[1].endswith("/commits/dev"):
                return "89abcdef" * 5
            return self.w.gh(args)

        self.station = planning.Station(self.cfg, self.store, account, gh, lambda: 1000.0)

    def once(self):
        self.station.once(self.beat)
        self.beat += 1

    def planned(self, n=5):
        for k, v in (("state", "planned"), ("title", "Fix x"), ("why", "three slices"), ("agent", "boss"), ("copy", "1"), ("run", "p1")):
            self.store.set("plan:%d" % n, k, v)

    def rec(self, n=5):
        return self.store.get_all("plan:%d" % n)

    def last(self, agent):
        return [m for a, m, _ in self.w.sends if a == agent][-1]


class Review(Station):
    def test_a_planned_plan_goes_to_the_critic_before_the_cut(self):
        self.build()
        self.planned()
        self.once()
        self.assertEqual(self.w.sends[-1][0], "barbara")
        self.assertEqual(self.goals[-1]["lastLineForms"], planning.REVIEW_GOAL)
        message = self.last("barbara")
        for part in ("round 1", "You did not write this plan", "A person sees the queue on the floor.", "QUOTE:", "REVIEW: <number> notes"):
            self.assertIn(part, message)
        self.assertEqual(self.rec()["state"], "reviewing")

    def test_a_major_note_goes_back_to_boss_as_overseer_then_round_two_reads_the_diff(self):
        self.build()
        self.planned()
        self.once()
        self.w.finish("barbara", CHANGE)
        self.once()
        self.assertTrue(self.w.issue(5)["comments"][-1].startswith("## Review of the plan, round 1"))
        self.assertEqual(self.rec()["state"], "revise")
        self.once()
        brief = self.last("boss")
        for part in ("You are the overseer for each DECIDE note", "council skill", "say what the floor shows when the queue is empty"):
            self.assertIn(part, brief)
        self.w.issue(5)["comments"].append(PLAN2)
        self.w.finish("boss", "PLAN: empty queue said")
        self.once()
        self.once()
        second = self.last("barbara")
        self.assertIn("round 2", second)
        self.assertIn("You reviewed an earlier version", second)
        self.assertIn("+- one slice, and the floor says when the queue is empty", second)
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.once()
        self.assertEqual(self.w.sends[-1][0], "ss")
        self.assertIn(PLAN2, self.last("ss"))
        self.assertEqual(self.rec()["state"], "cutting")

    def test_after_the_last_revision_the_open_notes_ride_into_the_cut(self):
        self.build(review={"by": ["BARBARA"], "type": "acceptor", "mode": "on", "revisions": 0})
        self.planned()
        self.once()
        self.w.finish("barbara", CHANGE)
        self.once()
        self.once()
        cut = self.last("ss")
        self.assertIn("The review of this plan left these points open", cut)
        self.assertIn("say what the floor shows when the queue is empty", cut)

    def test_dry_run_comments_and_cuts_the_plan_unchanged(self):
        self.build(review={"by": ["BARBARA"], "type": "acceptor", "mode": "dry"})
        self.planned()
        self.once()
        self.w.finish("barbara", CHANGE)
        self.once()
        self.assertIn("dry run", self.w.issue(5)["comments"][-1])
        self.once()
        self.assertEqual(self.w.sends[-1][0], "ss")
        self.assertNotIn("left these points open", self.last("ss"))
        self.assertEqual(json.loads(self.rec()["review_log"])[0]["heavy"], 1)

    def test_no_critic_in_the_pool_cuts_at_once(self):
        self.build(review={"by": ["NOBODY"], "type": "acceptor", "mode": "on"})
        self.planned()
        self.once()
        self.assertEqual(self.w.sends[-1][0], "ss")
        self.assertEqual(self.w.issue(5)["comments"], [PLAN])

    def test_a_review_that_cannot_run_twice_lets_the_plan_through(self):
        self.build()
        self.planned()
        self.once()
        self.store.set("plan:5", "resent", '["review"]')
        self.w.finish("barbara", "", status="error")
        self.once()
        self.assertEqual((self.rec()["state"], self.rec()["review_fails"]), ("planned", "1"))
        self.once()
        self.assertEqual(self.w.sends[-1][0], "barbara")
        self.w.finish("barbara", "", status="error")
        self.once()
        self.assertIn("could not run", self.w.issue(5)["comments"][-1])
        self.once()
        self.assertEqual(self.w.sends[-1][0], "ss")

    def test_a_review_that_cannot_be_sent_lets_the_plan_through_after_two_tries(self):
        self.build()
        self.planned()
        self.w.invalid_goal = True
        self.once()
        self.assertEqual((self.rec()["state"], self.rec()["review_fails"]), ("planned", "1"))
        self.once()
        self.assertIn("could not run", self.w.issue(5)["comments"][-1])
        self.w.invalid_goal = False
        self.once()
        self.assertEqual(self.w.sends[-1][0], "ss")

    def test_a_critic_that_ends_blocked_lets_the_plan_through(self):
        self.build()
        self.planned()
        self.once()
        self.w.finish("barbara", "BLOCKED: no checkout")
        self.once()
        self.assertIn("stopped (no checkout)", self.w.issue(5)["comments"][-1])
        self.once()
        self.assertEqual(self.w.sends[-1][0], "ss")


class Ask(Station):
    def test_an_owner_choice_files_one_question_for_the_foreman_and_parks_only_this_plan(self):
        self.build()
        self.planned()
        self.once()
        self.w.finish("barbara", OWNER)
        self.once()
        self.assertEqual(self.rec()["state"], "asked")
        args = self.created[0]
        body = args[args.index("--body") + 1]
        self.assertEqual(args[args.index("--label") + 1], planning.QUESTION_LABEL)
        for part in ("**Question for**: #5", "**Category**: product", "1. only Rob: the issue names him (recommended)", "ANSWER: <option number>"):
            self.assertIn(part, body)
        self.assertIn("#900", self.w.issue(5)["comments"][-1])
        for _ in range(6):
            self.once()
        self.assertEqual(self.rec()["state"], "asked")
        self.assertEqual(len(self.created), 1)

    def test_the_answer_goes_to_boss_as_a_binding_decision(self):
        self.build()
        self.planned()
        self.once()
        self.w.finish("barbara", OWNER)
        self.once()
        self.questions[900] = {"state": "CLOSED", "comments": ["thinking", "ANSWER: 2"]}
        for _ in range(planning.EVERY):
            if self.rec()["state"] != "asked":
                break
            self.once()
        self.assertEqual(self.rec()["state"], "revise")
        self.once()
        brief = self.last("boss")
        self.assertIn("The questions put to Rob through the Foreman came back", brief)
        self.assertIn("#900: option 2, every member of the workspace", brief)

    def test_own_words_and_no_answer_are_both_read(self):
        q = {"issue": 7, "options": ["a", "b"]}
        self.assertEqual(planning.answer_of(q, {"comments": [{"body": "ANSWER: only on weekdays", "author": {"login": "special-place-administrator"}}]}), "#7: in his own words, only on weekdays")
        self.assertIn("it is not his decision", planning.answer_of(q, {"comments": []}))

class Repair(Station):
    BAD = BODY.replace("true", "python3 -m pytest tools/factory/test_x.py")

    def cutting(self):
        for k, v in (("state", "cutting"), ("agent", "ss"), ("copy", "1"), ("started", "1970-01-01T00:16:40Z"), ("run", "c1"),
                     ("why", ""), ("title", "Fix x"), ("cut_text", PLAN)):
            self.store.set("plan:5", k, v)
        self.w.runs["c1"] = {"status": "done", "output": "CUT: #601"}
        self.w.order.append(("c1", "ss"))
        self.w.sent_at["c1"] = 1000.0

    def test_a_refused_child_is_repaired_then_labelled(self):
        self.build(review={}, extra={"repair": {"tries": 2}}, issues=[dict(ISSUE), {"number": 601, "title": "c", "body": self.BAD, "comments": []}])
        self.child_body = self.BAD
        self.cutting()
        self.once()
        self.assertEqual(self.rec()["state"], "repair")
        self.assertEqual(self.w.issue(601)["comments"], [])
        self.once()
        self.assertEqual(self.goals[-1]["lastLineForms"], planning.REPAIR_GOAL)
        self.assertIn("no pytest", self.w.sends[-1][1])
        self.assertIn("issuecheck.py", self.w.sends[-1][1])
        self.child_body = BODY
        self.w.finish(self.w.sends[-1][0], "FIXED: #601")
        self.once()
        self.assertIn(["issue", "edit", "601", "-R", "o/r", "--add-label", "factory"], self.w.gh_calls)
        self.assertEqual((self.rec()["state"], self.rec()["why"]), ("cut", "#601"))

    def test_when_the_tries_are_used_the_child_gets_the_comment_of_today(self):
        self.build(review={}, extra={"repair": {"tries": 1}}, issues=[dict(ISSUE), {"number": 601, "title": "c", "body": self.BAD, "comments": []}])
        self.child_body = self.BAD
        self.cutting()
        self.once()
        self.once()
        self.w.finish(self.w.sends[-1][0], "FIXED: #601")
        self.once()
        self.assertIn("no pytest", self.w.issue(601)["comments"][-1])
        self.assertEqual(self.rec()["state"], "cut")

    def test_without_repair_settings_the_comment_is_posted_at_once(self):
        self.build(review={}, issues=[dict(ISSUE), {"number": 601, "title": "c", "body": self.BAD, "comments": []}])
        self.child_body = self.BAD
        self.cutting()
        self.once()
        self.assertEqual(self.rec()["state"], "cut")
        self.assertIn("no pytest", self.w.issue(601)["comments"][-1])


class CutNotes(Station):
    def test_a_cut_stopped_on_the_plan_hands_its_notes_to_the_re_plan(self):
        self.build(review={})
        for k, v in (("state", "cutting"), ("agent", "ss"), ("copy", "1"), ("started", "1970-01-01T00:16:40Z"), ("run", "c1"),
                     ("why", ""), ("title", "Fix x"), ("cut_text", PLAN)):
            self.store.set("plan:5", k, v)
        self.w.runs["c1"] = {"status": "done", "output": CHANGE.replace("REVIEW: 1 notes", "BLOCKED: plan: the empty queue is not planned")}
        self.w.order.append(("c1", "ss"))
        self.once()
        self.assertEqual(self.rec()["state"], "replan")
        self.once()
        brief = self.last("boss")
        self.assertIn("The cut of your last plan stopped: BLOCKED: plan: the empty queue is not planned", brief)
        self.assertIn("The cutter's notes on it", brief)
        self.assertIn("say what the floor shows when the queue is empty", brief)


class Recheck(Station):
    def waiting(self):
        job = {"issue": 7, "title": "Child", "body": "PLAN READY (cut of #5; facts read on dev at 1234567)", "state": "waiting",
               "round": 1, "worker": "coder", "paths": ["a/b.py"], "test": "a/test_b.py", "plan_dev": "1234567", "rechecks": 1,
               "recheck": {"why": ["a/b.py changed on dev where it names do_it"], "from": "1234567"}}
        self.store.put_job("7", "waiting", job)

    def test_a_job_waiting_for_a_recheck_gets_one_and_its_answer_is_kept(self):
        self.build(review={}, extra={"recheck": {"tries": 2}}, issues=[])
        self.waiting()
        self.once()
        agent, message, _ = self.w.sends[-1]
        self.assertIn(agent, ("ss", "ike"))
        self.assertEqual(self.goals[-1]["lastLineForms"], planning.RECHECK_GOAL)
        for part in ("read on dev 1234567", "a/b.py changed on dev where it names do_it", "FRESH: dev 89abcde", "issuecheck.py"):
            self.assertIn(part, message)
        self.once()
        self.assertEqual(len(self.w.sends), 1)
        self.w.finish(agent, "FRESH: dev 89abcde")
        self.once()
        row = self.store.get_all("recheck:7")
        self.assertEqual((row["state"], row["attempt"], row["why"]), ("fresh", "1", "dev 89abcde"))
        self.once()
        self.assertEqual(len(self.w.sends), 1)

    def test_a_recheck_run_that_fails_lets_the_job_build(self):
        self.build(review={}, extra={"recheck": {"tries": 2}}, issues=[])
        self.waiting()
        self.once()
        self.w.finish(self.w.sends[-1][0], "", status="error")
        self.once()
        self.assertEqual(self.store.get_all("recheck:7")["state"], "fresh")

    def test_a_blocked_recheck_that_is_not_about_the_plan_lets_the_job_build(self):
        self.build(review={}, extra={"recheck": {"tries": 2}}, issues=[])
        self.waiting()
        self.once()
        self.w.finish(self.w.sends[-1][0], "BLOCKED: no dev checkout")
        self.once()
        self.assertEqual(self.store.get_all("recheck:7")["state"], "fresh")

    def test_a_blocked_recheck_about_the_plan_is_kept(self):
        self.build(review={}, extra={"recheck": {"tries": 2}}, issues=[])
        self.waiting()
        self.once()
        self.w.finish(self.w.sends[-1][0], "BLOCKED: plan: dev already does it")
        self.once()
        row = self.store.get_all("recheck:7")
        self.assertEqual((row["state"], row["why"]), ("blocked", "plan: dev already does it"))

    def test_without_recheck_settings_nothing_is_sent(self):
        self.build(review={}, issues=[])
        self.waiting()
        self.once()
        self.assertEqual(self.w.sends, [])


if __name__ == "__main__":
    unittest.main()
