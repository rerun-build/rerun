import contextlib, io, os, re, subprocess, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G

T = "2026-11-10T23:00:00.0000000Z "
NEXT = T + "        FAIL [   0.071s] (  3/9) terminal_commander_daemon bucket_wait::wake_on_match\n" + \
       T + "        PASS [   0.010s] ( 4/9) terminal_commander_core bucket::tests::fills\n"
CARGO = T + "     Running tests/bucket_wait.rs (target/debug/deps/bucket_wait-abc)\n" + T + "test wake_on_match ... FAILED\n" + \
        T + "     Running unittests src/lib.rs (target/debug/deps/x-1)\n" + T + "test bucket::tests::fills ... ok\n"
JEST = T + "PASS packages/a/src/x.spec.ts\n" + T + "FAIL src/y.test.ts\n"
NEXT = T + "        FAIL [   0.071s] (  3/9) terminal_commander_daemon::bucket_wait wake_on_match\n" + \
       T + "        FAIL [   0.010s] ( 4/9) terminal_commander_core bucket::tests::fills\n"
class G_(unittest.TestCase):
    def test_nextest(self):
        r = G.results(NEXT)
        self.assertEqual(r[0][:3], ("nextest-it", "terminal_commander_daemon::bucket_wait::wake_on_match", False))
        self.assertTrue(G.test_hit("crates/daemon/tests/bucket_wait.rs", r[0][1], r[0][0]))
        self.assertFalse(G.test_hit("crates/daemon/tests/other.rs", r[0][1], r[0][0]))
        self.assertFalse(G.test_hit("crates/core/tests/bucket.rs", r[1][1], r[1][0]))
        self.assertTrue(G.test_hit("crates/core/src/bucket.rs", r[1][1], r[1][0]))
        self.assertFalse(G.test_hit("crates/core/src/bucket.rs", r[0][1], r[0][0]))
    def test_cargo(self):
        r = G.results(CARGO)
        self.assertEqual(r[0][:2], ("cargo-it", "bucket_wait::wake_on_match"))
        self.assertTrue(G.test_hit("crates/daemon/tests/bucket_wait.rs", r[0][1], r[0][0]))
        self.assertEqual(r[1][:2], ("cargo-unit", "bucket::tests::fills"))
        self.assertFalse(G.test_hit("crates/tc/tests/bucket.rs", r[1][1], r[1][0]))
    def test_inline_src(self):
        h = G.test_hit
        self.assertTrue(h("crates/core/src/bucket.rs", "terminal_commander_core::bucket::tests::fills", "nextest-unit"))
        self.assertTrue(h("crates/core/src/bucket.rs", "bucket::tests::fills", "cargo-unit"))
        self.assertTrue(h("crates/core/src/a/b.rs", "c::a::b::tests::t", "nextest-unit"))
        self.assertTrue(h("crates/core/src/lib.rs", "c::tests::t", "nextest-unit"))
        self.assertFalse(h("crates/core/src/lib.rs", "c::exec::tests::t", "nextest-unit"))
        self.assertFalse(h("crates/core/src/bucket.rs", "other::tests::fills", "cargo-unit"))
        self.assertFalse(h("crates/core/src/ucket.rs", "bucket::tests::fills", "cargo-unit"))
        self.assertTrue(G.inline_rust_test({"filename": "crates/core/src/bucket.rs", "patch": "@@ -1 +1 @@\n+#[test]\n+fn x(){}"}))
        self.assertFalse(G.inline_rust_test({"filename": "crates/core/src/bucket.rs", "patch": "@@ -1 +1 @@ mod tests {\n mod tests {\n-a\n+b"}))
    def test_done_test_colons(self):
        self.assertTrue(G.same("terminal_commander_daemon::bucket_wait::wake_on_match", "bucket_wait::wake_on_match"))
        self.assertFalse(G.same("a::b::wake_on_match", "wake_on_match") and False)
    def test_jest_unchanged(self):
        r = G.results(JEST)
        self.assertEqual([(x[1], x[2]) for x in r], [("packages/a/src/x.spec.ts", True), ("src/y.test.ts", False)])
        self.assertTrue(G.test_hit("a/src/y.test.ts", "src/y.test.ts", "jest"))
        self.assertFalse(G.test_hit("src/z.test.ts", "src/y.test.ts", "jest"))
