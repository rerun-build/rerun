import json
import os
import unittest

import test_dispatch as T
import test_dispatch_proof as P
import tiers

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "dispatch.json")) as f:
    SHIPPED = json.load(f)

PLANNERS = {
    "coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
    "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]},
    "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}]},
}


class TierModel(T.Base):
    def setUp(self):
        super().setUp()
        self.args = []
        real = self.w.account

        def spy(tool, args):
            if tool == "send_message":
                self.args.append(dict(args))
            return real(tool, args)

        self.w.account = spy

    def shipped(self):
        self.cfg["tiers"] = SHIPPED["tiers"]
        self.cfg["tier_models"] = SHIPPED["tier_models"]

    def test_build_small_sends_haiku_low(self):
        self.shipped()
        self.w.issues[0]["body"] = T.ready("**Size**: small")
        self.tick()
        self.assertEqual((self.args[0]["model"], self.args[0]["thinkingLevel"]), ("claude-haiku-5-5", "low"))

    def test_build_medium_and_large(self):
        self.shipped()
        self.w.issues[0]["body"] = T.ready("**Size**: medium")
        self.tick()
        self.assertEqual((self.args[0]["model"], self.args[0]["thinkingLevel"]), ("claude-sonnet-5-5", "medium"))

    def test_build_large_sends_sonnet_high(self):
        self.shipped()
        self.w.issues[0]["body"] = T.ready("**Size**: large")
        self.tick()
        self.assertEqual((self.args[0]["model"], self.args[0]["thinkingLevel"]), ("claude-sonnet-5-5", "high"))

    def test_review_opus_medium(self):
        self.shipped()
        self.to_review()
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual((self.args[-1]["model"], self.args[-1]["thinkingLevel"]), ("claude-opus-5-5", "medium"))

    def test_fix_follows_the_build_size(self):
        self.shipped()
        self.w.issues[0]["body"] = T.ready("**Size**: small")
        self.to_review()
        self.w.finish("r1", "VERDICT: CHANGES @abcdef1: fix it")
        self.tick(2)
        fixes = [a for a in self.args if a.get("model") == "claude-haiku-5-5"]
        self.assertGreaterEqual(len(fixes), 1)

    def test_replan_sends_opus_medium(self):
        self.cfg["types"] = PLANNERS
        self.shipped()
        self.tick()
        self.w.finish("b1", "BLOCKED: plan: a file outside its paths")
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual((self.args[-1]["model"], self.args[-1]["thinkingLevel"]), ("claude-opus-5-5", "medium"))

    def test_no_tier_models_sends_todays_args(self):
        self.tick()
        self.assertEqual(set(self.args[0]), {"agentId", "message", "waitSeconds", "goal", "copyIndex"})

    def test_bad_table_is_logged_and_sends_no_model(self):
        self.cfg["tiers"] = SHIPPED["tiers"]
        self.cfg["tier_models"] = {"build": {"medium": {"model": "", "thinkingLevel": "medium"}}}
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertNotIn("model", self.args[0])
        self.assertIn("no tier written", self.out.getvalue())


class TierProof(P.ProofBase):
    def test_proof_sends_sonnet_medium(self):
        args = []
        real = self.w.account

        def spy(tool, a):
            if tool == "send_message":
                args.append(dict(a))
            return real(tool, a)

        self.w.account = spy
        self.cfg["tiers"] = SHIPPED["tiers"]
        self.cfg["tier_models"] = SHIPPED["tier_models"]
        self.to_proving()
        self.assertEqual(self.state(), "proving")
        self.assertEqual((args[-1]["model"], args[-1]["thinkingLevel"]), ("claude-sonnet-5-5", "medium"))


class ModelFor(unittest.TestCase):
    def test_empty_table_gives_none(self):
        self.assertIsNone(tiers.model_for("build", "low", None))
        self.assertIsNone(tiers.model_for("build", "low", {}))

    def test_no_tier_gives_none(self):
        self.assertIsNone(tiers.model_for("build", None, SHIPPED["tier_models"]))

    def test_known_entry(self):
        self.assertEqual(tiers.model_for("build", "low", SHIPPED["tier_models"]),
                         {"model": "claude-haiku-5-5", "thinkingLevel": "low"})

    def test_unknown_station_raises(self):
        with self.assertRaises(ValueError):
            tiers.model_for("nope", "low", SHIPPED["tier_models"])

    def test_unknown_tier_raises(self):
        with self.assertRaises(ValueError):
            tiers.model_for("review", "low", SHIPPED["tier_models"])

    def test_effort_max_raises(self):
        with self.assertRaises(ValueError):
            tiers.model_for("build", "low", {"build": {"low": {"model": "m", "thinkingLevel": "max"}}})


if __name__ == "__main__":
    unittest.main()
