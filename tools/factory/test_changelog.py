import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import changelog as C
import store as S


def ended(ids, start=0):
    return [{"job": i, "started": start + i * 10, "ended": start + i * 10 + 5} for i in ids]


class TestChangelog(unittest.TestCase):
    def test_rate_is_events_of_the_group_per_twenty_jobs(self):
        jobs = list(range(20))
        ev = [{"job": 1, "group": "g"}, {"job": 2, "group": "g"}, {"job": 3, "group": "g"},
              {"job": 4, "group": "other"}, {"job": 99, "group": "g"}]
        self.assertEqual(C.rate(ev, jobs, "g"), 3.0)
        self.assertEqual(C.rate([{"job": 1, "group": "g"}], list(range(10)), "g"), 2.0)
        self.assertIsNone(C.rate(ev, [], "g"))

    def test_duplicate_job_ids_count_once(self):
        self.assertEqual(C.rate([{"job": 1, "group": "g"}], [1, 1] + list(range(2, 21)), "g"), 1.0)

    def test_before_takes_the_last_twenty_jobs_ended_by_then(self):
        e = ended(range(1, 31))
        self.assertEqual(C.before(e, 30 * 10 + 5), list(range(11, 31)))
        self.assertEqual(C.before(e, 3 * 10 + 5), [1, 2, 3])
        self.assertEqual(C.before(e, 3 * 10 + 4), [1, 2])

    def test_after_needs_twenty_jobs_started_and_ended_since_the_change_went_live(self):
        e = ended(range(1, 41))
        live = 11 * 10
        self.assertEqual(C.after(e, live, 31 * 10 + 5), list(range(11, 31)))
        self.assertIsNone(C.after(e, live, 30 * 10 + 4))
        self.assertIsNone(C.after(e, live, 0))
        self.assertIsNone(C.after(e[:29], live, 10 ** 9))
        self.assertEqual(C.after(e, live - 1, 10 ** 9), list(range(11, 31)))

    def test_only_a_lower_rate_keeps_the_change(self):
        self.assertEqual(C.verdict(3.0, 1.0), "kept")
        self.assertEqual(C.verdict(3.0, 3.0), "revert")
        self.assertEqual(C.verdict(0.0, 0.0), "revert")
        self.assertEqual(C.verdict(1.0, 3.0), "revert")
        self.assertEqual(C.verdict(None, 0.0), "revert")
        self.assertEqual(C.verdict(2.0, None), "revert")


class TestChangesTable(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.s = S.Store(os.path.join(self.d.name, "ledger.db"))

    def tearDown(self):
        self.s.close()
        self.d.cleanup()

    def test_a_change_is_a_row_with_its_group_and_rate_before(self):
        cid = self.s.add_change(7, "stuck-ci", "repo", 2.5, at="2026-11-16T10:00:00Z")
        self.assertEqual(self.s.changes(), [{
            "id": cid, "at": "2026-11-16T10:00:00Z", "issue": 7, "grp": "stuck-ci", "kind": "repo",
            "before": 2.5, "live_at": None, "after": None, "verdict": None, "revert": None, "told": 0}])

    def test_the_rate_after_the_verdict_and_the_revert_issue_are_written_later(self):
        a = self.s.add_change(1, "g", "repo", 3.0)
        b = self.s.add_change(2, "g", "instructions", None)
        self.s.set_change(a, live_at=100.0, after=3.0, verdict="revert", revert=55, told=1)
        rows = self.s.changes()
        self.assertEqual([r["id"] for r in rows], [a, b])
        self.assertEqual((rows[0]["live_at"], rows[0]["after"], rows[0]["verdict"], rows[0]["revert"], rows[0]["told"]),
                         (100.0, 3.0, "revert", 55, 1))
        self.assertIsNone(rows[1]["before"])

    def test_an_unknown_column_is_refused(self):
        a = self.s.add_change(1, "g", "repo", 1.0)
        with self.assertRaises(ValueError):
            self.s.set_change(a, grp="x")
        with self.assertRaises(ValueError):
            self.s.set_change(a, after=1.0, id=9)


if __name__ == "__main__":
    unittest.main()