class PythonGate(unittest.TestCase):
    def test_test_file_patterns(self):
        for f in ("pkg/test_report.py", "test_x.py", "pkg/report_test.py", "tests/helpers.py", "a/tests/b/c.py"):
            self.assertTrue(re.search(G.TESTF, f), f)
        for f in ("pkg/report.py", "pkg/latest_x.py", "docs/testing.py"):
            self.assertFalse(re.search(G.TESTF, f), f)

    def test_unittest_lines(self):
        T = "2026-11-11T05:10:01.0000000Z "
        log = T + "test_a (pkg.test_m.C.test_a) ... ok\n" + T + "test_b (pkg.test_m.C) ... FAIL\n" + T + "OK\n"
        r = G.results(log)
        self.assertEqual([(x[1], x[2]) for x in r], [("pkg::test_m::C::test_a", True), ("pkg::test_m::C::test_b", False), ("unittest::summary", True)])
        self.assertTrue(G.same(r[0][1], "C::test_a"))
        self.assertTrue(G.test_hit("src/pkg/test_m.py", r[1][1], "unittest"))
        self.assertTrue(G.test_hit("pkg/test_m.py", "test_m::C::test_b", "unittest"))
        self.assertFalse(G.test_hit("pkg/test_n.py", r[1][1], "unittest"))

    def test_import_error_names_module(self):
        r = G.results("2026-11-11T05:10:01.0000000Z ERROR: test_m (unittest.loader._FailedTest.test_m)\n")
        self.assertEqual((r[0][1], r[0][2]), ("test_m::_FailedTest", False))
        self.assertTrue(G.test_hit("pkg/test_m.py", r[0][1], "unittest"))

    def test_done_test_python_file(self):
        self.assertTrue(G.same("tests/test_m.py::C::test_a", "tests/test_m.py"))
        self.assertFalse(G.same("tests/test_mm.py::C::test_a", "tests/test_m.py"))


class ReviewSha(unittest.TestCase):
    HEAD = "abcdef0123456789" + "0" * 24

    def review(self, *extra):
        posted, out = [], io.StringIO()

        def fake_run(cmd, *a, **k):
            posted.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "https://github.com/o/r/pull/9#issuecomment-1\n", "")
        with mock.patch.object(G, "gh_json", lambda path, **k: {"head": {"sha": self.HEAD}}), \
                mock.patch.object(G.subprocess, "run", fake_run), contextlib.redirect_stdout(out):
            code = G.review(["rerun", "9", "ACCEPT", "--as", "linus", "--note", "looks fine"] + list(extra))
        return code, out.getvalue(), [c[c.index("--body") + 1] for c in posted]

    def test_without_sha_posts_as_before(self):
        code, out, bodies = self.review()
        self.assertEqual(code, 0, out)
        self.assertEqual(bodies, ["Review ACCEPT @abcdef01: LINUS ACCEPT @abcdef01: looks fine"])
        self.assertTrue(G.REVIEW_RE.match(bodies[0]))

    def test_a_proof_of_twenty_asks_is_posted_whole(self):
        note = "\n".join("ASK %d: MET tools/factory/planning.py:%d test_number_%d shows it holds for the queue, the copy and the head" % (n, 300 + n, n) for n in range(1, 21))
        posted, out = [], io.StringIO()

        def fake_run(cmd, *a, **k):
            posted.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "https://github.com/o/r/pull/9#issuecomment-1\n", "")
        with mock.patch.object(G, "gh_json", lambda path, **k: {"head": {"sha": self.HEAD}}), \
                mock.patch.object(G.subprocess, "run", fake_run), contextlib.redirect_stdout(out):
            code = G.review(["rerun", "9", "ACCEPT", "--as", "bruce", "--note", note])
        self.assertEqual(code, 0, out.getvalue())
        self.assertGreater(len(note), 1500)
        self.assertTrue(posted[0][posted[0].index("--body") + 1].endswith(note))

    def test_matching_sha_posts(self):
        for sha in (self.HEAD, self.HEAD[:8], self.HEAD[:7].upper()):
            code, out, bodies = self.review("--sha", sha)
            self.assertEqual(code, 0, out)
            self.assertEqual(bodies, ["Review ACCEPT @abcdef01: LINUS ACCEPT @abcdef01: looks fine"])

    def test_moved_head_refuses_and_posts_nothing(self):
        code, out, bodies = self.review("--sha", "1234567890abcdef")
        self.assertNotEqual(code, 0)
        self.assertIn("REFUSED", out)
        self.assertEqual(bodies, [])

    def test_too_short_or_not_hex_sha_refuses(self):
        for sha in ("", "a", "abcdef", "abcdefg1"):
            code, out, bodies = self.review("--sha", sha)
            self.assertNotEqual(code, 0, sha)
            self.assertEqual(bodies, [], sha)


