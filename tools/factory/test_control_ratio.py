import json
import os
import tempfile
import unittest

import control
import store as S

TYPES = {
    "coder": {"coworkers": [{"id": "code", "name": "code", "runs": 6}, {"id": "LARRY", "name": "LARRY", "runs": 2}]},
    "reviewer": {"coworkers": [{"id": "LINUS", "name": "LINUS", "runs": 3}, {"id": "BRUCE", "name": "BRUCE", "runs": 3}]},
    "acceptor": {"coworkers": [{"id": "BARBARA", "name": "BARBARA", "runs": 1}]},
}
BOUNDS = {"code": 8, "LARRY": 3, "LINUS": 4, "BRUCE": 4, "BARBARA": 3}
RATIO = {"review": 0.4, "proof": 0.3, "acceptance": 0.1}


class Follow(unittest.TestCase):
    def test_no_ratio_in_the_settings_changes_nothing(self):
        copies = {"code": 8, "LARRY": 3, "LINUS": 3, "BRUCE": 3, "BARBARA": 1}
        self.assertEqual(control.follow(copies, TYPES, BOUNDS, None), (copies, []))

    def test_checkers_that_already_follow_are_left_alone(self):
        copies = {"code": 6, "LARRY": 2, "LINUS": 3, "BRUCE": 3, "BARBARA": 1}
        self.assertEqual(control.follow(copies, TYPES, BOUNDS, RATIO), (copies, []))

    def test_a_checker_is_never_lowered(self):
        copies = {"code": 1, "LARRY": 0, "LINUS": 4, "BRUCE": 4, "BARBARA": 3}
        self.assertEqual(control.follow(copies, TYPES, BOUNDS, RATIO), (copies, []))

    def test_reviewer_copies_are_raised_to_follow_more_builders(self):
        copies = {"code": 8, "LARRY": 2, "LINUS": 3, "BRUCE": 3, "BARBARA": 1}
        out, lines = control.follow(copies, TYPES, BOUNDS, RATIO)
        self.assertEqual(out["LINUS"], 4)
        self.assertEqual(out["BRUCE"], 3)
        self.assertEqual(lines, [])

    def test_review_and_proof_share_the_reviewer_type_and_their_ratios_add(self):
        copies = {"code": 8, "LARRY": 3, "LINUS": 1, "BRUCE": 1, "BARBARA": 1}
        out, lines = control.follow(copies, TYPES, BOUNDS, RATIO)
        self.assertEqual(out["LINUS"] + out["BRUCE"], 8)
        self.assertEqual(lines, [])

    def test_builders_past_what_the_checkers_can_follow_are_held_at_the_ratio_with_a_line(self):
        bounds = dict(BOUNDS, LINUS=3, BRUCE=3)
        copies = {"code": 8, "LARRY": 3, "LINUS": 3, "BRUCE": 3, "BARBARA": 1}
        out, lines = control.follow(copies, TYPES, bounds, RATIO)
        self.assertEqual((out["code"], out["LARRY"]), (8, 0))
        self.assertEqual(len(lines), 1)
        self.assertIn("builders held at 8 of 11", lines[0])
        self.assertIn("reviewer", lines[0])

    def test_the_acceptor_follows_too(self):
        copies = {"code": 8, "LARRY": 2, "LINUS": 3, "BRUCE": 3, "BARBARA": 1}
        out, lines = control.follow(copies, TYPES, BOUNDS, {"acceptance": 0.25})
        self.assertEqual(out["BARBARA"], 3)
        self.assertEqual(lines, [])


def body_of(block):
    return "Settings\n```json\n" + json.dumps(block) + "\n```\n"


class Fake:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def __call__(self, args):
        self.calls.append(list(args))
        if args[:2] == ["issue", "list"]:
            return json.dumps(self.rows)
        return ""


class Tick(unittest.TestCase):
    def test_the_hold_is_applied_recorded_and_answered_on_the_control_issue(self):
        with tempfile.TemporaryDirectory() as d:
            store = S.Store(os.path.join(d, "ledger.db"))
            cfg = {
                "repo": "o/r",
                "check_ratio": RATIO,
                "types": json.loads(json.dumps(TYPES)),
            }
            bounds = {
                "settable": ["copies"],
                "copies": dict(BOUNDS, LINUS=3, BRUCE=3),
            }
            rows = [{"number": 7, "title": control.TITLE,
                     "body": body_of({"copies": {"code": 8, "LARRY": 3}})}]
            gh = Fake(rows)
            ctl = control.Control(cfg, gh, store, bounds)
            ctl.tick(1)
            ctl.tick(5)
            runs = {c["name"]: c["runs"] for t in cfg["types"].values() for c in t["coworkers"]}
            self.assertEqual(runs["code"] + runs["LARRY"], 8)
            self.assertEqual(ctl.effective["copies"]["code"] + ctl.effective["copies"]["LARRY"], 8)
            comments = [c for c in gh.calls if c[:2] == ["issue", "comment"]]
            self.assertEqual(len(comments), 1)
            self.assertIn("builders held at 8 of 11", comments[0][-1])
            store.close()


if __name__ == "__main__":
    unittest.main()
