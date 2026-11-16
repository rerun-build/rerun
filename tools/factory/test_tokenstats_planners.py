import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store
import tokenstats

NOW = 1000


def job(parent, first, states, state, replans=0):
    return {"parent": parent, "first": first, "states": states, "state": state, "replans": replans}


def fire(parent, coworker, at):
    return {"parent": parent, "coworker": coworker, "at": at}


CLEAN = ["queued", "building", "merged"]


class Planners(unittest.TestCase):
    def test_jobs_are_counted_under_the_planner_whose_run_cut_them(self):
        fires = [fire(9, "IKE", 100), fire(9, "Boss", 500)]
        jobs = [job(9, 300, CLEAN, "merged"), job(9, 700, CLEAN, "merged")]
        rows = tokenstats.planners(jobs, fires, NOW)
        self.assertEqual([(r["planner"], r["cut"]) for r in rows], [("Boss", 1), ("IKE", 1)])

    def test_a_job_without_a_plan_run_goes_to_the_dash(self):
        rows = tokenstats.planners([job(None, 300, CLEAN, "merged"), job(9, 300, CLEAN, "merged")], [fire(9, "IKE", 400)], NOW)
        self.assertEqual([(r["planner"], r["cut"]) for r in rows], [("-", 2)])

    def test_a_job_first_seen_before_the_window_is_left_out(self):
        rows = tokenstats.planners([job(9, 10, CLEAN, "merged")], [fire(9, "IKE", 1)], 10 + 7 * 86400 + 1)
        self.assertEqual(rows, [])

    def test_first_pass_needs_no_fix_round_and_no_re_plan(self):
        jobs = [job(9, 300, CLEAN, "merged"), job(9, 300, ["queued", "fix_wait", "merged"], "merged"),
                job(9, 300, CLEAN, "merged", replans=1)]
        row = tokenstats.planners(jobs, [fire(9, "IKE", 100)], NOW)[0]
        self.assertEqual((row["merged"], row["firstPass"], row["firstPassYield"], row["replans"]), (3, 1, 1 / 3, 1))

    def test_stopped_counts_a_job_once(self):
        row = tokenstats.planners([job(9, 300, ["queued", "returned", "rejected"], "rejected")], [fire(9, "IKE", 100)], NOW)[0]
        self.assertEqual(row["stopped"], 1)

    def test_nothing_merged_gives_no_yield(self):
        row = tokenstats.planners([job(9, 300, ["queued"], "queued")], [fire(9, "IKE", 100)], NOW)[0]
        self.assertEqual((row["merged"], row["firstPassYield"]), (0, None))


class DigestPlanners(unittest.TestCase):
    def test_the_digest_carries_planners_from_the_store(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(st.db.close)
        now = limits.ts("2026-11-15T12:00:00Z")
        st.intent("plan:9", "", "plan", coworker="IKE", at="2026-11-15T08:00:00Z")
        data = {"issue": 61, "title": "T", "body": "**Part of**: #9\n**Depends on**: none\n"}
        st.put_job("61", "queued", data, "r", at="2026-11-15T09:00:00Z")
        st.put_job("61", "merged", data, "r", at="2026-11-15T10:00:00Z")
        rows = digest.build(st, {}, now)["planners"]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["planner"], rows[0]["cut"], rows[0]["merged"], rows[0]["firstPass"]), ("IKE", 1, 1, 1))


if __name__ == "__main__":
    unittest.main()
