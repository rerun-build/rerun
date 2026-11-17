import causes
import instructions
from test_dispatch import Base, T0, World
from test_instructions import BODY, NEW, OLD

TYPES = {
    "coder": {"coworkers": [{"id": "b1", "name": "B1", "runs": 1}, {"id": "b2", "name": "B2", "runs": 1}], "max_jobs": 8},
    "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}, {"id": "r2", "name": "R2", "runs": 1}]},
    "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}]},
}
G = "fix round @ review"
LIVE = T0 + 3600


class Measure(Base):
    def setUp(self):
        super().setUp()
        self.w = World(issues=[])
        self.w.ledger = self.cfg["ledger_file"]
        self.w.clock = LIVE + 7200
        self.cfg["types"] = TYPES
        self.cfg["planning"] = {"auto": False}

    def job(self, n, start, end, state, pr=None):
        s = self.d.store
        s.put_job(str(n), "building", {"issue": n, "pr": pr}, at=causes.iso(start))
        s.put_job(str(n), state, {"issue": n, "pr": pr}, at=causes.iso(end))

    def setup_change(self, before=4.0, end_state="merged", kind="repo", issue=301):
        self.tick()
        s = self.d.store
        if kind == "repo":
            self.job(issue, T0, LIVE, end_state, pr=42)
        else:
            s.set("instr:%d" % issue, "state", "applied" if end_state == "merged" else end_state)
            s.set("instr:%d" % issue, "applied_at", str(LIVE))
        s.add_change(issue, G, kind, before)

    def later(self, count, fails):
        for k in range(count):
            start = LIVE + (k + 1) * 60
            self.job(1000 + k, start, start + 30, "merged")
        for k in range(fails):
            self.d.store.add_failure("fix round", str(1000 + k), station="review", coworker="B1", reason="stopped")

    def change(self):
        return self.d.store.changes()[0]

    def boss(self):
        return [s for s in self.w.sends if s[0] == "p1"]

    def test_a_merged_change_goes_live_at_its_merge(self):
        self.setup_change()
        self.tick(5)
        self.assertEqual(self.change()["live_at"], LIVE)
        self.assertIsNone(self.change()["verdict"])

    def test_after_twenty_later_jobs_a_lower_rate_keeps_the_change(self):
        self.setup_change()
        self.later(20, 2)
        self.tick(5)
        self.assertEqual((self.change()["after"], self.change()["verdict"], self.change()["revert"]), (2.0, "kept", None))
        self.assertEqual(self.w.problems, [])

    def test_nineteen_later_jobs_are_not_yet_a_measure(self):
        self.setup_change()
        self.later(19, 1)
        self.tick(5)
        self.assertEqual((self.change()["after"], self.change()["verdict"]), (None, None))
        self.assertEqual(self.w.problems, [])

    def test_a_rate_that_is_not_lower_files_one_revert_issue_for_the_planner(self):
        self.setup_change()
        self.later(20, 4)
        self.tick(5)
        self.assertEqual((self.change()["after"], self.change()["verdict"]), (4.0, "revert"))
        self.assertEqual(len(self.w.problems), 1)
        issue = self.w.problems[0]
        self.assertEqual(issue["title"], "Revert of #301: it did not lower `%s`" % G)
        self.assertEqual(issue["labels"], ["P0"])
        self.assertIn("**Repairs**: #301", issue["body"])
        self.assertIn("4.0 before, 4.0 after", issue["body"])
        self.assertIn(G, issue["body"])
        self.assertIn("#42", issue["body"])
        self.assertEqual(self.change()["revert"], issue["number"])

    def test_twelve_beats_file_it_once(self):
        self.setup_change()
        self.later(20, 4)
        self.tick(12)
        self.assertEqual(len(self.w.problems), 1)

    def test_a_reverted_instructions_change_files_the_swapped_instructions_issue(self):
        self.w.issues = [{"number": 40, "title": "Plan each job", "body": BODY, "comments": []}]
        self.setup_change(kind="instructions", issue=40)
        self.later(20, 4)
        self.tick(5)
        self.assertEqual(len(self.w.problems), 1)
        issue = self.w.problems[0]
        self.assertEqual(issue["labels"], ["instructions"])
        self.assertEqual(instructions.parse({"number": 0, "body": issue["body"]})["old"], NEW)
        self.assertEqual(instructions.parse({"number": 0, "body": issue["body"]})["new"], OLD)

    def test_a_change_whose_job_ended_without_a_merge_is_dropped(self):
        self.setup_change(end_state="failed")
        self.later(20, 4)
        self.tick(5)
        self.assertEqual(self.change()["verdict"], "dropped")
        self.assertIsNone(self.change()["after"])
        self.assertEqual(self.w.problems, [])

    def test_a_reverted_change_goes_back_to_boss_once_with_the_fact(self):
        self.setup_change()
        self.later(20, 10)
        self.tick(5)
        self.assertEqual(len(self.boss()), 1)
        self.assertIn("Back to you: the change #301 did not lower `%s`: 4.0 before, 10.0 after" % G, self.boss()[0][1])
        self.assertEqual(self.change()["told"], 1)
        self.tick(10)
        self.assertEqual(len(self.boss()), 1)
