import copy, json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
from test_dispatch import Base, ready
from test_planning_start import CFG, Rig

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "dispatch.json")) as f:
    SHIPPED = json.load(f)
FABLE_MEDIUM = {"model": "claude-fable-5-2", "thinkingLevel": "medium"}
OPUS_MEDIUM = {"model": "claude-opus-5-5", "thinkingLevel": "medium"}


def captured(station_account):
    got = []

    def account(tool, args):
        if tool == "send_message":
            got.append(args)
        return station_account(tool, args)
    return got, account


class PlanSend(unittest.TestCase):
    def cfg(self, tables):
        cfg = copy.deepcopy(CFG)
        if tables:
            cfg["tiers"] = copy.deepcopy(SHIPPED["tiers"])
            cfg["tier_models"] = copy.deepcopy(SHIPPED["tier_models"])
        return cfg

    def test_plan_send_carries_fable_medium(self):
        r = Rig(cfg=self.cfg(True))
        got, r.station.account = captured(r.account)
        r.station.once(1)
        self.assertTrue(got)
        self.assertEqual(got[0]["model"], FABLE_MEDIUM["model"])
        self.assertEqual(got[0]["thinkingLevel"], FABLE_MEDIUM["thinkingLevel"])

    def test_no_tables_plan_args_unchanged(self):
        r = Rig(cfg=self.cfg(False))
        got, r.station.account = captured(r.account)
        r.station.once(1)
        self.assertTrue(got)
        self.assertEqual(set(got[0]), {"agentId", "message", "waitSeconds", "goal"})


class ResolveSend(Base):
    def setUp(self):
        super().setUp()
        cw = lambda ids: [{"id": i, "name": i.upper(), "runs": 1} for i in ids]
        self.cfg["types"] = {"coder": {"max_jobs": 8, "coworkers": cw(["b1", "b2"])}, "reviewer": {"coworkers": cw(["r1", "r2"])},
                             "resolver": {"coworkers": [{"id": "h1", "name": "HOUSE", "runs": 2}]}}
        self.cfg["resolver"] = {"detect": True, "resolve": True}
        self.w.issues = [{"number": 6, "title": "bad 6", "body": ready().replace("**Files**", "Files"), "comments": []}]

    def house_args(self):
        got = []
        orig = self.w.account

        def account(tool, args):
            if tool == "send_message" and args["agentId"] == "h1":
                got.append(args)
            return orig(tool, args)
        self.w.account = account
        self.tick()
        return got

    def test_resolve_send_carries_opus_medium(self):
        self.cfg["tiers"] = copy.deepcopy(SHIPPED["tiers"])
        self.cfg["tier_models"] = copy.deepcopy(SHIPPED["tier_models"])
        got = self.house_args()
        self.assertTrue(got)
        self.assertEqual(got[0]["model"], OPUS_MEDIUM["model"])
        self.assertEqual(got[0]["thinkingLevel"], OPUS_MEDIUM["thinkingLevel"])

    def test_no_tables_resolve_args_unchanged(self):
        got = self.house_args()
        self.assertTrue(got)
        self.assertEqual(set(got[0]), {"agentId", "message", "waitSeconds", "goal"})


class Brief(unittest.TestCase):
    def test_brief_asks_for_a_size_line(self):
        text = planning.brief({"number": 612, "title": "Floor: show the queue"}, "o/rerun")
        self.assertIn("**Size**: small|medium|large", text)


if __name__ == "__main__":
    unittest.main()
