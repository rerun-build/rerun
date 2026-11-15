import contextlib, io, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D


class Reconcile(unittest.TestCase):
    def make(self, closed=(), prs=None, refs=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.calls = []
        self.closed = list(closed)
        self.prs = prs or {}
        self.refs = refs or {}

        def gh(args):
            self.calls.append(args)
            if args[:2] == ["issue", "list"]:
                if "closed" in args:
                    return json.dumps([{"number": n} for n in self.closed])
                return "[]"
            if args[:2] == ["pr", "view"]:
                return json.dumps({"state": self.prs.get(int(args[2]), "OPEN")})
            if args[:2] == ["issue", "view"]:
                return json.dumps({"closedByPullRequestsReferences": [{"number": n} for n in self.refs.get(int(args[2]), [])]})
            return "[]"

        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"), "json_state_file": os.path.join(tmp.name, "d.json"),
               "heartbeat_file": os.path.join(tmp.name, "hb"),
               "builders": [{"id": "b1", "name": "B1"}], "reviewers": [{"id": "r1", "name": "R1"}]}
        self.d = D.Dispatcher(cfg, lambda t, a, timeout=30: {}, gh, now=lambda: 1794000000.0)
        self.addCleanup(self.d.close)

    def seed(self, n, state="blocked", pr=None, relabelled=True):
        j = {"issue": n, "title": "t", "body": "", "state": state, "round": 1, "worker": "coder", "paths": [], "test": "x",
             "relabelled": relabelled, "commented": True}
        if pr:
            j["pr"] = pr
        self.d.store.put_job(str(n), state, j, "seed")

    def once(self, n=1):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            for _ in range(n):
                self.d.once()
        return out.getvalue()

    def count(self, *head, extra=None):
        return len([c for c in self.calls if c[:len(head)] == list(head) and (extra is None or extra in c)])

    def state(self, n):
        return self.d.store.transitions_of(str(n))

    def job(self, n):
        return [j for j in self.d.jobs() if j["issue"] == n][0]

    def test_closed_issue_with_a_merged_pr_ends_merged_with_a_transition(self):
        self.make([5], {9: "MERGED"})
        self.seed(5, "blocked", pr=9)
        text = self.once(10)
        self.assertEqual(self.job(5)["state"], "merged")
        t = self.state(5)[-1]
        self.assertEqual((t["from_state"], t["to_state"]), ("blocked", "merged"))
        self.assertIn("merged outside the delegator", t["reason"])
        self.assertEqual(text.count("merged outside the delegator"), 1)
        self.assertEqual(self.count("issue", "comment"), 0)
        self.assertEqual(self.count("issue", "edit"), 0)

    def test_closed_issue_with_an_unmerged_pr_keeps_its_state_and_is_not_read_again(self):
        self.make([5], {9: "CLOSED"})
        self.seed(5, "failed", pr=9)
        self.once(10)
        self.assertEqual(self.job(5)["state"], "failed")
        self.assertEqual(self.count("pr", "view"), 1)
        n = len(self.state(5))
        self.once(10)
        self.assertEqual(self.count("pr", "view"), 1)
        self.assertEqual(self.job(5)["state"], "failed")
        self.assertEqual(len(self.state(5)), n)

    def test_a_closed_job_without_a_pr_skips_the_pr_view(self):
        self.make([5])
        self.seed(5, "returned")
        self.once(10)
        self.assertEqual(self.count("pr", "view"), 0)
        self.assertEqual(self.job(5)["state"], "returned")
        self.assertIn("closed_seen", self.d.store.get_all("5"))

    def test_an_open_issue_is_untouched(self):
        self.make([], {9: "MERGED"})
        self.seed(5, "blocked", pr=9)
        self.once(10)
        self.assertEqual(self.job(5)["state"], "blocked")
        self.assertEqual(self.count("pr", "view"), 0)

    def test_a_live_job_on_a_closed_issue_with_a_merged_pull_request_ends_merged(self):
        self.make([5], {9: "MERGED"})
        self.seed(5, "queued", pr=9)
        self.once(10)
        self.assertEqual(self.job(5)["state"], "merged")
        self.assertEqual(self.d.store.transitions_of("5")[-1]["reason"], "merged: merged outside the delegator")
        self.assertEqual(self.count("pr", "view"), 1)

    def test_the_pass_runs_only_every_10th_beat_with_one_closed_list(self):
        self.make([5])
        self.seed(5, "blocked")
        self.seed(6, "blocked")
        self.once(9)
        self.assertEqual(self.count("issue", "list", extra="closed"), 0)
        self.once(1)
        self.assertEqual(self.count("issue", "list", extra="closed"), 1)
        self.once(10)
        self.assertEqual(self.count("issue", "list", extra="closed"), 2)

    def test_no_candidate_means_no_closed_list(self):
        self.make([5])
        self.seed(5, "blocked", relabelled=False)
        self.d.store.put_job("5", "merged", {"issue": 5, "state": "merged", "relabelled": True, "commented": True}, "seed")
        self.once(10)
        self.assertEqual(self.count("issue", "list", extra="closed"), 0)

    def test_at_most_20_jobs_change_in_one_pass(self):
        self.make(range(100, 125))
        for n in range(100, 125):
            self.seed(n, "blocked")
        self.once(10)
        seen = [n for n in range(100, 125) if "closed_seen" in self.d.store.get_all(str(n))]
        self.assertEqual(len(seen), 20)


    def test_a_closed_job_without_a_pr_on_record_takes_the_merged_pr_that_closed_the_issue(self):
        self.make([5], {9: "MERGED"}, {5: [9]})
        self.seed(5, "returned")
        self.once(10)
        self.assertEqual(self.job(5)["state"], "merged")
        self.assertEqual(self.job(5)["pr"], 9)
        self.assertEqual(self.state(5)[-1]["reason"], "merged: merged outside the delegator (#9)")

    def test_a_job_already_closed_seen_is_checked_once_and_leaves_the_problem_count(self):
        self.make([5, 6], {9: "MERGED", 10: "CLOSED"}, {5: [9], 6: [10]})
        self.seed(5, "returned")
        self.seed(6, "returned")
        self.d.store.set("5", "closed_seen", 1)
        self.d.store.set("6", "closed_seen", 1)
        self.once(10)
        self.assertEqual(self.job(5)["state"], "merged")
        self.assertEqual(self.job(6)["state"], "returned")
        self.assertEqual(self.count("issue", "view"), 2)
        self.once(10)
        self.assertEqual(self.count("issue", "view"), 2)


if __name__ == "__main__":
    unittest.main()
