import json
import unittest

import notes
import planning
from test_planning_review import Station, PLAN, OWNER

PANEL = [{"by": "LESLIE", "type": "critic", "lens": "failure"}, {"by": "ADA", "type": "critic", "lens": "structure"},
         {"by": "BARBARA", "type": "acceptor", "lens": "goal"}]
MAJOR = """NOTE 1 CHANGE major
QUOTE: A person sees the queue on the floor.
PROBLEM: the done-test is green on dev already
EVIDENCE: ran it on dev: OK
FIX: make the done-test fail on dev
REVIEW: 1 notes"""
GOAL = MAJOR.replace("the done-test is green on dev already", "the issue also asks for the empty queue").replace(
    "make the done-test fail on dev", "say what the floor shows when empty")


class Panel(Station):
    def build(self, review=None, extra=None, issues=None):
        super().build(review if review is not None else {"panel": PANEL, "mode": "on", "revisions": 1}, extra, issues)
        self.cfg["types"]["critic"] = {"coworkers": [{"id": "leslie", "name": "LESLIE", "runs": 1}, {"id": "ada", "name": "ADA", "runs": 1}]}

    def step(self, agent, out):
        self.w.finish(agent, out)
        self.once()
        self.once()

    def test_the_lenses_run_one_after_another_and_a_confirmed_major_note_sends_the_plan_back(self):
        self.build()
        self.planned()
        self.once()
        first = self.last("leslie")
        self.assertIn("failure modes", first)
        self.assertEqual(self.rec()["state"], "reviewing")
        self.step("leslie", MAJOR)
        second = self.last("ada")
        self.assertIn("structure and data", second)
        self.assertIn("NOTE 1.1 CHANGE major", second)
        self.assertIn("CONFIRM <id>:", second)
        self.step("ada", "CONFIRM 1.1: ran the done-test on dev, it passes\nREVIEW: 0 notes")
        third = self.last("barbara")
        self.assertIn("the goal", third)
        self.assertIn("NOTE 1.1", third)
        self.assertEqual(len([c for c in self.w.issue(5)["comments"] if c.startswith("## Review of the plan")]), 0)
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        comment = self.w.issue(5)["comments"][-1]
        self.assertTrue(comment.startswith("## Review of the plan, round 1"))
        self.assertIn("PANEL: LESLIE; confirmed by ADA", comment)
        self.assertEqual(self.rec()["state"], "revise")
        self.assertEqual([n["id"] for n in json.loads(self.rec()["revise_notes"])], ["1.1"])

    def test_a_major_note_no_other_lens_confirms_goes_only_to_the_cut(self):
        self.build()
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.step("ada", "REFUTE 1.1: the done-test fails on dev, ran it\nREVIEW: 0 notes")
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.assertEqual(self.rec()["state"], "planned")
        self.assertEqual([n["id"] for n in json.loads(self.rec()["open_notes"])], ["1.1"])
        self.once()
        self.assertIn("the done-test is green on dev already", self.last("ss"))

    def test_a_confirm_with_no_evidence_does_not_count(self):
        self.build()
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.step("ada", "CONFIRM 1.1:\nREVIEW: 0 notes")
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.assertEqual(self.rec()["state"], "planned")

    def test_a_heavy_note_of_the_last_lens_gets_a_check_only_run_by_the_first(self):
        self.build()
        self.planned()
        self.once()
        self.step("leslie", "REVIEW: 0 notes")
        self.step("ada", "REVIEW: 0 notes")
        self.step("barbara", GOAL)
        check = self.last("leslie")
        self.assertIn("NOTE 3.1 CHANGE major", check)
        self.assertIn("Write no notes of your own", check)
        self.w.finish("leslie", "CONFIRM 3.1: the issue body asks for the empty queue in its second line\nREVIEW: 0 notes")
        self.once()
        self.assertEqual(self.rec()["state"], "revise")
        self.assertEqual(len([s for s in self.w.sends if s[0] == "leslie"]), 2)

    def test_a_lens_missing_from_the_pools_is_skipped(self):
        self.build()
        del self.cfg["types"]["critic"]["coworkers"][1]
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.assertEqual(self.w.sends[-1][0], "barbara")
        self.w.finish("barbara", "CONFIRM 1.1: checked the test on dev\nREVIEW: 0 notes")
        self.once()
        self.assertEqual(self.rec()["state"], "revise")

    def test_with_fewer_than_two_lenses_the_plan_goes_to_the_cut_with_every_note_open(self):
        self.build()
        self.cfg["types"]["critic"]["coworkers"] = [{"id": "leslie", "name": "LESLIE", "runs": 1}]
        self.cfg["types"]["acceptor"]["coworkers"] = []
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.assertIn("could not run", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.rec()["state"], "cutting")
        self.assertIn("the done-test is green on dev already", self.last("ss"))

    def test_dry_mode_comments_once_and_counts_the_agreed_notes(self):
        self.build({"panel": PANEL, "mode": "dry"})
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.step("ada", "CONFIRM 1.1: ran it, green\nREVIEW: 0 notes")
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.assertIn("dry run", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.rec()["state"], "planned")
        log = json.loads(self.rec()["review_log"])[0]
        self.assertEqual((log["heavy"], log["agreed"], log["lenses"]), (1, 1, 3))

    def test_a_lost_lens_is_sent_again_once_and_the_next_lens_has_its_own_resend(self):
        self.build()
        self.planned()
        self.once()
        self.w.finish("leslie", None, status="error")
        self.once()
        self.once()
        self.assertEqual(len([s for s in self.w.sends if s[0] == "leslie"]), 2)
        self.step("leslie", "REVIEW: 0 notes")
        self.w.finish("ada", None, status="error")
        self.once()
        self.once()
        self.assertEqual(len([s for s in self.w.sends if s[0] == "ada"]), 2)

    def test_round_two_starts_again_at_the_first_lens(self):
        self.build()
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.step("ada", "CONFIRM 1.1: ran it, green\nREVIEW: 0 notes")
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.once()
        self.w.issue(5)["comments"].append(PLAN.replace("one slice", "one slice with a red done-test"))
        self.w.finish("boss", "PLAN: fixed")
        self.once()
        self.once()
        self.assertIn("round 2", self.last("leslie"))
        self.assertIn("You reviewed an earlier version", self.last("leslie"))


    def test_an_owner_question_sends_back_only_the_confirmed_notes(self):
        self.build()
        self.planned()
        self.once()
        owner = OWNER.replace("REVIEW: 1 notes", "") + "\n" + MAJOR.replace("NOTE 1", "NOTE 2")
        self.step("leslie", owner)
        self.step("ada", "REVIEW: 0 notes")
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.assertEqual(self.rec()["state"], "asked")
        self.assertEqual(json.loads(self.rec()["revise_notes"]), [])
        self.assertEqual([q["n"] for q in json.loads(self.rec()["questions"])], ["1.1"])

    def test_a_review_running_from_before_the_panel_keeps_its_notes(self):
        self.build()
        self.planned()
        self.once()
        self.store.set("plan:5", "round_open", "")
        self.step("leslie", MAJOR)
        self.assertEqual([n["id"] for n in json.loads(self.rec()["panel_notes"])], ["1.1"])
        self.assertEqual(self.rec()["review_round"], "1")
        self.assertIn("NOTE 1.1", self.last("ada"))

    def test_earlier_round_notes_carry_no_panel_ids(self):
        self.build()
        self.planned()
        self.once()
        self.step("leslie", MAJOR)
        self.step("ada", "CONFIRM 1.1: ran it, green\nREVIEW: 0 notes")
        self.w.finish("barbara", "REVIEW: 0 notes")
        self.once()
        self.once()
        self.w.issue(5)["comments"].append(PLAN.replace("one slice", "one slice with a red done-test"))
        self.w.finish("boss", "PLAN: fixed")
        self.once()
        self.once()
        self.assertNotIn("NOTE 1.1", self.last("leslie"))
        self.assertIn("NOTE 1 CHANGE major", self.last("leslie"))


class Verdicts(unittest.TestCase):
    def test_verdict_lines_are_read_and_do_not_leak_into_a_note(self):
        out = "CONFIRM 1.2: ran it\nREFUTE 2.1: the file exists\n" + MAJOR
        self.assertEqual(notes.verdicts(out), [("CONFIRM", "1.2", "ran it"), ("REFUTE", "2.1", "the file exists")])
        kept, _ = notes.read(MAJOR.replace("\nREVIEW: 1 notes", "") + "\nCONFIRM 1.2: ran it", PLAN)
        self.assertEqual(kept[0]["FIX"], "make the done-test fail on dev")

    def test_a_single_reviewer_needs_no_confirmation(self):
        note = {"severity": "major", "kind": "CHANGE", "confirm": []}
        self.assertEqual(planning.agreed([note], 1), [note])
        self.assertEqual(planning.agreed([note], 3), [])


if __name__ == "__main__":
    unittest.main()
