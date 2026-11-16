import json
import os
import unittest

import test_dispatch as T
from test_dispatch import Base, ready, World

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "dispatch.json")) as f:
    SHIPPED = json.load(f)


def stamp(clock, back):
    return T.D.iso(clock - back)


class TierFloor(Base):
    def setUp(self):
        super().setUp()
        self.args = []
        real = self.w.account

        def spy(tool, args):
            if tool == "send_message":
                self.args.append(dict(args))
            return real(tool, args)

        self.w.account = spy
        self.cfg["tiers"] = SHIPPED["tiers"]
        self.cfg["tier_models"] = SHIPPED["tier_models"]
        self.cfg["tier_floor"] = {"yield": 0.7, "min_merged": 5}
        self.w.issues[0]["body"] = ready("**Size**: small")

    def seed(self, merged, fixed):
        self.d = self.new()
        for i in range(merged):
            n = str(900 + i)
            data = {"issue": 900 + i, "title": "T", "body": "**Depends on**: none\n"}
            self.d.store.put_job(n, "queued", data, "r", at=stamp(self.w.clock, 7200))
            if i < fixed:
                self.d.store.put_job(n, "fix_wait", data, "r", at=stamp(self.w.clock, 5400))
            self.d.store.put_job(n, "merged", data, "r", at=stamp(self.w.clock, 3600))

    def test_low_yield_sends_no_model(self):
        self.seed(5, 2)
        self.tick()
        self.assertTrue(self.args)
        self.assertNotIn("model", self.args[0])
        self.assertNotIn("thinkingLevel", self.args[0])
        self.assertIn("tier models off", self.out.getvalue())

    def test_four_merged_is_too_few_to_switch_off(self):
        self.seed(4, 4)
        self.tick()
        self.assertEqual((self.args[0]["model"], self.args[0]["thinkingLevel"]), ("claude-haiku-5-5", "low"))
        self.assertNotIn("tier models off", self.out.getvalue())

    def test_yield_at_floor_keeps_models(self):
        self.cfg["tier_floor"] = {"yield": 0.6, "min_merged": 5}
        self.seed(5, 2)
        self.tick()
        self.assertEqual((self.args[0]["model"], self.args[0]["thinkingLevel"]), ("claude-haiku-5-5", "low"))

    def test_no_tier_floor_never_off(self):
        del self.cfg["tier_floor"]
        self.seed(5, 5)
        self.tick()
        self.assertEqual((self.args[0]["model"], self.args[0]["thinkingLevel"]), ("claude-haiku-5-5", "low"))

    def test_shipped_floor(self):
        self.assertEqual(SHIPPED["tier_floor"], {"yield": 0.7, "min_merged": 5})


if __name__ == "__main__":
    unittest.main()
