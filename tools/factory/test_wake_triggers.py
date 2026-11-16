import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import trigger as T

WAKES = [
    ("wake-jez", "JEZ"),
    ("wake-margaret", "MARGARET"),
    ("wake-changelog", "CHANGELOG_WRITER"),
    ("wake-dana", "DANA"),
    ("wake-issue-triage", "ISSUE_TRIAGE"),
]


class WakeTriggers(unittest.TestCase):
    def test_shipped_config_has_one_trigger_per_wake_stage(self):
        cfg = T.load_config()
        self.assertIs(cfg["repo_events"], True)
        self.assertEqual(len(cfg["triggers"]), 7)
        by_stage = {t["stage"]: t for t in cfg["triggers"]}
        for stage, coworker in WAKES:
            self.assertEqual(by_stage[stage], {
                "stage": stage,
                "coworker": coworker,
                "agent_name": stage,
                "slug": "factory-" + stage,
                "model": "stub-fast",
            })

    def test_every_wake_body_probes_and_ends_quietly(self):
        head = T.stage_body("challenge").split("\n\n")[0] + "\n\n"
        for stage, _ in WAKES:
            body = T.stage_body(stage)
            self.assertTrue(body.startswith(head), stage)
            self.assertIn("answer with the single line QUIET and end", body, stage)
            self.assertIn("ONE ", body, stage)


if __name__ == "__main__":
    unittest.main()
