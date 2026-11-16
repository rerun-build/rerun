import unittest

import classify


def issue(number, title, body="", labels=()):
    return {"number": number, "title": title, "body": body, "labels": [{"name": n} for n in labels]}


class ClassifyTests(unittest.TestCase):
    def setUp(self):
        self.rules = classify.load()

    def test_the_rules_file_holds_the_four_priorities_in_order(self):
        self.assertEqual([p["name"] for p in self.rules["priorities"]], ["P0", "P1", "P2", "P3"])
        self.assertEqual(
            [a["name"] for a in self.rules["areas"]],
            ["factory", "engine", "ui", "contracts", "deploy", "docs", "ci"],
        )

    def test_area_is_the_most_cited_path(self):
        i = issue(1, "x", "tools/factory/a.py tools/factory/b.py apps/ui/c.tsx")
        self.assertEqual(classify.area(i, self.rules), "factory")

    def test_an_area_label_the_issue_has_wins(self):
        i = issue(1, "x", "tools/factory/a.py", ["area:db"])
        self.assertEqual(classify.area(i, self.rules), "db")

    def test_area_from_a_word_when_no_path_is_cited(self):
        self.assertEqual(classify.area(issue(1, "The dispatcher logs twice"), self.rules), "factory")

    def test_kinds(self):
        r = self.rules
        body = "Split it in tools/factory/a.py.\n<!-- followup:#929-1 -->\nFrom the review of #929."
        self.assertEqual(classify.kind(issue(1, "t", body), r), "follow-up")
        self.assertEqual(classify.kind(issue(2, "Push .github/workflows/ci.yml by hand"), r), "operator")
        self.assertEqual(classify.kind(issue(3, "PLAN READY (cut of #9)"), r), "plan")
        self.assertEqual(classify.kind(issue(4, "The page crash when empty"), r), "bug")
        self.assertEqual(classify.kind(issue(5, "Ask", "word " * 180), r), "feature")
        self.assertEqual(classify.kind(issue(6, "t", "", ["factory-problem"]), r), "problem")

    def test_a_short_ask_citing_a_file_is_a_follow_up(self):
        i = issue(1, "Tidy", "Look at tools/factory/gate.py")
        self.assertEqual(classify.kind(i, self.rules), "follow-up")

    def test_priority_follows_robs_order(self):
        r = self.rules
        self.assertEqual(
            classify.priority(issue(1, "Saves tokens in tools/factory/dispatch.py"), r),
            ("P0", 'says "tokens"'),
        )
        self.assertEqual(
            classify.priority(issue(2, "tools/factory/dispatch.py retries"), r),
            ("P1", "cites tools/factory/dispatch.py"),
        )
        self.assertEqual(
            classify.priority(issue(3, "apps/ui/components/factory/FactoryTank.tsx"), r)[0], "P2"
        )
        self.assertEqual(classify.priority(issue(4, "apps/engine/src/a.ts"), r)[0], "P3")

    def test_place_gives_none_when_a_rule_is_missing(self):
        r = self.rules
        self.assertIsNone(classify.place(issue(1, "Rename the button"), r))
        self.assertEqual(
            classify.place(issue(2, "In `tools/factory/gate.py` split on newlines."), r),
            {
                "area": "factory",
                "kind": "follow-up",
                "priority": "P1",
                "reason": "cites tools/factory/gate.py",
            },
        )

    def test_skipped_labels(self):
        r = self.rules
        for name in ["P0", "P3", "factory", "factory-plan", "factory-paused", "factory-blocked", "factory-problem", "owner"]:
            self.assertTrue(classify.skipped(issue(1, "t", "", [name]), r), name)
        for name in ["bug", "area:factory"]:
            self.assertFalse(classify.skipped(issue(1, "t", "", [name]), r), name)

    def test_the_hash_changes_with_the_text(self):
        a = classify.digest(issue(1, "one", "body"))
        self.assertEqual(a, classify.digest(issue(2, "one", "body")))
        self.assertNotEqual(a, classify.digest(issue(1, "one", "body2")))
        self.assertEqual(len(a), 16)

    def test_same_file_and_function(self):
        a = issue(1, "Split main", "See `refactorcheck.main` in tools/factory/refactorcheck.py")
        b = issue(2, "Cover it", "tools/factory/refactorcheck.py has `refactorcheck.main()` untested")
        self.assertEqual(
            classify.similar([a, b], self.rules),
            [(1, 2, "both cite tools/factory/refactorcheck.py and refactorcheck.main")],
        )

    def test_titles_sharing_most_words(self):
        a = issue(1, "Dispatcher logs every line twice")
        b = issue(2, "Dispatcher logs every line twice again")
        self.assertEqual(classify.similar([a, b], self.rules), [(1, 2, "their titles share most words")])

    def test_different_issues_are_not_similar(self):
        a = issue(1, "Dispatcher logs twice", "tools/factory/dispatch.py `run`")
        b = issue(2, "Rename the button", "apps/ui/a.tsx `render`")
        self.assertEqual(classify.similar([a, b], self.rules), [])


if __name__ == "__main__":
    unittest.main()
