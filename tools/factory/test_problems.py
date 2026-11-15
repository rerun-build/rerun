import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import problems
from test_dispatch import Base, ready, D


def job(n, state, **kw):
    return dict({"issue": n, "state": state}, **kw)


class Find(unittest.TestCase):
    def find(self, w, jobs=(), refused=None, open_issues=None, line="L", now=0.0, texts=(), since="", held=False):
        return w.find(list(jobs), refused or {}, open_issues, line, now, list(texts), since, held)

    def test_only_a_job_that_ended_since_the_watch_began_is_a_problem(self):
        jobs = [job(1, "blocked", reason="old", updated_at="2026-11-15T10:00:00Z"),
                job(2, "failed", reason="new", updated_at="2026-11-15T12:00:00Z")]
        got = self.find(problems.Watch(), jobs, open_issues={1, 2}, since="2026-11-15T11:00:00Z")
        self.assertEqual(sorted(got), ["ended #2"])

    def test_no_idle_line_while_a_hold_stops_all_sending(self):
        w = problems.Watch()
        for _ in range(12):
            got = self.find(w, [job(5, "queued")], held=True)
        self.assertEqual(got, {})

    def test_a_refused_issue_is_a_problem_with_its_cutshape_errors(self):
        got = self.find(problems.Watch(), refused={5: ["plan line: bad", "files: no **Files** heading"]})
        self.assertEqual(got, {"unreadable #5": "plan line: bad\nfiles: no **Files** heading"})

    def test_a_waiting_job_with_dead_dependencies_is_a_problem_with_its_wait_line(self):
        jobs = [job(6, "waiting", dead=[[532, "rejected"]], wait_line="waits on dead #532 (rejected)"), job(7, "waiting")]
        self.assertEqual(self.find(problems.Watch(), jobs), {"dead #6": "waits on dead #532 (rejected)"})

    def test_a_job_that_ended_blocked_failed_or_rejected_on_an_open_issue_is_a_problem(self):
        jobs = [job(1, "blocked", reason="BLOCKED: plan: x", pr=40), job(2, "failed", reason="merge refused"),
                job(3, "rejected", reason="VERDICT: REJECT @abc: y", pr=41), job(4, "returned", reason="r"),
                job(8, "merged"), job(9, "blocked", reason="closed one")]
        got = self.find(problems.Watch(), jobs, open_issues={1, 2, 3, 4, 8})
        self.assertEqual(got, {"ended #1": "job #1 ended blocked: BLOCKED: plan: x; pull request #40",
                               "ended #2": "job #2 ended failed: merge refused; pull request none",
                               "ended #3": "job #3 ended rejected: VERDICT: REJECT @abc: y; pull request #41"})
        self.assertEqual(self.find(problems.Watch(), jobs, open_issues=None), {})

    def test_the_line_is_idle_after_ten_beats_with_work_and_no_run_and_keeps_the_first_line(self):
        w = problems.Watch()
        queued = [job(5, "queued")]
        for n in range(1, 10):
            self.assertEqual(self.find(w, queued, line="beat %d" % n), {})
        self.assertEqual(self.find(w, queued, line="beat 10"), {"idle line": "no run in flight for 10 beats while work waits; beat line: beat 10"})
        self.assertEqual(self.find(w, queued, line="beat 11"), {"idle line": "no run in flight for 10 beats while work waits; beat line: beat 10"})
        self.assertEqual(self.find(w, queued + [job(6, "building", agent="b1")], line="beat 12"), {})
        for n in range(9):
            self.assertNotIn("idle line", self.find(w, queued, line="x"))

    def test_unreadable_or_dead_work_counts_as_work_for_the_idle_line_and_an_empty_queue_does_not(self):
        w, empty = problems.Watch(), problems.Watch()
        for _ in range(10):
            got = self.find(w, refused={5: ["e"]})
            self.find(empty, [job(7, "merged")])
        self.assertIn("idle line", got)
        self.assertEqual(self.find(empty, [job(7, "merged")]), {})

    def test_the_same_pass_error_five_times_within_an_hour_is_a_problem_and_it_ages_out(self):
        w = problems.Watch()
        for t in range(4):
            self.assertEqual(self.find(w, now=t * 600.0, texts=["reconcile: gh issue view failed", "other"][:1 + (t == 0)]), {})
        got = self.find(w, now=2400.0, texts=["reconcile: gh issue view failed"])
        self.assertEqual(got, {"repeating error": "reconcile: gh issue view failed (5 times in the last hour)"})
        self.assertEqual(self.find(w, now=3000.0), got)
        self.assertEqual(self.find(w, now=3700.0), {})


class Heard(Base):
    def test_pass_level_log_lines_are_collected_and_a_new_dispatcher_starts_empty(self):
        D.log("-", "left over")
        self.tick()
        D.log("-", "intake: boom")
        D.log(5, "per item")
        self.assertEqual(D.HEARD, ["intake: boom"])
        self.close()
        self.new().close()
        self.assertEqual(D.HEARD, [])

    def test_intake_keeps_the_cutshape_errors_of_each_refused_issue(self):
        self.w.issues.append({"number": 6, "title": "bad", "body": ready().replace("**Files**", "Files"), "comments": []})
        self.tick()
        self.assertEqual(sorted(self.d.refused), [6])
        self.assertIn("files: no **Files** heading", self.d.refused[6])
        self.assertEqual(self.d.unreadable, 1)


if __name__ == "__main__":
    unittest.main()
