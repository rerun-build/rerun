import contextlib, io, os, sys, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G
import factory as F

H = "abcdef0123456789abcdef0123456789abcdef01"
S8 = H[:8]
HOME = "special-place-ai-heaven/moldwright"
OTHER = "special-place-ai-heaven/other-project"


def _run_gate(repo, files, comments, roster, builder="code"):
    calls = []

    def fake(path, paginate=False, jq=".[]"):
        calls.append(path)
        p = path.split("?")[0]
        if p.endswith("/pulls/5"):
            return {"head": {"sha": H, "ref": "chunk/78-O2"}, "base": {"ref": "job/78"}, "body": "Job: special-place-ai-heaven/rerun#78, chunk O2"}
        if p.endswith("/pulls/5/files"):
            return [{"filename": f, "status": "modified", "additions": 1, "deletions": 0} for f in files]
        if p.endswith("/pulls/5/commits") or p.endswith("/check-runs"):
            return []
        if p.endswith("/issues/78"):
            return {"body": "- [ ] O2. x | builder: %s | done-test: t | max-lines: 300" % builder}
        if p.endswith("/issues/5/comments"):
            return [{"created_at": "2026-11-12T10:0%d" % i, "html_url": "u/%d" % i, "body": "Review ACCEPT @%s: %s ACCEPT ok" % (S8, who)} for i, who in enumerate(comments)]
        return {"sha": H}

    out = io.StringIO()
    with tempfile.TemporaryDirectory() as td, mock.patch.object(G, "gh_json", fake), \
            mock.patch.object(G.F, "STATE", td), mock.patch.object(G.F, "base_roster", roster), contextlib.redirect_stdout(out):
        G.gate(repo, "5")
    return next(l for l in out.getvalue().splitlines() if l.startswith("REVIEWS ")), calls


def _run_risk(repo, files, roster):
    pr = {"title": "t", "head": {"sha": H, "ref": "chunk/78-O2"}, "base": {"ref": "job/78"}, "body": ""}

    def fake(path, *args, paginate=False):
        if path.endswith("/files?per_page=100"):
            return [{"filename": f, "status": "modified", "additions": 1, "deletions": 0} for f in files]
        return pr

    out = io.StringIO()
    with mock.patch.object(F, "api", fake), mock.patch.object(F, "base_roster", roster), \
            mock.patch.object(F, "home", lambda: HOME), contextlib.redirect_stdout(out):
        F.cmd_risk([repo, "5"])
    return out.getvalue()


def _real_roster(*a):
    import roster as R
    return R.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")).read())


def _no_roster(*a):
    return None


def _unreadable_roster(*a):
    raise F.RosterError("cannot read roster (test)")


class TestGateProject(unittest.TestCase):
    def test_the_home_is_the_repository_of_the_shipped_settings(self):
        self.assertEqual(F.home(), HOME)

    def test_a_project_without_a_roster_needs_the_second_reviewer_on_every_change(self):
        line, _ = _run_gate(OTHER, ["src/a.ts"], ["LINUS"], _no_roster)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("BRUCE", line)
        line, _ = _run_gate(OTHER, ["src/a.ts"], ["LINUS", "BRUCE"], _no_roster)
        self.assertTrue(line.startswith("REVIEWS PASS"), line)

    def test_the_home_without_a_roster_keeps_its_rules(self):
        for home in (HOME, "special-place-ai-heaven/rerun"):
            line, _ = _run_gate(home, ["src/a.ts"], ["LINUS"], _no_roster)
            self.assertTrue(line.startswith("REVIEWS PASS"), (home, line))

    def test_a_project_with_its_own_roster_is_judged_by_it(self):
        line, _ = _run_gate(OTHER, ["apps/engine/src/config/env.ts"], ["LINUS"], _real_roster)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("MARGARET", line)
        line, _ = _run_gate(OTHER, ["apps/engine/src/config/env.ts"], ["MARGARET", "BRUCE"], _real_roster)
        self.assertTrue(line.startswith("REVIEWS PASS"), line)

    def test_risk_of_a_project_without_a_roster_asks_for_the_second_reviewer(self):
        out = _run_risk(OTHER, ["src/a.ts"], _no_roster)
        self.assertIn("EXTRA REVIEWER BRUCE: this project has no roster", out)
        self.assertIn("src/a.ts", out)
        self.assertNotIn("EXTRA REVIEWERS: none", out)

    def test_risk_of_the_home_without_a_roster_adds_no_reviewer(self):
        for home in (HOME, "special-place-ai-heaven/rerun"):
            out = _run_risk(home, ["src/a.ts"], _no_roster)
            self.assertIn("EXTRA REVIEWERS: none. LINUS alone.", out, home)

    def test_a_roster_that_cannot_be_read_still_fails_closed(self):
        line, _ = _run_gate(OTHER, ["src/a.ts"], ["LINUS", "BRUCE"], _unreadable_roster)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("roster unreadable", line)


if __name__ == "__main__":
    unittest.main()
