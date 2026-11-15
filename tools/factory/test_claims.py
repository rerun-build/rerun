import os
import unittest
from unittest import mock

import roster as R
from test_roster import PR73

PR77 = ["apps/engine/Dockerfile", "apps/engine/docker-entrypoint.sh", "apps/engine/scripts/entrypoint-selftest-signals.sh",
        "apps/engine/scripts/entrypoint-selftest.sh", "deploy/vps/dev-engine-status.sh"]


def rost():
    return R.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")).read())


def conflicts(ro, files, others, builder="code"):
    return [(a, r, R.owner(ro, a, builder)) for a, refs in R.overlaps(ro, files, others).items() for r in refs]


class TestClaims(unittest.TestCase):
    def setUp(self):
        self.ro = rost()

    def test_replay_73_77_conflict_on_engine_start(self):
        got = R.overlaps(self.ro, PR73, [{"ref": "#77", "files": PR77}])
        self.assertEqual(set(got), {"engine-start"})
        self.assertEqual(got["engine-start"], ["#77"])
        ok, lines = R.claims_check(conflicts(self.ro, PR73, [{"ref": "#77", "files": PR77}]), {})
        self.assertFalse(ok)
        self.assertTrue(lines[0].startswith("CLAIM engine-start: also #77"), lines)

    def test_owner_accept_naming_other_pr_clears(self):
        c = conflicts(self.ro, PR73, [{"ref": "#77", "files": PR77}])
        ok, lines = R.claims_check(c, {"MARGARET": ("ACCEPT", "u", " ok, merges after #77")})
        self.assertTrue(ok, lines)

    def test_accept_without_number_does_not_clear(self):
        c = conflicts(self.ro, PR73, [{"ref": "#77", "files": PR77}])
        for note in (" ok", " ok, after 77", " ok #770", " ok #7"):
            self.assertFalse(R.claims_check(c, {"MARGARET": ("ACCEPT", "u", note)})[0], note)
        self.assertFalse(R.claims_check(c, {"MARGARET": ("REJECT", "u", " #77")})[0])
        self.assertFalse(R.claims_check(c, {"LINUS": ("ACCEPT", "u", " #77")})[0])

    def test_same_job_and_tests_default_do_not_claim(self):
        other = [{"ref": "#9", "files": ["README.md", "x/a.test.ts", "src/plain.ts"]}]
        self.assertEqual(R.overlaps(self.ro, ["docs/a.md", "b/c.spec.ts", "src/other.ts"], other), {})
        import gate

        def fake(path, paginate=False, jq=".[]"):
            p = path.split("?")[0]
            if p.endswith("/pulls"):
                return [{"number": 5, "head": {"ref": "x"}}, {"number": 6, "head": {"ref": "chunk/78-O2"}}, {"number": 77, "head": {"ref": "engine/y"}}]
            if p.endswith("/pulls/77/files"):
                return [{"filename": f} for f in PR77]
            if p.endswith("/issues"):
                return [{"number": 78, "body": "## Chunks\n- [ ] O1. t | builder: code | paths: apps/engine/**"},
                        {"number": 90, "body": "## Chunks\n- [x] A1. t | builder: code | paths: apps/engine/**"},
                        {"number": 91, "pull_request": {}, "body": ""}]
            raise AssertionError(path)
        with mock.patch.object(gate, "gh_json", fake):
            self.assertEqual(gate.open_claims("o/r", "5", "78"), [{"ref": "#77", "files": PR77}])

    def test_job_chunk_glob_claims_area(self):
        got = R.overlaps(self.ro, PR73, [{"ref": "#12", "globs": ["apps/engine/**"]}])
        self.assertEqual(got, {"engine-start": ["#12"]})
        self.assertEqual(R.overlaps(self.ro, PR73, [{"ref": "#12", "globs": ["apps/web/**"]}]), {})

    def test_no_roster_passes(self):
        import gate
        self.assertEqual(gate.claims_line(None, PR73, "code", [{"ref": "#77", "files": PR77}], {}), (True, "no roster"))
