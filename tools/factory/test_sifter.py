import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sifter
from test_dispatch import Base, ready


class Sift(unittest.TestCase):
    def test_dev_at_sha_becomes_dev_sha(self):
        body, fixed = sifter.sift("PLAN READY (cut of #1; facts read on dev at 946e5ce8)\nrest")
        self.assertEqual(body, "PLAN READY (cut of #1; facts read on dev 946e5ce8)\nrest")
        self.assertEqual(fixed, ["plan line names dev <sha>"])

    def test_dev_sha_in_backticks_becomes_dev_sha(self):
        body, fixed = sifter.sift("PLAN READY (facts read on dev `b1933cf`; Run lines run once)")
        self.assertEqual(body, "PLAN READY (facts read on dev b1933cf; Run lines run once)")
        self.assertEqual(len(fixed), 1)

    def test_a_correct_line_and_a_body_without_a_plan_line_stay_as_they_are(self):
        for text in ("PLAN READY (facts read on dev 9833218)\nsee dev at 1234567", "no plan line, dev at 1234567", "", None):
            self.assertEqual(sifter.sift(text), (text, []))


class Intake(Base):
    def test_intake_writes_the_sifted_plan_line_back_and_starts_the_job(self):
        self.w.issues[0]["body"] = "PLAN READY (facts read on dev at 946e5ce)\n" + ready()
        self.tick()
        edits = [c for c in self.w.gh_calls if c[:3] == ["issue", "edit", "5"] and "--body" in c]
        self.assertEqual(len(edits), 1)
        self.assertTrue(edits[0][edits[0].index("--body") + 1].startswith("PLAN READY (facts read on dev 946e5ce)\n"))
        self.assertEqual(self.state(), "building")
        self.assertIn("sifted: plan line names dev <sha>", self.out.getvalue())

    def test_an_issue_whose_job_is_in_flight_is_not_rewritten(self):
        self.tick()
        self.assertEqual(self.state(), "building")
        self.w.issues[0]["body"] = "PLAN READY (facts read on dev at 946e5ce)\n" + ready()
        self.tick()
        self.assertEqual([c for c in self.w.gh_calls if c[:3] == ["issue", "edit", "5"] and "--body" in c], [])

    def test_the_beat_line_counts_issues_still_unreadable(self):
        self.w.issues[0]["body"] = "PLAN READY (facts read on main)\n" + ready()
        self.tick(2)
        line = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        self.assertTrue(line.endswith(" | unreadable 1"), line)


if __name__ == "__main__":
    unittest.main()
