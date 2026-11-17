import json
import os
import unittest

import planning
import store as S
from test_dispatch import Base, ready, World
from test_planning_result import BODY

ISSUE = {"number": 7, "title": "T", "body": ready(), "comments": [],
         "labels": [{"name": "P0"}], "createdAt": "2026-11-01T00:00:00Z"}
DISPATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")
HAIKU = {"model": "claude-haiku-5-5", "thinkingLevel": "low"}
SONNET = {"model": "claude-sonnet-5-5", "thinkingLevel": "medium"}


def shipped_planning():
    with open(DISPATCH) as f:
        return json.load(f)["planning"]


class ShippedSettings(unittest.TestCase):
    def test_shipped_settings_name_both_readers(self):
        cfg = shipped_planning()
        self.assertEqual(cfg["reader"], HAIKU)
        self.assertEqual(cfg["reader_judgment"], SONNET)

    def test_shipped_settings_keep_the_defaults(self):
        cfg = shipped_planning()
        self.assertIs(cfg.get("auto", True), True)
        self.assertEqual(cfg.get("parallel", planning.PARALLEL), planning.PARALLEL)


class ReaderBrief(unittest.TestCase):
    def test_plan_brief_names_both_reader_models(self):
        text = planning.plan_brief({"number": 7, "title": "T"}, "o/r", reader=shipped_planning())
        for part in ("claude-haiku-5-5", "claude-sonnet-5-5", "`thinkingLevel` `low`", "`thinkingLevel` `medium`",
                     "delegate_tasks", "needs judgment"):
            self.assertIn(part, text)
        self.assertLess(text.index("Reading through readers"), text.index("claude-haiku-5-5"))
        self.assertLess(text.index("claude-sonnet-5-5"), text.index("3. What already exists"))
        self.assertTrue(text.endswith("`PLAN: <one sentence>` or `BLOCKED: <one sentence>`."))

    def test_plan_brief_without_reader_settings_names_no_model(self):
        plain = planning.plan_brief({"number": 7, "title": "T"}, "o/r")
        for reader in (None, {}, {"reader": {}}):
            text = planning.plan_brief({"number": 7, "title": "T"}, "o/r", reader=reader)
            self.assertNotIn("claude-haiku", text)
            self.assertNotIn("2b. Reader models", text)
            self.assertEqual(text, plain)
        self.assertEqual(plain, planning.plan_brief({"number": 7, "title": "T"}, "o/r", reader=None))

    def test_reader_without_judgment_names_one_model(self):
        text = planning.plan_brief({"number": 7, "title": "T"}, "o/r",
                                   reader={"reader": {"model": "m-small", "thinkingLevel": "low"}})
        self.assertIn("m-small", text)
        self.assertNotIn("needs judgment", text)


class TwoStageSend(Base):
    def test_two_stage_send_carries_the_reader_models(self):
        cfg = {"plan_by": ["Boss"], "cut_by": ["Scope Shaper", "IKE"], "reader": HAIKU, "reader_judgment": SONNET}
        self.w = World([dict(ISSUE)])
        self.cfg.update({"types": {"planner": {"coworkers": [
            {"id": "boss", "name": "Boss", "runs": 1},
            {"id": "ss", "name": "Scope Shaper", "runs": 1},
            {"id": "ike", "name": "IKE", "runs": 1}]}}, "planning": cfg})
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

        station = planning.Station(self.cfg, self.store, account, gh, lambda: 1000.0)
        station.once(1)
        sends = [s for s in self.w.sends if s[0] == "boss"]
        self.assertEqual(len(sends), 1)
        self.assertIn("claude-haiku-5-5", sends[0][1])


if __name__ == "__main__":
    unittest.main()
