import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(HERE, name)) as handle:
        return json.load(handle)


class Planners(unittest.TestCase):
    def test_every_planner_of_the_settings_may_write_issues(self):
        dispatch = load("dispatch.json")
        coworkers = load("roster.json")["coworkers"]
        planners = dispatch["types"]["planner"]["coworkers"]
        self.assertTrue(planners)
        refused = []
        for planner in planners:
            handle = planner["name"].lower().replace(" ", "_")
            row = coworkers.get(handle)
            if row is None or row.get("github") not in ("issues", "writer"):
                refused.append((planner["name"], None if row is None else row.get("github")))
        self.assertEqual(refused, [])


if __name__ == "__main__":
    unittest.main()
