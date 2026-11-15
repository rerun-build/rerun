import unittest

from planning import unplanned, weight


def issue(number, labels=None, created=None):
    data = {"number": number}
    if labels is not None:
        data["labels"] = [{"name": name} for name in labels]
    if created is not None:
        data["createdAt"] = created
    return data


ISSUES = [
    issue(10, ["P2"], "2026-11-01"),
    issue(11, ["P0"], "2026-11-10"),
    issue(12, ["P0", "bug"], "2026-11-05"),
    issue(13, ["P1", "factory"], "2026-11-02"),
    issue(14, ["bug"], "2026-11-03"),
    issue(15, ["P3", "duplicate"], "2026-11-04"),
    issue(16, ["P1", "factory-plan"], "2026-11-06"),
    issue(17, ["P3"], "2026-10-01"),
    issue(18, ["P1", "factory-done"], "2026-11-07"),
    issue(19, ["P1", "factory-blocked"], "2026-11-08"),
    issue(20, ["P1", "likely-fixed"], "2026-11-09"),
    issue(21),
]


class PlanningPickTest(unittest.TestCase):
    def test_keeps_only_unplanned(self):
        self.assertEqual({i["number"] for i in unplanned(ISSUES)}, {10, 11, 12, 17})

    def test_order(self):
        self.assertEqual([i["number"] for i in unplanned(ISSUES)], [12, 11, 10, 17])

    def test_weights(self):
        self.assertEqual([weight(issue(1, [p])) for p in ("P0", "P1", "P2", "P3")], [8, 4, 2, 1])

    def test_largest_weight_wins(self):
        self.assertEqual(weight(issue(1, ["P3", "P1"])), 4)

    def test_empty(self):
        self.assertEqual(unplanned([]), [])


if __name__ == "__main__":
    unittest.main()
