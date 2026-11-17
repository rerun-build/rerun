import unittest

from test_dispatch import Base


class ClassifyModel(Base):
    def setUp(self):
        super().setUp()
        self.cfg["classify"] = {"on": True, "agent": "triage", "agent_name": "Issue Triage"}
        self.w.issues = []

    def seed(self, n, title="Rename the button", body="Make the label shorter."):
        self.w.problems.append({"number": n, "title": title, "body": body, "comments": [],
                                "labels": [], "state": "OPEN"})

    def prob(self, n):
        return next(p for p in self.w.problems if p["number"] == n)

    def fires(self):
        return self.w.rows("SELECT job, stage, coworker, status FROM fires WHERE stage='classify' ORDER BY id")

    def test_an_issue_the_rules_cannot_place_goes_to_one_cheap_run(self):
        self.seed(300)
        self.tick()
        self.assertEqual(len(self.w.sends), 1)
        agent, message, _ = self.w.sends[0]
        self.assertEqual(agent, "triage")
        self.assertIn("Issue #300: Rename the button", message)
        self.assertIn("CLASS: <area> <kind> <P0|P1|P2|P3> <reason>", message)
        self.assertEqual(self.fires(), [("classify:300", "classify", "Issue Triage", "running")])
        self.w.finish("triage", "thinking\nCLASS: ui feature P3 a label on a @screen")
        self.w.clock += 30
        self.tick()
        self.assertEqual(self.prob(300)["labels"], ["P3"])
        self.assertEqual(self.prob(300)["comments"], ["Classified P3 (ui, feature) by model: a label on a screen."])
        self.assertEqual(self.fires(), [("classify:300", "classify", "Issue Triage", "done")])
        self.assertEqual(len(self.w.sends), 1)

    def test_at_most_five_runs_a_beat(self):
        for n in range(300, 307):
            self.seed(n)
        self.tick()
        self.assertEqual(len(self.w.sends), 5)
        self.w.clock += 30
        self.tick()
        self.assertEqual(len(self.w.sends), 7)

    def test_an_answer_out_of_form_labels_nothing_and_is_not_sent_again(self):
        self.seed(300)
        self.tick()
        self.w.finish("triage", "CLASS: nowhere feature P3 why")
        self.w.clock += 30
        self.tick()
        self.w.clock += 30
        self.tick()
        self.assertEqual(self.prob(300)["labels"], [])
        self.assertEqual(self.prob(300)["comments"], [])
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.fires(), [("classify:300", "classify", "Issue Triage", "done")])

    def test_model_and_thinking_level_are_sent_only_when_set(self):
        self.seed(300)
        self.tick()
        self.assertNotIn("model", self.w.send_args[0])
        self.assertNotIn("thinkingLevel", self.w.send_args[0])
        self.cfg["classify"].update({"model": "claude-haiku-5-5", "thinkingLevel": "low"})
        self.seed(301)
        self.w.clock += 30
        self.tick(fresh=True)
        self.assertEqual(self.w.send_args[-1]["model"], "claude-haiku-5-5")
        self.assertEqual(self.w.send_args[-1]["thinkingLevel"], "low")


if __name__ == "__main__":
    unittest.main()
