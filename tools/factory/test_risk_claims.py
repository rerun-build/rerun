import contextlib, io, os, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F
import gate as G
import roster as R

H = "abcdef0123456789abcdef0123456789abcdef01"
ROSTER = R.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")).read())


def risk(files, comments=(), other=("deploy/vps/dev-engine-status.sh",)):
    def api(path, *a, **k):
        p = path.split("?")[0]
        if p.endswith("/pulls/5"):
            return {"title": "t", "number": 5, "head": {"sha": H, "ref": "feat/x"}, "body": ""}
        if p.endswith("/pulls/5/files"):
            return [{"filename": f, "additions": 1, "deletions": 0} for f in files]
        if p.endswith("/issues/5/comments"):
            return [{"created_at": "2026-11-12T10:0%d" % i, "body": b} for i, b in enumerate(comments)]
        raise AssertionError(path)

    def gh_json(path, paginate=False, jq=".[]"):
        p = path.split("?")[0]
        if p.endswith("/pulls"):
            return [{"number": 5, "head": {"ref": "feat/x"}}, {"number": 77, "head": {"ref": "engine/y"}}]
        if p.endswith("/pulls/77/files"):
            return [{"filename": f} for f in other]
        if p.endswith("/issues"):
            return []
        raise AssertionError(path)
    out, code = io.StringIO(), 0
    with mock.patch.object(F, "api", api), mock.patch.object(G, "gh_json", gh_json), mock.patch.object(F, "base_roster", lambda full: ROSTER), \
            mock.patch.object(F, "jev_risk", mock.Mock(side_effect=AssertionError("no model"))), contextlib.redirect_stdout(out):
        try:
            F.cmd_risk(["rerun", "5", "--no-jev"])
        except SystemExit as e:
            code = e.code
    return code, out.getvalue().splitlines()


class TestRiskAreas(unittest.TestCase):
    def test_each_reviewer_is_labelled_by_its_own_areas_and_lists_a_file_once(self):
        code, lines = risk(["apps/engine/src/config/auth.ts"], other=())
        self.assertEqual(code, 0, lines)
        got = {l for l in lines if l.startswith("EXTRA REVIEWER ")}
        self.assertEqual(got, {"EXTRA REVIEWER MARGARET: roster owner (area engine-start) (apps/engine/src/config/auth.ts)",
                               "EXTRA REVIEWER BRUCE: roster owner (area engine-start, auth-secrets) (apps/engine/src/config/auth.ts)"})


class TestRiskClaims(unittest.TestCase):
    def test_unacknowledged_claim_is_printed_and_exits_1(self):
        code, lines = risk(["apps/engine/Dockerfile"])
        self.assertIn("CLAIM engine-start: also #77 (needs MARGARET ACCEPT naming #77)", lines)
        self.assertEqual(code, 1, lines)

    def test_owner_accept_naming_the_claim_clears_it(self):
        code, lines = risk(["apps/engine/Dockerfile"], ["Review ACCEPT @%s: MARGARET ACCEPT ok, merges after #77" % H[:8]])
        self.assertIn("CLAIM engine-start: also #77 (cleared by MARGARET)", lines)
        self.assertEqual(code, 0, lines)

    def test_accept_on_an_older_head_does_not_clear(self):
        code, lines = risk(["apps/engine/Dockerfile"], ["Review ACCEPT @0123abcd: MARGARET ACCEPT ok, merges after #77"])
        self.assertIn("CLAIM engine-start: also #77 (needs MARGARET ACCEPT naming #77)", lines)
        self.assertEqual(code, 1, lines)

    def test_no_shared_area_prints_no_claim(self):
        code, lines = risk(["apps/engine/Dockerfile"], other=("docs/a.md", "src/plain.ts"))
        self.assertFalse([l for l in lines if l.startswith("CLAIM ")], lines)
        self.assertEqual(code, 0, lines)


if __name__ == "__main__":
    unittest.main()
