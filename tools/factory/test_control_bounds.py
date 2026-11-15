import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def runs_today():
    out = {}
    for group in load("dispatch.json")["types"].values():
        for c in group["coworkers"]:
            out[c["name"]] = c["runs"]
    return out


class ControlBoundsTest(unittest.TestCase):
    def test_the_control_block_may_set_copies_and_wip_only(self):
        bounds = load("control-bounds.json")
        self.assertEqual(set(bounds), {"settable", "copies", "wip"})
        self.assertEqual(bounds["settable"], ["copies", "wip"])

    def test_copies_are_bounded_for_exactly_the_coworkers_of_the_settings(self):
        self.assertEqual(set(load("control-bounds.json")["copies"]), set(runs_today()))

    def test_no_bound_is_below_the_copies_the_settings_run_today(self):
        copies = load("control-bounds.json")["copies"]
        for name, runs in runs_today().items():
            self.assertGreaterEqual(copies[name], runs, name)

    def test_the_wip_limits_are_building_review_wait_and_proof_wait(self):
        self.assertEqual(
            load("control-bounds.json")["wip"],
            {"building": 12, "review_wait": 8, "proof_wait": 6},
        )

    def test_every_bound_is_a_whole_number_above_zero(self):
        bounds = load("control-bounds.json")
        for value in list(bounds["copies"].values()) + list(bounds["wip"].values()):
            self.assertIs(type(value), int)
            self.assertGreater(value, 0)


if __name__ == "__main__":
    unittest.main()
