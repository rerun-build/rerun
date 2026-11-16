import json
import unittest

import planning
import store as S
from test_dispatch import Base, ready, World
from test_planning_result import BODY

STAMP = "1970-01-01T00:16:40Z"
ISSUE = {"number": 5, "title": "Fix x", "body": ready(), "comments": [],
         "labels": [{"name": "P0"}], "createdAt": "2026-11-01T00:00:00Z"}


def settings(planning_cfg):
    return {"types": {"planner": {"coworkers": [
        {"id": "boss", "name": "Boss", "runs": 1},
        {"id": "ss", "name": "Scope Shaper", "runs": 1},
        {"id": "ike", "name": "IKE", "runs": 1}]}},
        "planning": planning_cfg}


class Stages(Base):
    def build(self, planning_cfg, issues=None):
        self.w = World(issues if issues is not None else [dict(ISSUE)])
        self.cfg.update(settings(planning_cfg))
        self.store = S.Store(self.dir.name + "/plan.db")
        self.goals = []
        self.comments = []
        self.gh_view = None

        def account(tool, args):
            if tool == "send_message":
                self.goals.append(args["goal"])
            return self.w.account(tool, args)

        def gh(args):
            if args[:2] == ["issue", "view"] and "--json" in args and "number" in args[args.index("--json") + 1]:
                return json.dumps({"number": int(args[2]), "title": "c", "body": BODY, "labels": []})
            if args[0] == "api" and "/compare/" in args[1]:
                return json.dumps({"status": "identical", "files": []})
            return self.w.gh(args)

        self.station = planning.Station(self.cfg, self.store, account, gh, lambda: 1000.0)

    def two_stage(self):
        self.build({"plan_by": ["Boss"], "cut_by": ["Scope Shaper", "IKE"]})

    def seed(self, n, state, agent, run):
        job = "plan:%d" % n
        for k, v in (("state", state), ("agent", agent), ("copy", "1"), ("started", STAMP), ("run", run), ("why", "")):
            self.store.set(job, k, v)
        self.w.runs[run] = {"status": "running"}
        self.w.order.append((run, agent))
        self.w.sent_at[run] = 1000.0

    def removals(self):
        return [c for c in self.w.gh_calls if c[:2] == ["issue", "edit"] and "--remove-label" in c]

    def test_plan_stage_goes_to_plan_by_only(self):
        self.two_stage()
        self.station.once(1)
        self.assertEqual(len(self.w.sends), 1)
        agent, message, _ = self.w.sends[0]
        self.assertEqual(agent, "boss")
        self.assertEqual([f["prefix"] for f in self.goals[0]["lastLineForms"]], ["PLAN:", "BLOCKED:"])
        for text in ("## Plan", "### Slices", "### Already on dev"):
            self.assertIn(text, message)
        self.assertIn("Write no child issues", message)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["stage"]), ("planning", "plan"))

    def test_plan_stage_waits_when_boss_is_full(self):
        self.two_stage()
        self.seed(99, "planning", "boss", "held")
        self.station.once(1)
        self.assertEqual(self.w.sends, [])

    def test_plan_line_moves_parent_to_planned(self):
        self.two_stage()
        self.station.once(1)
        self.w.finish("boss", "notes\nPLAN: three slices")
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]), ("planned", "three slices"))
        self.assertEqual(self.removals(), [])
        self.assertEqual([c for c in self.w.gh_calls if c[:2] == ["issue", "create"]], [])

    def test_blocked_in_plan_stage_finishes_as_today(self):
        self.two_stage()
        self.station.once(1)
        self.w.finish("boss", "BLOCKED: no file named")
        self.station.once(2)
        self.assertEqual(self.store.get_all("plan:5")["state"], "blocked")
        self.assertEqual(self.w.issue(5)["comments"], ["The factory planner stopped: no file named"])
        self.assertEqual(len(self.removals()), 1)

    def test_no_last_line_blocks(self):
        self.two_stage()
        self.station.once(1)
        self.w.finish("boss", "all done")
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]), ("blocked", "no PLAN: or BLOCKED: last line"))

    def test_running_record_from_before_is_still_polled(self):
        self.two_stage()
        self.w.issues.append({"number": 601, "title": "c", "body": BODY, "comments": []})
        self.seed(5, "running", "ss", "old")
        self.w.runs["old"] = {"status": "done", "output": "CUT: #601"}
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]), ("cut", "#601"))
        self.assertIn(["issue", "edit", "601", "-R", "o/r", "--add-label", "factory"], self.w.gh_calls)

    def test_no_settings_means_one_stage(self):
        self.build({})
        self.station.once(1)
        self.assertEqual(self.w.sends[0][1], planning.brief(ISSUE, "o/r"))
        self.assertEqual(self.goals[0], {"lastLineForms": planning.GOAL, "turnLimit": 3})
        self.assertEqual(self.store.get_all("plan:5")["state"], "running")

    def test_retry_line_in_brief(self):
        line = "plan: #12 names a file that is gone"
        self.assertIn(line, planning.plan_brief(ISSUE, "o/r", line))
        self.assertNotIn("The cut of your last plan stopped", planning.plan_brief(ISSUE, "o/r"))

    def test_plan_brief_carries_its_points(self):
        text = planning.plan_brief(ISSUE, "o/r")
        for part in ("The whole first", "Search dev for each value", "Reading through readers", "The assumptions",
                     "The risks", "Read your plan as its builder", "Name functions, not line numbers"):
            self.assertIn(part, text)
        self.assertTrue(text.endswith("`PLAN: <one sentence>` or `BLOCKED: <one sentence>`."))


if __name__ == "__main__":
    unittest.main()
