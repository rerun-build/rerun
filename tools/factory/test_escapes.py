import datetime, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import escapes as E
import store as S
from test_dispatch import Base, T0


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def job(n, state="merged", merged=T0 - 3600, body=""):
    return {"issue": n, "state": state, "merged_at": merged, "body": body}


class Find(unittest.TestCase):
    def test_repairs_reads_only_the_repairs_line(self):
        body = "Depends on: #4\n**Repairs**: #5, #6\nsee #9 in running text"
        self.assertEqual(E.repairs(body), [5, 6])

    def test_a_merged_issue_that_is_open_again_escaped(self):
        self.assertEqual(E.find([job(5)], {5}, {}, T0), [(5, "reopened")])

    def test_a_later_job_that_names_it_on_a_repairs_line_escaped(self):
        jobs = [job(5), job(9, body="**Repairs**: #5")]
        self.assertEqual(E.find(jobs, set(), {}, T0), [(5, "repair #9")])

    def test_a_number_elsewhere_in_a_body_is_no_repair(self):
        jobs = [job(5), job(9, body="Depends on: #5\nsee #5 in the text")]
        self.assertEqual(E.find(jobs, set(), {}, T0), [])

    def test_a_problem_whose_key_names_the_job_escaped(self):
        problems = {"unreadable #5": {"evidence": "names no job"}, "unreadable #6": {"evidence": "(job #5)"}}
        self.assertEqual(E.find([job(5)], set(), problems, T0), [(5, "problem unreadable #5")])

    def test_dev_red_names_the_job_of_its_merge(self):
        problems = {"dev red": {"evidence": "pull request #5 went red (job #6)\nlog"}}
        self.assertEqual(E.find([job(5), job(6)], set(), problems, T0), [(6, "problem dev red")])
        problems = {"dev red": {"evidence": "pull request #5 went red (job #5)\nlog"}}
        self.assertEqual(E.find([job(5)], set(), problems, T0), [(5, "problem dev red")])

    def test_after_seven_days_nothing_escapes(self):
        old = job(5, merged=T0 - 8 * 24 * 3600)
        self.assertEqual(E.find([old], {5}, {}, T0), [])

    def test_a_job_that_is_not_merged_never_escapes(self):
        self.assertEqual(E.find([job(5, state="blocked")], {5}, {}, T0), [])


class Escapes(Base):
    def merge(self, n, at):
        store = S.Store(self.cfg["ledger_file"])
        store.put_job(str(n), "merged", {"issue": n, "title": "Fix", "body": "", "relabelled": True}, at=iso(at))
        store.close()

    def test_a_reopened_merged_issue_is_recorded_once_with_a_failure_event(self):
        self.w.issues = []
        self.w.open_numbers = {5, 7}
        self.w.clock = T0
        self.merge(5, T0 - 3600)
        self.tick(25)
        self.assertEqual(self.w.rows("SELECT k FROM kv WHERE job='escaped'"), [("5|reopened",)])
        self.assertEqual(self.w.rows("SELECT kind, job, reason FROM failures WHERE kind='escaped'"),
                         [("escaped", "5", "reopened")])

    def test_nothing_is_recorded_and_no_issue_is_listed_when_nothing_merged(self):
        self.w.issues = []
        self.tick(25)
        self.assertEqual(self.w.rows("SELECT k FROM kv WHERE job='escaped'"), [])
        self.assertNotIn(["issue", "list", "-R", "o/r", "--state", "open", "--json", "number", "--limit", "1000"], self.w.gh_calls)


if __name__ == "__main__":
    unittest.main()
