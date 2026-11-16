import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, ready, PR_LINE


def issue(n):
    return {"number": n, "title": "t%d" % n, "body": ready(), "comments": []}


class Strikes(Base):
    def fail_twice(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.assertEqual(self.state(), "failed")

    def test_two_failed_runs_in_a_row_hold_the_coworker_and_the_next_job_goes_to_another(self):
        self.fail_twice()
        self.assertIn("coworker B1 held", self.out.getvalue())
        self.w.issues.append(issue(6))
        self.tick()
        self.assertEqual(self.w.sends[-1][0], "b2")
        self.assertEqual(self.state(6), "building")

    def test_the_hold_ends_after_the_declared_time(self):
        self.cfg["strike_hold_s"] = 300
        self.fail_twice()
        self.w.clock += 299
        self.w.issues.append(issue(6))
        self.tick()
        self.assertEqual(self.w.sends[-1][0], "b2")
        self.w.clock += 2
        self.w.issues.append(issue(7))
        self.tick()
        self.assertEqual(self.w.sends[-1][0], "b1")

    def test_the_limit_is_declared_in_the_settings(self):
        self.cfg["strike_limit"] = 3
        self.fail_twice()
        self.w.issues.append(issue(6))
        self.tick()
        self.assertEqual(self.w.sends[-1][0], "b1")

    def test_a_done_run_between_failures_resets_the_count(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick(2)
        self.w.issues.append(issue(6))
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick(2)
        self.w.issues.append(issue(7))
        self.tick()
        self.assertEqual(self.w.sends[-1][0], "b1")

    def test_the_hold_survives_a_restart(self):
        self.fail_twice()
        self.w.issues.append(issue(6))
        self.tick(fresh=True)
        self.assertEqual(self.w.sends[-1][0], "b2")


class OnlyOneCoworker(Base):
    builders = ["b1"]

    def test_a_queued_job_shows_which_coworker_is_held(self):
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.w.finish("b1", None, status="error")
        self.tick()
        self.w.issues.append(issue(6))
        self.tick()
        self.assertEqual(self.state(6), "queued")
        self.assertEqual(self.d.store.get_job("6")["wait_reason"], "coworker held: B1 (2 failed runs in a row)")
        self.assertEqual(len(self.w.sends), 2)


if __name__ == "__main__":
    unittest.main()
