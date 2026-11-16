import os
import tempfile
import unittest

import repo_events as E
import roster as R
from store import Store

BR = [
    {"branch": "dev", "sha": "a1", "ci": "RED"},
    {"branch": "main", "sha": "b1", "ci": "GREEN"},
    {"branch": "feature", "sha": "c1", "ci": "RED"},
]
MG = [
    {"number": 10, "base": "main", "sha": "m10", "files": ["README.md"]},
    {"number": 11, "base": "dev", "sha": "m11", "files": ["apps/engine/src/http/auth.ts"]},
    {"number": 12, "base": "dev", "sha": "m12", "files": ["docs/a.md", "src/a.test.ts"]},
]
IS = [{"number": 20}, {"number": 21, "pull_request": {}}]


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.st = Store(os.path.join(self.dir.name, "s.db"))
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "roster.json")) as f:
            self.roster = R.load(f.read())

    def run_wakes(self, branches=BR, merged=MG, issues=IS):
        return E.wakes(self.st, self.roster, branches, merged, issues)


class Wakes(Base):
    def test_one_wake_per_event_in_order(self):
        got = self.run_wakes()
        self.assertEqual(
            [(w["coworker"], w["stage"]) for w in got],
            [
                ("jez", "wake-jez"),
                ("margaret", "wake-margaret"),
                ("changelog_writer", "wake-changelog"),
                ("dana", "wake-dana"),
                ("issue_triage", "wake-issue-triage"),
            ],
        )
        self.assertEqual(got[0]["job"], "wake:ci-red:dev:a1")
        self.assertEqual(
            got[2]["payload"],
            {
                "pr": 11,
                "sha": "m11",
                "files": ["apps/engine/src/http/auth.ts"],
                "stage": "wake-changelog",
                "event": "merge-dev",
            },
        )

    def test_same_events_again_wake_nobody(self):
        self.run_wakes()
        self.assertEqual(self.run_wakes(), [])

    def test_new_red_head_wakes_jez_again(self):
        self.run_wakes()
        got = self.run_wakes([{"branch": "dev", "sha": "a2", "ci": "RED"}], [], [])
        self.assertEqual([w["job"] for w in got], ["wake:ci-red:dev:a2"])

    def test_nothing_to_see_is_quiet(self):
        self.assertEqual(self.run_wakes([], [], []), [])


class Behaviour(Base):
    def test_behaviour_change(self):
        self.assertFalse(E.behaviour(self.roster, ["README.md"]))
        self.assertFalse(E.behaviour(self.roster, []))
        self.assertTrue(E.behaviour(self.roster, ["tools/factory/wake.py"]))
        self.assertTrue(E.behaviour(self.roster, ["docs/a.md", "apps/x.ts"]))


if __name__ == "__main__":
    unittest.main()
