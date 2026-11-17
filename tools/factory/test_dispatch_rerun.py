import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, HEAD, wf

RERUN_77 = ["run", "rerun", "77", "-R", "o/r", "--failed"]


class RerunFirst(Base):
    def red_ci(self, rid=77):
        self.w.workflows[HEAD] = [dict(wf("ci", "failure", wid=1), id=rid)]

    def test_the_first_failed_check_of_a_head_runs_its_failed_jobs_again_and_asks_no_builder(self):
        self.to_checks()
        sends = len(self.w.sends)
        self.red_ci()
        self.tick()
        self.assertEqual(self.w.reruns, [RERUN_77])
        self.assertEqual(self.state(), "checks")
        self.assertEqual(len(self.w.sends), sends)

    def test_green_after_the_re_run_merges_and_is_kept_as_a_flaky_check(self):
        self.to_checks()
        self.red_ci()
        self.tick()
        self.w.workflows[HEAD] = [dict(wf("ci", "success", wid=1), id=80)]
        self.tick()
        self.assertEqual(self.state(), "merged")
        self.assertEqual(len(self.w.merges), 1)
        rows = self.w.rows("SELECT kind, station, reason FROM failures ORDER BY id")
        self.assertEqual([(k, s) for k, s, _ in rows], [("flaky check", "checks")])
        self.assertIn("ci", rows[0][2])

    def test_a_second_failure_of_the_same_head_goes_to_the_builder_once(self):
        self.to_checks()
        self.red_ci()
        self.tick()
        self.red_ci(rid=90)
        self.tick()
        self.assertEqual(self.w.reruns, [RERUN_77])
        self.assertEqual(self.state(), "fix_wait")
        kinds = [k for k, _ in self.w.rows("SELECT kind, station FROM failures ORDER BY id")]
        self.assertEqual(kinds, ["ci red after push", "fix round"])
        self.assertIn("GitHub's checks failed", self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])

    def test_only_the_latest_run_of_each_workflow_is_run_again(self):
        self.to_checks()
        self.w.workflows[HEAD] = [
            dict(wf("e2e", "failure", wid=2), id=71),
            dict(wf("ci", "failure", wid=1), id=77),
            dict(wf("ci", "failure", wid=1), id=79),
        ]
        self.tick()
        self.assertEqual(self.w.reruns, [["run", "rerun", "71", "-R", "o/r", "--failed"],
                                         ["run", "rerun", "79", "-R", "o/r", "--failed"]])

    def test_the_wait_after_the_re_run_starts_the_checks_clock_again(self):
        self.to_checks()
        self.w.clock += 50 * 60
        self.red_ci()
        self.tick()
        self.assertEqual(len(self.w.reruns), 1)
        self.w.workflows[HEAD] = [dict(wf("ci", None, status="in_progress", wid=1), id=80)]
        self.w.clock += 50 * 60
        self.tick()
        self.assertEqual(self.state(), "checks")


if __name__ == "__main__":
    unittest.main()