if __name__ == "__main__":
    unittest.main()


H = "abcdef0123456789abcdef0123456789abcdef01"
S8 = H[:8]


def _run_gate(files, comments, roster, builder="code"):
    import tempfile
    calls = []

    def fake(path, paginate=False, jq=".[]"):
        calls.append(path)
        p = path.split("?")[0]
        if p.endswith("/pulls/5"):
            return {"head": {"sha": H, "ref": "chunk/78-O2"}, "base": {"ref": "job/78"}, "body": "Job: special-place-ai-heaven/rerun#78, chunk O2"}
        if p.endswith("/pulls/5/files"):
            return [{"filename": f, "status": "modified", "additions": 1, "deletions": 0} for f in files]
        if p.endswith("/pulls/5/commits"):
            return []
        if p.endswith("/issues/78"):
            return {"body": "- [ ] O2. x | builder: %s | done-test: t | max-lines: 300" % builder}
        if p.endswith("/issues/5/comments"):
            return [{"created_at": "2026-11-12T10:0%d" % i, "html_url": "u/%d" % i, "body": "Review ACCEPT @%s: %s ACCEPT ok" % (S8, who)} for i, who in enumerate(comments)]
        return {"sha": H}

    out = io.StringIO()
    with tempfile.TemporaryDirectory() as td, mock.patch.object(G, "gh_json", fake), mock.patch.object(G, "head_checks", lambda *a: []), \
            mock.patch.object(G.F, "STATE", td), mock.patch.object(G.F, "base_roster", roster), contextlib.redirect_stdout(out):
        G.gate("special-place-ai-heaven/rerun", "5")
    return next(l for l in out.getvalue().splitlines() if l.startswith("REVIEWS ")), calls


def _real_roster(*a):
    import roster as R
    return R.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")).read())


