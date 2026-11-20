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

    def test_station_send_includes_rules_only_when_configured_and_records_version_in_kv(self):
        import tempfile, store as S
        with tempfile.TemporaryDirectory() as d:
            st = S.Store(os.path.join(d, "plan.db"))
            sent = []
            def account(tool, args):
                if tool == "send_message":
                    sent.append(args)
                return {"runId": "r1"}
            cfg = {
                "repo": "o/r",
                "types": {"planner": {"coworkers": [{"id": "a1", "name": "Boss", "runs": 1}]}},
                "planning": {"rules": True, "plan_by": ["Boss"], "cut_by": ["Boss"]}
            }
            station = planning.Station(cfg, st, account, lambda args: "{}", lambda: 1000.0)
            station.send(ISSUE, ("a1", 1))
            self.assertEqual(len(sent), 1)
            self.assertIn(planning.RULES, sent[0]["message"])
            self.assertEqual(st.get_all("plan:7")["rules"], planning.RULES_V)
            st.close()
    def test_the_live_config_turns_them_on_for_the_planner(self):
        with open(DISPATCH, encoding="utf-8") as f:
            self.assertIs(json.load(f)["planning"].get("rules"), True)

    def test_a_plan_record_names_the_rules_it_was_sent_with(self):
        self.assertEqual(planning.rules_version({"rules": True}), planning.RULES_V)
        self.assertEqual(planning.rules_version({}), "")


if __name__ == "__main__":
    unittest.main()
