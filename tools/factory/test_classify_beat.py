import unittest

from test_dispatch import Base

LONG = "The merge retry in `tools/factory/dispatch.py` fails twice after a refused merge. " * 10


class ClassifyBeat(Base):
    def setUp(self):
        super().setUp()
        self.cfg["classify"] = {"on": True}
        self.w.issues = []

    def seed(self, n, title, body=LONG, labels=()):
        self.w.problems.append({"number": n, "title": title, "body": body, "comments": [],
                                "labels": list(labels), "state": "OPEN"})

    def prob(self, n):
        return next(p for p in self.w.problems if p["number"] == n)

    def classify_calls(self):
        return [c for c in self.w.gh_calls
                if "number,title,body,labels" in c
                or (c[:2] == ["issue", "edit"] and "--add-label" in c)
                or (c[:2] == ["issue", "comment"] and "--body" in c and c[c.index("--body") + 1].startswith("Classified "))]

    def test_an_issue_with_no_priority_gets_its_labels_and_the_reason(self):
        self.seed(40, "Merge retry fails twice")
        self.tick()
        self.assertEqual(self.prob(40)["labels"], ["P1", "area:factory"])
        self.assertEqual(self.prob(40)["comments"], ["Classified P1 (factory, bug) by rules: cites tools/factory/dispatch.py."])

    def test_factory_labels_and_priorities_are_never_touched(self):
        kept = [(41, ["factory"]), (42, ["factory-plan"]), (43, ["factory-paused"]),
                (44, ["factory-blocked"]), (45, ["owner"]), (46, ["P2"])]
        for n, labels in kept:
            self.seed(n, "Merge retry case %d" % n, labels=labels)
        self.tick()
        for n, labels in kept:
            self.assertEqual(self.prob(n)["labels"], labels)
            self.assertEqual(self.prob(n)["comments"], [])
        self.assertEqual(self.classify_calls(), [["issue", "list", "-R", "o/r", "--state", "open", "--json", "number,title,body,labels", "--limit", "200"]])

    def test_a_label_a_person_removed_stays_off_until_the_text_changes(self):
        self.seed(40, "Merge retry fails twice")
        self.tick()
        self.w.unlabel(40, "P1", "rob")
        self.tick()
        self.assertEqual(self.prob(40)["labels"], ["area:factory"])
        self.prob(40)["body"] = LONG + "Changed."
        self.tick()
        self.assertIn("P1", self.prob(40)["labels"])

    def test_an_issue_no_rule_places_is_left_alone_without_a_model(self):
        self.seed(47, "Wobble", body="Something vague happens sometimes.")
        self.tick()
        self.assertEqual(self.prob(47)["labels"], [])
        self.assertEqual(self.prob(47)["comments"], [])

    def test_a_beat_makes_at_most_30_gh_calls_and_the_next_beat_goes_on(self):
        for n in range(1, 21):
            self.seed(100 + n, "Merge retry number %d" % n)
        self.tick()
        self.assertLessEqual(len(self.classify_calls()), 30)
        self.assertEqual(sum(1 for p in self.w.problems if "P1" in p["labels"]), 14)
        self.tick()
        self.assertEqual(sum(1 for p in self.w.problems if "P1" in p["labels"]), 20)

    def test_off_when_the_config_has_no_classify_section(self):
        self.cfg.pop("classify")
        self.seed(40, "Merge retry fails twice")
        self.tick()
        self.assertEqual(self.classify_calls(), [])
        self.assertEqual(self.prob(40)["labels"], [])


if __name__ == "__main__":
    unittest.main()
