import unittest

import waits


class Waits(unittest.TestCase):
    def test_each_waiting_state_gets_one_reason_from_the_list(self):
        now = 1000
        r = waits.reason
        self.assertEqual(r({"state": "waiting"}, now), "dependency")
        j = {"state": "queued", "not_before": now + 60}
        self.assertEqual(r(j, now), "back-off")
        self.assertEqual(r(j, now, {"kind": "plan limit", "until": now + 5}), "back-off")
        q = {"state": "queued", "not_before": None}
        self.assertEqual(r(q, now, {"kind": "plan limit", "until": 1}), "plan limit")
        self.assertEqual(r(q, now, {"kind": "sign-in renewal", "until": 1}), "sign-in renewal")
        self.assertEqual(r(q, now, {"kind": "other", "until": 1}), "hold")
        for s in ("review_wait", "fix_wait"):
            self.assertEqual(r({"state": s}, now), "no free worker of its type")
        for s in ("building", "checks", "merged"):
            self.assertIsNone(r({"state": s}, now))
        self.assertEqual(waits.REASONS, ("dependency", "fact recheck", "no free worker of its type", "back-off", "hold", "plan limit", "sign-in renewal"))


if __name__ == "__main__":
    unittest.main()
