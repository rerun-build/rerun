import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labelcheck


def issue(n, *labels, title="t"):
    return {"number": n, "title": title, "labels": [{"name": x} for x in labels]}


def job(state, relabelled=True):
    return {"state": state, "data": json.dumps({"relabelled": relabelled}), "updated_at": "2026-11-19T00:00:00Z"}


def data(jobs=None, kv=None):
    return {"jobs": jobs or {}, "kv": kv or {}}


def row(n, status, station="job"):
    return {"issue": str(n), "station": station, "handover": {"status": status}}


class Check(unittest.TestCase):
    def test_a_plan_label_with_no_live_plan_is_drift(self):
        d = data(kv={"plan:2": {"state": "planning"}, "plan:3": {"state": "blocked"}, "plan:8": {"state": "unsent"},
                     "plan:9": {"state": "planned"}})
        issues = [issue(n, "factory-plan") for n in (1, 2, 3, 8, 9)]
        self.assertEqual(labelcheck.check(issues, d, [])["plan_label_no_plan"], [1, 3, 8])

    def test_a_ready_label_left_on_a_relabelled_job_is_drift_and_waiting_ones_are_counted(self):
        d = data(jobs={"4": job("merged"), "5": job("building"), "25": job("blocked")})
        issues = [issue(4, "factory", "factory-done"), issue(5, "factory"), issue(6, "factory"),
                  issue(26, "factory", "factory-paused"), issue(25, "factory")]
        out = labelcheck.check(issues, d, [])
        self.assertEqual((out["ready_label_ended_job"], out["ready_waiting"], out["ended_unlabelled"]), ([4], 1, []))

    def test_a_parked_issue_with_a_station_run_is_drift_but_a_queued_or_finishing_build_is_not(self):
        rows = [row(7, "taken", "plan"), row(8, "sent"), row(9, "taken")]
        out = labelcheck.check([issue(7, "factory-paused"), issue(8, "factory-paused"), issue(9, "factory-paused")], data(), rows)
        self.assertEqual(out["parked_but_moving"], [7])

    def test_a_blocked_job_whose_parent_was_replanned_and_cut_is_not_drift(self):
        d = data(jobs={"30": job("blocked")}, kv={"plan:30": {"state": "cut"}, "plan:31": {"state": "blocked"}})
        d["jobs"]["31"] = job("blocked")
        out = labelcheck.check([issue(30), issue(31)], d, [])
        self.assertEqual(out["ended_unlabelled"], [{"issue": 31, "want": "factory-blocked"}])

    def test_a_parked_ended_issue_is_not_drift(self):
        d = data(jobs={"673": job("blocked")})
        self.assertEqual(labelcheck.check([issue(673, "factory-paused")], d, [])["ended_unlabelled"], [])

    def test_an_ended_job_not_yet_relabelled_is_not_drift(self):
        d = data(jobs={"27": job("blocked", relabelled=False)})
        self.assertEqual(labelcheck.check([issue(27)], d, [])["ended_unlabelled"], [])

    def test_duplicate_gap_issues_keep_the_newest(self):
        issues = [issue(10, title="Gaps of #5: a"), issue(12, title="Gaps of #5: b"), issue(11, title="Gaps of #5: c"),
                  issue(13, title="Gaps of #6: d")]
        self.assertEqual(labelcheck.check(issues, data(), [])["duplicate_gaps"], [{"parent": 5, "keep": 12, "older": [10, 11]}])

    def test_an_open_ended_issue_without_its_end_label_is_drift(self):
        d = data(jobs={"20": job("blocked"), "21": job("blocked"), "22": job("unsolvable"), "23": job("merged"),
                       "24": job("merged")})
        issues = [issue(20), issue(21, "factory-blocked"), issue(22, "factory-blocked"), issue(23), issue(24, "factory-done")]
        self.assertEqual(labelcheck.check(issues, d, [])["ended_unlabelled"],
                         [{"issue": 20, "want": "factory-blocked"}, {"issue": 22, "want": "factory-unsolvable"},
                          {"issue": 23, "want": "factory-done"}])

    def test_every_list_is_capped_and_counts_what_it_left_out(self):
        issues = [issue(i, "factory-plan") for i in range(labelcheck.CAP + 3)]
        out = labelcheck.check(issues, data(), [])
        self.assertEqual((len(out["plan_label_no_plan"]), out["more"]["plan_label_no_plan"]), (labelcheck.CAP, 3))


class Fix(unittest.TestCase):
    def setUp(self):
        import tempfile
        from store import Store
        self.s = Store(os.path.join(tempfile.mkdtemp(), "f.db"))
        self.addCleanup(self.s.close)
        self.calls = []

    def gh(self, args):
        self.calls.append(args)
        return ""

    def test_a_stray_plan_label_comes_off_once(self):
        drift = {"plan_label_no_plan": [3, 4]}
        self.assertEqual(labelcheck.fix(self.gh, "o/r", self.s, drift), [{"issue": 3, "did": "removed factory-plan"},
                                                                          {"issue": 4, "did": "removed factory-plan"}])
        self.assertEqual(self.calls[0], ["issue", "edit", "3", "-R", "o/r", "--remove-label", "factory-plan"])
        self.assertEqual(labelcheck.fix(self.gh, "o/r", self.s, drift), [])
        self.assertEqual(len(self.calls), 2)

    def test_at_most_a_few_fixes_per_post(self):
        drift = {"plan_label_no_plan": list(range(1, 20))}
        self.assertEqual(len(labelcheck.fix(self.gh, "o/r", self.s, drift)), labelcheck.FIXES)

    def test_a_refused_edit_is_tried_again_a_few_times_then_left(self):
        def gh(args):
            raise RuntimeError("no")
        drift = {"plan_label_no_plan": [5]}
        for _ in range(labelcheck.TRIES):
            self.assertEqual(labelcheck.fix(gh, "o/r", self.s, drift),
                             [{"issue": 5, "did": "could not remove factory-plan: RuntimeError"}])
        self.assertEqual(labelcheck.fix(self.gh, "o/r", self.s, drift), [])

    def test_a_refused_edit_that_works_next_time_is_done(self):
        def gh(args):
            raise RuntimeError("no")
        drift = {"plan_label_no_plan": [6]}
        labelcheck.fix(gh, "o/r", self.s, drift)
        self.assertEqual(labelcheck.fix(self.gh, "o/r", self.s, drift), [{"issue": 6, "did": "removed factory-plan"}])
        self.assertEqual(labelcheck.fix(self.gh, "o/r", self.s, drift), [])


class Read(unittest.TestCase):
    def test_reads_open_issues_with_labels_in_one_call(self):
        calls = []

        def gh(args):
            calls.append(args)
            return json.dumps([issue(1, "factory")])
        self.assertEqual(labelcheck.read(gh, "o/r")[0]["number"], 1)
        self.assertEqual(len(calls), 1)
        self.assertIn("--state", calls[0])
        self.assertEqual(calls[0][calls[0].index("--state") + 1], "open")


if __name__ == "__main__":
    unittest.main()
