import json
import os
import unittest

import planning
import store as S
from test_dispatch import Base, World, ready
from test_planning_result import BODY

HERE = os.path.dirname(os.path.abspath(__file__))
OPUS_MEDIUM = {"model": "claude-opus-5-5", "thinkingLevel": "medium"}
PLAN = "## Plan\n\n### Result\nA person sees the queue.\n\n### Slices\n- one slice\n\n### Out of scope\nnone\n\n### Already on dev\ndev 02b0fcf"
TWO_STAGE = {"plan_by": ["Boss"], "cut_by": ["Scope Shaper", "IKE"]}
ISSUE = {"number": 5, "title": "Fix x", "body": ready(), "comments": [], "labels": [{"name": "P0"}],
         "createdAt": "2026-11-01T00:00:00Z"}


def settings(planning_cfg):
    return {"types": {"planner": {"coworkers": [
        {"id": "boss", "name": "Boss", "runs": 1},
        {"id": "ss", "name": "Scope Shaper", "runs": 1},
        {"id": "ike", "name": "IKE", "runs": 1}]}},
        "planning": planning_cfg}


def shipped():
    with open(os.path.join(HERE, "dispatch.json")) as f:
        return json.load(f)


class CutTier(Base):
    def build(self, planning_cfg, issues=None, tiers=None):
        self.w = World(issues if issues is not None else [dict(ISSUE, comments=[PLAN])])
        self.cfg.update(settings(planning_cfg))
        if tiers is not None:
            self.cfg.update(tiers)
        self.store = S.Store(self.dir.name + "/plan.db")
        self.calls = []

        def account(tool, args):
            if tool == "send_message":
                self.calls.append(dict(args))
            return self.w.account(tool, args)

        def gh(args):
            if args[:2] == ["issue", "view"] and "--json" in args and "number" in args[args.index("--json") + 1]:
                return json.dumps({"number": int(args[2]), "title": "c", "body": BODY, "labels": []})
            if args[0] == "api" and "/compare/" in args[1]:
                return json.dumps({"status": "identical", "files": []})
            return self.w.gh(args)

        self.station = planning.Station(self.cfg, self.store, account, gh, lambda: 1000.0)

    def planned(self, n=5):
        for k, v in (("state", "planned"), ("title", "Fix x"), ("why", "three slices"), ("agent", "boss"),
                     ("copy", "1"), ("run", "p1")):
            self.store.set("plan:%d" % n, k, v)

    def sent_to(self, name):
        return [c for c in self.calls if c["agentId"] == name]

    def test_cut_send_carries_opus_medium(self):
        tiers = shipped()
        self.build(TWO_STAGE, tiers={"tiers": tiers["tiers"], "tier_models": tiers["tier_models"]})
        self.planned()
        self.station.once(1)
        cut = self.sent_to("ss")
        self.assertEqual(len(cut), 1)
        self.assertEqual({k: cut[0][k] for k in ("model", "thinkingLevel")}, OPUS_MEDIUM)

    def test_plan_send_still_opus_medium(self):
        tiers = shipped()
        self.build(TWO_STAGE, tiers={"tiers": tiers["tiers"], "tier_models": tiers["tier_models"]})
        self.station.once(1)
        plan = self.sent_to("boss")
        self.assertEqual(len(plan), 1)
        self.assertEqual({k: plan[0][k] for k in ("model", "thinkingLevel")}, OPUS_MEDIUM)

    def test_no_tables_cut_args_unchanged(self):
        self.build(TWO_STAGE)
        self.planned()
        self.station.once(1)
        cut = self.sent_to("ss")
        self.assertEqual(len(cut), 1)
        self.assertNotIn("model", cut[0])
        self.assertNotIn("thinkingLevel", cut[0])


if __name__ == "__main__":
    unittest.main()
