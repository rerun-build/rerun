import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, ready


def closer_of(args):
    return int(next(a for a in args if a.startswith("n="))[2:])


class Guards(Base):
    def seed(self, n, state, **kw):
        j = dict({"issue": n, "title": "t%d" % n, "body": "", "state": state, "round": 1, "worker": "coder",
                  "relabelled": True, "commented": True}, **kw)
        self.d.store.put_job(str(n), state, j, "seed")

    def answer(self, extra):
        base = self.w.gh
        def gh(args):
            got = extra(list(args))
            return base(args) if got is None else got
        self.w.gh = gh
        self.d = self.new()

    def reconcile_beat(self):
        self.d.beats = D.RECONCILE_BEATS - 1
        self.tick()

    def test_one_issue_that_fails_in_intake_does_not_stop_the_next(self):
        self.w.issues.append({"number": 6, "title": "Fix y", "body": ready(), "comments": []})
        def extra(a):
            if a[:3] == ["issue", "view", "5"]:
                raise D.Error("gh issue view failed: exit 1")
        self.answer(extra)
        self.tick()
        self.assertEqual(self.job_ids(), ["6"])
        self.assertEqual(self.state(6), "building")
        self.assertIn("#5 intake: gh issue view failed: exit 1", self.out.getvalue())

    def test_one_pull_request_that_cannot_be_read_does_not_stop_the_lost_job_pass(self):
        self.w.issues.append({"number": 6, "title": "Fix y", "body": ready(), "comments": []})
        def extra(a):
            if a[:3] == ["pr", "view", "41"]:
                raise D.Error("gh pr view failed: exit 1")
            if a[:3] == ["pr", "view", "42"]:
                return json.dumps({"state": "MERGED"})
        self.answer(extra)
        self.seed(5, "fix_wait", pr=41, builder="gone")
        self.seed(6, "fix_wait", pr=42, builder="gone")
        self.reconcile_beat()
        self.assertEqual(self.state(6), "merged")
        self.assertEqual(self.state(5), "fix_wait")
        self.assertIn("#5 stop_lost: gh pr view failed: exit 1", self.out.getvalue())

    def test_one_closed_job_that_cannot_be_read_does_not_stop_reconcile(self):
        self.w.issues = []
        def extra(a):
            if a[:2] == ["issue", "list"] and "closed" in a:
                return json.dumps([{"number": 5}, {"number": 6}])
            if (a[:3] == ["issue", "view", "5"]) or (a[:2] == ["api", "graphql"] and closer_of(a) == 5):
                raise D.Error("gh api graphql failed: exit 1")
            if a[:2] == ["api", "graphql"]:
                return json.dumps([{"number": 9}])
            if a[:3] == ["pr", "view", "9"]:
                return json.dumps({"state": "MERGED"})
        self.answer(extra)
        self.seed(5, "returned")
        self.seed(6, "returned")
        self.reconcile_beat()
        self.assertEqual(self.state(6), "merged")
        self.assertEqual(self.state(5), "returned")
        self.assertIn("#5 reconcile: gh api graphql failed: exit 1", self.out.getvalue())

    def test_the_closing_pull_request_is_read_through_graphql_where_gh_lacks_the_json_field(self):
        self.w.issues = []
        def extra(a):
            if a[:2] == ["issue", "list"] and "closed" in a:
                return json.dumps([{"number": 5}])
            if a[:2] == ["issue", "view"] and "closedByPullRequestsReferences" in a:
                raise D.Error('gh issue view failed: exit 1: Unknown JSON field: "closedByPullRequestsReferences"')
            if a[:2] == ["api", "graphql"] and closer_of(a) == 5:
                return json.dumps([{"number": 9}])
            if a[:3] == ["pr", "view", "9"]:
                return json.dumps({"state": "MERGED"})
        self.answer(extra)
        self.seed(5, "returned")
        self.reconcile_beat()
        self.assertEqual(self.state(5), "merged")
        self.assertIn("merged outside the delegator (#9)", self.out.getvalue())


class GhError(unittest.TestCase):
    TOKEN = "ghp_SECRETtoken0123456789"

    def fail_with(self, stderr):
        class Proc:
            returncode, stdout = 1, ""
        Proc.stderr = stderr
        gh = D.make_gh(self.TOKEN, lambda argv, **kw: Proc())
        with self.assertRaises(D.Error) as got:
            gh(["issue", "view", "5", "--json", "closedByPullRequestsReferences"])
        return str(got.exception)

    def test_a_failed_call_names_the_last_line_gh_wrote(self):
        text = self.fail_with('warning: old\nUnknown JSON field: "closedByPullRequestsReferences"\n\n')
        self.assertEqual(text, 'gh issue view failed: exit 1: Unknown JSON field: "closedByPullRequestsReferences"')

    def test_a_line_that_carries_the_token_is_held_back(self):
        self.assertEqual(self.fail_with("bad credentials " + self.TOKEN + "\n"), "gh issue view failed: exit 1")
        self.assertEqual(self.fail_with("x" * 195 + self.TOKEN + "\n"), "gh issue view failed: exit 1")
        self.assertEqual(self.fail_with(""), "gh issue view failed: exit 1")


if __name__ == "__main__":
    unittest.main()
