import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning

ISSUE = {"number": 7, "title": "Something"}
DISPATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")


class Rules(unittest.TestCase):
    def test_the_plan_brief_carries_the_working_rules_when_they_are_on(self):
        text = planning.plan_brief(ISSUE, "o/r", reader={"rules": True})
        self.assertIn(planning.RULES, text)

    def test_the_plan_brief_has_no_working_rules_when_they_are_off(self):
        self.assertNotIn(planning.RULES, planning.plan_brief(ISSUE, "o/r", reader={}))
        self.assertNotIn(planning.RULES, planning.plan_brief(ISSUE, "o/r", reader={"rules": False}))

    def test_the_rules_keep_the_run_small_and_the_facts_exact(self):
        for words in ("Batch", "never read an unchanged file again", "not, never, only"):
            self.assertIn(words, planning.RULES)

    def test_the_live_config_turns_them_on_for_the_planner(self):
        with open(DISPATCH, encoding="utf-8") as f:
            self.assertIs(json.load(f)["planning"].get("rules"), True)

    def test_a_plan_record_names_the_rules_it_was_sent_with(self):
        self.assertEqual(planning.rules_version({"rules": True}), planning.RULES_V)
        self.assertEqual(planning.rules_version({}), "")


if __name__ == "__main__":
    unittest.main()
