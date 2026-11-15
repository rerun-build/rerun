import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slots


class Station(unittest.TestCase):
    def test_each_waiting_state_names_its_station(self):
        self.assertEqual(slots.station({"state": "queued", "worker": "researcher"}), "researcher")
        self.assertEqual(slots.station({"state": "queued"}), "coder")
        self.assertEqual(slots.station({"state": "review_wait"}), "review")
        self.assertEqual(slots.station({"state": "fix_wait"}), "fix")
        self.assertEqual(slots.station({"state": "proof_wait"}), "proof")
        self.assertIsNone(slots.station({"state": "building"}))


class Quotas(unittest.TestCase):
    def test_free_slots_go_where_the_queue_is_longest(self):
        got = slots.quotas({"coder": 6, "review": 2, "proof": 4}, in_use=10, total=15)
        self.assertEqual(got, {"coder": 3, "review": 1, "proof": 1})

    def test_no_station_gets_more_than_it_has_waiting(self):
        got = slots.quotas({"coder": 1, "proof": 1}, in_use=0, total=15)
        self.assertEqual(got, {"coder": 1, "proof": 1})

    def test_a_full_pool_starts_nothing(self):
        self.assertEqual(slots.quotas({"coder": 5, "review": 3}, in_use=15, total=15), {"coder": 0, "review": 0})
        self.assertEqual(slots.quotas({"coder": 5}, in_use=17, total=15), {"coder": 0})

    def test_every_station_with_work_gets_a_slot_before_any_gets_a_second(self):
        got = slots.quotas({"coder": 9, "review": 1, "proof": 1}, in_use=11, total=15)
        self.assertEqual(got, {"coder": 2, "review": 1, "proof": 1})

    def test_one_free_slot_goes_to_the_longest_queue(self):
        self.assertEqual(slots.quotas({"coder": 2, "proof": 5}, in_use=14, total=15), {"coder": 0, "proof": 1})


if __name__ == "__main__":
    unittest.main()
