import unittest

import pools

CFG = {"types": {"reviewer": {"coworkers": [
    {"id": "A", "name": "A", "runs": 2},
    {"id": "B", "name": "B", "runs": 1},
    {"id": "C", "name": "C", "runs": 1},
]}}}


class PickCopyExclude(unittest.TestCase):
    def test_an_excluded_coworker_is_skipped_and_the_next_one_is_picked(self):
        self.assertEqual(pools.pick_copy(CFG, "reviewer", [], exclude=["A"]), ("B", 1))
        self.assertEqual(pools.pick_copy(CFG, "reviewer", [("B", 1)], exclude=["A"]), ("C", 1))
        self.assertEqual(pools.pick_copy(CFG, "reviewer", [], exclude=("A", "B")), ("C", 1))

    def test_nothing_is_picked_when_every_allowed_coworker_is_full_or_excluded(self):
        self.assertIsNone(pools.pick_copy(CFG, "reviewer", [], exclude=["A", "B", "C"]))
        self.assertIsNone(pools.pick_copy(CFG, "reviewer", [("B", 1), ("C", 1)], exclude=["A"]))

    def test_without_exclude_the_picks_are_as_before(self):
        self.assertEqual(pools.pick_copy(CFG, "reviewer", []), ("A", 1))
        self.assertEqual(pools.pick_copy(CFG, "reviewer", [("A", 1)]), ("A", 2))
        self.assertEqual(pools.pick_copy(CFG, "reviewer", [("A", 1), ("A", 2)]), ("B", 1))
        self.assertIsNone(pools.pick_copy(CFG, "unknown", [], exclude=["A"]))
