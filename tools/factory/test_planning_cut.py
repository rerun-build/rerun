import hashlib
import json
import os
import unittest

import planning
import store as S
from test_dispatch import Base, ready, World
from test_planning_result import BODY

PLAN = "## Plan\n\n### Result\nA person sees the queue.\n\n### Slices\n- one slice\n\n### Out of scope\nnone\n\n### Already on dev\ndev 02b0fcf"
ISSUE = {"number": 5, "title": "Fix x", "body": ready(), "comments": [], "labels": [{"name": "P0"}],
         "createdAt": "2026-11-01T00:00:00Z"}
FLOOR = {"number": 612, "title": "Floor: show the queue", "body": "SECRET BODY"}
TWO_STAGE = {"plan_by": ["Boss"], "cut_by": ["Scope Shaper", "IKE"]}
BRIEF_SHA256 = "a19a1d8e08a2f27b03afb2629e6bc051f0901560d6c8048c6068540177dbb995"


def settings(planning_cfg):
    return {"types": {"planner": {"coworkers": [
        {"id": "boss", "name": "Boss", "runs": 1},
        {"id": "ss", "name": "Scope Shaper", "runs": 1},
        {"id": "ike", "name": "IKE", "runs": 1}]}},
        "planning": planning_cfg}


class Cut(Base):
    def build(self, planning_cfg, issues=None):
        self.w = World(issues if issues is not None else [dict(ISSUE, comments=[PLAN])])
        self.cfg.update(settings(planning_cfg))
        self.store = S.Store(self.dir.name + "/plan.db")
        self.goals = []

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

    def seed(self, n, state, agent, run):
        job = "plan:%d" % n
        for k, v in (("state", state), ("agent", agent), ("copy", "1"), ("started", "1970-01-01T00:16:40Z"),
                     ("run", run), ("why", ""), ("title", "Fix x")):
            self.store.set(job, k, v)
        self.w.runs[run] = {"status": "running"}
        self.w.order.append((run, agent))
        self.w.sent_at[run] = 1000.0

    def planned(self, n=5):
        for k, v in (("state", "planned"), ("title", "Fix x"), ("why", "three slices"), ("agent", "boss"),
                     ("copy", "1"), ("run", "p1")):
            self.store.set("plan:%d" % n, k, v)

    def removals(self):
        return [c for c in self.w.gh_calls if c[:2] == ["issue", "edit"] and "--remove-label" in c]

    def test_planned_parent_goes_to_cut_by(self):
        self.build(TWO_STAGE)
        self.planned()
        self.station.once(1)
        self.assertEqual(len(self.w.sends), 1)
        agent, message, _ = self.w.sends[0]
        self.assertEqual(agent, "ss")
        self.assertIn("## Plan", message)
        self.assertIn("BLOCKED: plan:", message)
        self.assertEqual([f["prefix"] for f in self.goals[0]["lastLineForms"]], ["CUT:", "BLOCKED:"])
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["stage"]), ("cutting", "cut"))

    def test_cut_goes_to_ike_when_scope_shaper_is_full(self):
        self.build(TWO_STAGE)
        self.seed(99, "cutting", "ss", "held")
        self.planned()
        self.station.once(1)
        self.assertEqual(self.w.sends[0][0], "ike")

    def test_cut_labels_children(self):
        self.build(TWO_STAGE)
        self.w.issues.append({"number": 601, "title": "c", "body": BODY, "comments": []})
        self.seed(5, "cutting", "ss", "c1")
        self.w.finish("ss", "CUT: #601")
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]), ("cut", "#601"))
        self.assertIn(["issue", "edit", "601", "-R", "o/r", "--add-label", "factory"], self.w.gh_calls)
        self.assertEqual(len(self.removals()), 1)

    def test_blocked_plan_resends_stage_one_once(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.w.finish("ss", "BLOCKED: plan: #5 names a gone file")
        self.station.once(2)
        self.assertEqual((self.store.get_all("plan:5")["state"], self.store.get_all("plan:5")["retried"]), ("replan", "1"))
        self.station.once(3)
        agent, message, _ = self.w.sends[0]
        self.assertEqual(agent, "boss")
        self.assertIn("BLOCKED: plan: #5 names a gone file", message)
        self.assertEqual(self.store.get_all("plan:5")["state"], "planning")
        self.w.finish("boss", "PLAN: again")
        self.station.once(4)
        self.station.once(5)
        self.assertEqual((self.w.sends[1][0], self.store.get_all("plan:5")["state"]), ("ss", "cutting"))
        self.w.finish("ss", "BLOCKED: plan: second")
        self.station.once(6)
        self.assertEqual(self.store.get_all("plan:5")["state"], "blocked")
        self.assertEqual(len(self.w.sends), 2)

    def test_other_blocked_in_cut_stage_finishes(self):
        self.build(TWO_STAGE)
        self.seed(5, "cutting", "ss", "c1")
        self.w.finish("ss", "BLOCKED: the plan has no slices")
        self.station.once(2)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]), ("blocked", "the plan has no slices"))
        self.assertEqual(self.w.sends, [])

    def test_no_plan_comment_blocks(self):
        self.build(TWO_STAGE, [dict(ISSUE, comments=[])])
        self.planned()
        self.station.once(1)
        rec = self.store.get_all("plan:5")
        self.assertEqual((rec["state"], rec["why"]),
                         ("blocked", "the plan run ended PLAN: but the parent has no ## Plan comment"))
        self.assertEqual(self.w.sends, [])

    def test_brief_unchanged(self):
        text = planning.brief(FLOOR, "o/rerun")
        self.assertEqual(hashlib.sha256(text.encode()).hexdigest(), BRIEF_SHA256)

    def test_cut_brief_keeps_child_lines_and_plan(self):
        text = planning.cut_brief(FLOOR, "o/rerun", PLAN)
        for line in planning.brief(FLOOR, "o/rerun").split("\n"):
            self.assertIn(line, text)
        self.assertIn("### Slices", text)
        self.assertIn("BLOCKED: plan:", text)
        self.assertTrue(text.endswith("or `BLOCKED: <one sentence>` when the issue cannot be cut."))

    def test_cut_brief_asks_for_a_proved_child(self):
        text = planning.cut_brief(FLOOR, "o/rerun", PLAN)
        for part in ("check command of every assumption", "risk without an answer", "Write the change that makes it pass",
                     "every file that pins one is in Files", "inside the `**Run**` block", "**Size**"):
            self.assertIn(part, text)

    def test_the_cut_brief_asks_for_one_behaviour_per_bullet(self):
        text = planning.cut_brief(FLOOR, "o/rerun", PLAN)
        self.assertIn("one behaviour per bullet", text)
        self.assertIn("\"the same rule\"", text)

    def test_how_the_builder_starts_is_no_change_bullet(self):
        self.assertIn("how the builder starts (a branch to merge, a command to run, a pull request to open) is no Change bullet", planning.CUT_RULES)

    def test_shipped_settings(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")) as f:
            cfg = json.load(f)
        self.assertEqual(cfg["planning"]["plan_by"], ["Boss"])
        self.assertEqual(cfg["planning"]["cut_by"], ["Scope Shaper", "IKE"])
        names = {c["name"] for c in cfg["types"]["planner"]["coworkers"]}
        self.assertTrue({"Boss", "Scope Shaper", "IKE"} <= names)


    def test_cut_interrupted_mid_write_keeps_previous_planned_record_whole(self):
        self.build(TWO_STAGE)
        self.addCleanup(self.store.close)
        self.planned()
        before = self.store.get_all("plan:5")
        self.store.db.execute(
            "CREATE TEMP TRIGGER kill_cut AFTER UPDATE ON kv "
            "WHEN NEW.job='plan:5' AND NEW.k='run' "
            "BEGIN SELECT RAISE(ABORT, 'killed mid-cut'); END")
        with self.assertRaises(Exception):
            self.station.cut(5, before)
        self.assertEqual(self.store.get_all("plan:5"), before)

if __name__ == "__main__":
    unittest.main()