class TestGateRoster(unittest.TestCase):
    def test_pr_editing_roster_judged_by_base(self):
        line, calls = _run_gate(["tools/factory/roster.json"], ["LINUS"], _real_roster)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("BRUCE", line)
        line, calls = _run_gate(["tools/factory/roster.json"], ["LINUS", "BRUCE"], _real_roster)
        self.assertTrue(line.startswith("REVIEWS PASS"), line)
        self.assertFalse([c for c in calls if "roster.json" in c])

    def test_reviews_use_base_roster_when_present(self):
        files = ["apps/engine/src/config/env.ts"]
        line, _ = _run_gate(files, ["MARGARET", "BRUCE"], _real_roster)
        self.assertTrue(line.startswith("REVIEWS PASS"), line)
        line, _ = _run_gate(files, ["LINUS"], _real_roster)
        self.assertIn("MARGARET", line)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)

    def test_reviews_fall_back_to_rules_without_roster(self):
        line, _ = _run_gate(["src/a.ts"], ["LINUS"], lambda *a: None)
        self.assertTrue(line.startswith("REVIEWS PASS"), line)
        line, _ = _run_gate(["src/a.ts"], [], lambda *a: None)
        self.assertIn("LINUS", line)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)

    def test_builder_accept_refused(self):
        line, _ = _run_gate(["src/a.ts"], ["CODE"], lambda *a: None, builder="code")
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("ACCEPT by builder CODE refused", line)
        line, _ = _run_gate(["src/a.ts"], ["CODE"], _real_roster, builder="code")
        self.assertIn("ACCEPT by builder CODE refused", line)

    def test_base_roster_read_error_fails_closed(self):
        def boom(*a):
            raise G.F.RosterError("HTTP 500")
        line, _ = _run_gate(["src/a.ts"], ["LINUS"], boom)
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("failing closed", line)

    def _base(self, answers):
        seen = []

        def fake_run(cmd, **kw):
            seen.append(" ".join(cmd))
            rc, out, err = answers.pop(0)
            return subprocess.CompletedProcess(cmd, rc, out, err)
        with mock.patch.object(G.F.subprocess, "run", fake_run):
            try:
                return G.F.base_roster("special-place-ai-heaven/rerun"), seen
            except G.F.RosterError as e:
                return e, seen

    def test_job_branch_roster_ignored(self):
        text = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")).read()
        got, seen = self._base([(0, "HTTP/2.0 200 OK\nX-A: b\r\n\r\n" + text, "")])
        self.assertTrue(got["areas"])
        self.assertTrue(seen[0].endswith("roster.json?ref=dev"), seen)
        got, seen = self._base([(1, "HTTP/2.0 404 Not Found\nX-A: b\r\n\r\n{}", "gh: Not Found (HTTP 404)"), (0, "main\n", ""), (0, "HTTP/2.0 200 OK\nX-A: b\r\n\r\n" + text, "")])
        self.assertTrue(got["areas"])
        self.assertTrue(seen[2].endswith("roster.json?ref=main"), seen)
        self.assertFalse([s for s in seen if "job/" in s or "chunk/" in s])

    def test_no_roster_anywhere_is_none_and_500_raises(self):
        nf = (1, "HTTP/2.0 404 Not Found\nX-A: b\r\n\r\n{}", "gh: Not Found (HTTP 404)")
        got, _ = self._base([nf, (0, "main\n", ""), nf])
        self.assertIsNone(got)
        got, _ = self._base([(1, "", "HTTP 500")])
        self.assertIsInstance(got, G.F.RosterError)

    def test_absence_is_read_from_the_http_status_line(self):
        text = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")).read()
        got, seen = self._base([(1, "HTTP/2.0 404 Not Found\nX-A: b\r\n\r\n{\"status\":\"404\"}", "gh: Not Found (HTTP 404)"),
                                (0, "main\n", ""), (0, "HTTP/2.0 200 OK\nX-A: b\r\n\r\n" + text, "")])
        self.assertTrue(got["areas"])
        self.assertIn("-i", seen[0].split())
        self.assertIn("-i", seen[2].split())

    def test_not_found_text_under_another_status_fails_closed(self):
        for answer in ((1, "HTTP/2.0 500 Internal Server Error\nX-A: b\r\n\r\nNot Found 404", "gh: Not Found (HTTP 500)"),
                       (1, "", "dial tcp: 404 Not Found"),
                       (1, "HTTP/2.0 403 Forbidden\nX-A: b\r\n\r\n{}", "gh: HTTP 404 Not Found"),
                       (0, "HTTP/2.0 200 OK", "")):
            got, seen = self._base([answer])
            self.assertIsInstance(got, G.F.RosterError, answer)
            self.assertEqual(len(seen), 1, answer)
