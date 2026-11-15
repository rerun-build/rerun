import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T


def two():
    other = T.ready().replace("a/b.py", "c/d.py").replace("a/test_b.py", "c/test_d.py")
    return [{"number": 5, "title": "A", "body": T.ready(), "comments": []},
            {"number": 6, "title": "B", "body": other, "comments": []}]


class Slots(T.Base):
    def setUp(self):
        super().setUp()
        self.w = T.World(two())
        self.w.ledger = self.cfg["ledger_file"]

    def test_one_free_slot_starts_one_build_and_the_other_waits(self):
        self.cfg["slots"] = 1
        self.tick()
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(sorted([self.state(5), self.state(6)]), ["building", "queued"])

    def test_without_a_slot_pool_both_builds_start(self):
        self.tick()
        self.assertEqual(len(self.w.sends), 2)
        self.assertEqual([self.state(5), self.state(6)], ["building", "building"])

    def test_a_full_pool_starts_nothing_until_a_run_ends(self):
        self.cfg["slots"] = 1
        self.tick()
        self.tick()
        self.assertEqual(len(self.w.sends), 1)


class Shipped(unittest.TestCase):
    def test_dispatch_json_shares_fifteen_slots(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")) as f:
            self.assertEqual(json.load(f).get("slots"), 15)


if __name__ == "__main__":
    unittest.main()
