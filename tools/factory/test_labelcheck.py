import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labelcheck


def issue(n, *labels, title="t", body=""):
    return {"number": n, "title": title, "body": body, "labels": [{"name": x} for x in labels]}


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


class Gaps(unittest.TestCase):
    DUP = {"duplicate_gaps": [{"parent": 5, "keep": 12, "older": [10, 11]}]}
    KEPT = "**Part of**: #5\n**Repairs**: #7\n**Repairs**: #8\n"

    def setUp(self):
        Fix.setUp(self)
        self.bodies = {12: self.KEPT, 10: "**Part of**: #5\n**Repairs**: #7\n", 11: "**Part of**: #5\n**Repairs**: #8\n"}

    def gh(self, args):
        self.calls.append(args)
        if args[:2] == ["issue", "view"]:
            return json.dumps({"body": self.bodies.get(int(args[2]), "**Part of**: #5\n**Repairs**: #7\n")})
        return ""

    def closes(self):
        return [c for c in self.calls if c[:2] == ["issue", "close"]]

    def run_twice(self, dup=None, d=None, issues=None):
        first = labelcheck.close_gaps(self.gh, "o/r", self.s, dup or self.DUP, d or data(), issues=issues)
        return first, labelcheck.close_gaps(self.gh, "o/r", self.s, dup or self.DUP, d or data(), issues=issues)

    def test_the_first_sight_is_a_dry_run_and_the_next_closes_once_as_not_planned(self):
        first, second = self.run_twice()
        self.assertEqual([x["did"] for x in first], ["would close", "would close"])
        self.assertEqual([x["did"] for x in second], ["closed", "closed"])
        c = self.closes()[0]
        self.assertEqual(c[:5], ["issue", "close", "10", "-R", "o/r"])
        self.assertEqual(c[c.index("--reason") + 1], "not planned")
        self.assertIn("#12", " ".join(c))
        self.assertEqual(labelcheck.close_gaps(self.gh, "o/r", self.s, self.DUP, data()), [])
        self.assertEqual(len(self.closes()), 2)

    def test_an_older_gap_issue_with_work_of_its_own_is_left_open(self):
        d = data(jobs={"10": job("building", relabelled=False)}, kv={"plan:11": {"state": "cut"}})
        self.assertEqual(self.run_twice(d=d), ([], []))
        d = data(kv={"accept:10": {"state": "running"}, "plan:11": {"state": "planning"}})
        self.assertEqual(self.run_twice(d=d), ([], []))
        self.assertEqual(self.closes(), [])

    def test_an_older_one_with_a_repair_the_newest_lacks_is_kept_open(self):
        self.bodies[10] = "**Part of**: #5\n**Repairs**: #9\n"
        first, second = self.run_twice()
        self.assertEqual(first[0], {"issue": 10, "keep": 12, "did": "left open: it lists repairs #9 that #12 does not"})
        self.assertNotIn(10, [x["issue"] for x in second if x["did"] == "closed"])
        self.assertEqual([c[2] for c in self.closes()], ["11"])

    def test_a_kept_issue_not_part_of_the_parent_closes_nothing(self):
        self.bodies[12] = "**Repairs**: #7\n"
        first, second = self.run_twice()
        self.assertTrue(all(x["did"].startswith("left open: #12 does not say") for x in first))
        self.assertEqual(self.closes(), [])

    def test_a_new_kept_issue_or_a_busy_spell_means_a_fresh_dry_run(self):
        labelcheck.close_gaps(self.gh, "o/r", self.s, self.DUP, data())
        self.bodies[13] = self.KEPT
        newer = {"duplicate_gaps": [{"parent": 5, "keep": 13, "older": [10, 11]}]}
        self.assertEqual([x["did"] for x in labelcheck.close_gaps(self.gh, "o/r", self.s, newer, data())], ["would close"] * 2)
        labelcheck.close_gaps(self.gh, "o/r", self.s, newer, data(kv={"plan:10": {"state": "planning"}, "plan:11": {"state": "planning"}}))
        self.assertEqual([x["did"] for x in labelcheck.close_gaps(self.gh, "o/r", self.s, newer, data())], ["would close"] * 2)
        self.assertEqual(self.closes(), [])

    def test_work_is_capped_per_post(self):
        dup = {"duplicate_gaps": [{"parent": 5, "keep": 12, "older": list(range(20, 40))}]}
        first, second = self.run_twice(dup=dup)
        self.assertEqual((len(first), len(second)), (labelcheck.FIXES, labelcheck.FIXES))

    def test_close_gaps_keeps_older_gap_issue_when_repairs_is_none(self):
        dup = {"duplicate_gaps": [{"parent": 1, "keep": 11, "older": [10]}]}
        self.bodies = {10: "**Part of**: #1\n**Repairs**: none\n", 11: "**Part of**: #1\n**Repairs**: #2\n"}
        first, second = self.run_twice(dup=dup)
        self.assertEqual(first, [{"issue": 10, "keep": 11, "did": "left open: it has no **Repairs** numbers to compare"}])
        self.assertEqual(second, [])
        self.assertEqual(self.s.get_all("gapclose:10")["kept"], "1")
        self.assertEqual(self.closes(), [])

    def test_close_gaps_keeps_older_gap_issue_when_headings_differ(self):
        self.bodies[10] = "**Part of**: #5\n## Missing mobile layout\n**Repairs**: #7\n"
        self.bodies[11] = "**Part of**: #5\n## Broken webhook retry\n**Repairs**: #8\n"
        self.bodies[12] = "**Part of**: #5\n## Broken webhook retry\n**Repairs**: #7\n**Repairs**: #8\n"
        first, second = self.run_twice()
        self.assertEqual(first[0], {"issue": 10, "keep": 12, "did": "left open: its gap headings differ from #12"})
        self.assertEqual(self.s.get_all("gapclose:10")["kept"], "1")
        self.assertEqual([c[2] for c in self.closes()], ["11"])
        self.bodies[14] = "**Part of**: #5\n## Missing   Mobile Layout:\n**Repairs**: #7\n"
        self.bodies[15] = self.bodies[10]
        same, closed = self.run_twice(dup={"duplicate_gaps": [{"parent": 5, "keep": 14, "older": [15]}]})
        self.assertEqual(([x["did"] for x in same], [x["did"] for x in closed]), (["would close"], ["closed"]))

    def test_busy_counts_recheck_classify_and_open_children(self):
        for d in (
            data(kv={"recheck:10": {"state": "sending"}, "recheck:11": {"state": "running"}}),
            data(kv={"classify:10": {"state": "running"}, "classify:11": {"run": "run-1"}}),
        ):
            self.assertEqual(self.run_twice(d=d), ([], []))
        self.assertTrue(labelcheck.busy(10, data(kv={"recheck:10": {"state": "sending"}})))
        self.assertTrue(labelcheck.busy(10, data(kv={"recheck:10": {"state": "running"}})))
        self.assertFalse(labelcheck.busy(10, data(kv={"recheck:10": {"state": "fresh"}})))
        self.assertTrue(labelcheck.busy(10, data(kv={"classify:10": {"state": "running"}})))
        self.assertTrue(labelcheck.busy(10, data(kv={"classify:10": {"run": "r1"}})))
        self.assertFalse(labelcheck.busy(10, data(kv={"classify:10": {"run": ""}})))
        kids = [issue(99, body="**Part of**: #10\n"), issue(100, body="Part of #11\n")]
        self.assertTrue(labelcheck.busy(10, data(), kids))
        self.assertFalse(labelcheck.busy(12, data(), kids))
        self.assertEqual(self.run_twice(issues=kids), ([], []))
        self.assertEqual(self.closes(), [])

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
        self.assertEqual(calls[0][calls[0].index("--json") + 1], "number,labels,title,body")

if __name__ == "__main__":
    unittest.main()
