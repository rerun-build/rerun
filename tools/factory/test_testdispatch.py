import contextlib, io, json, os, subprocess, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F
import gate as G
import testdispatch as D

FULL = "special-place-ai-heaven/testpilot"
HEAD = "abc123" + "0" * 34
SINCE = "2026-11-12T08:00:00Z"


def done(out="", code=0, err=""):
    return subprocess.CompletedProcess([], code, out, err)


class Fake:
    def __init__(self, answer):
        self.calls, self.answer = [], answer

    def __call__(self, cmd, *a, **k):
        self.calls.append(cmd[1:])
        return self.answer(cmd[1:])


def runs(*rows):
    return json.dumps([dict(zip(("databaseId", "headSha", "createdAt", "status", "conclusion"), r), url="https://github.com/r/%d" % r[0]) for r in rows])


class TestDispatch(unittest.TestCase):
    def test_find_run_by_sha(self):
        fake = Fake(lambda c: done(runs((5, "other" + "0" * 35, "2026-11-12T08:03:00Z", "queued", None),
                                        (4, HEAD, "2026-11-12T08:02:00Z", "in_progress", None),
                                        (3, HEAD, "2026-11-12T08:00:00Z", "queued", None),
                                        (2, HEAD, "2026-11-12T07:59:59Z", "completed", "success"))))
        with mock.patch.object(F, "run", fake):
            self.assertEqual(D.find_run(FULL, "chunk/209-1", HEAD, SINCE)["databaseId"], 4)
            self.assertIsNone(D.find_run(FULL, "chunk/209-1", "f" * 40, SINCE))
        self.assertEqual(fake.calls[0], ["run", "list", "-R", FULL, "-w", "one.yml", "-b", "chunk/209-1", "-e", "workflow_dispatch", "-L", "5",
                                         "--json", "databaseId,headSha,createdAt,status,conclusion,url"])

    def test_list_error_is_no_answer(self):
        with mock.patch.object(F, "run", Fake(lambda c: done("", 1, "HTTP 502"))):
            with self.assertRaises(G.NoAnswer):
                D.find_run(FULL, "chunk/209-1", HEAD, SINCE)

    def test_dispatch_argv_and_checked_inputs(self):
        fake = Fake(lambda c: done())
        with mock.patch.object(F, "run", fake):
            self.assertEqual(D.dispatch(FULL, "chunk/209-1", "backend", "src/a b/x.spec.ts"), (True, None))
            for suite, pattern in (("e2e", "x.spec.ts"), ("backend", "x.spec.ts; rm -rf /"), ("backend", "'x'"), ("backend", "$(id)"), ("backend", "")):
                ok, why = D.dispatch(FULL, "chunk/209-1", suite, pattern)
                self.assertFalse(ok)
        self.assertEqual(fake.calls, [["workflow", "run", "one.yml", "-R", FULL, "--ref", "chunk/209-1", "-f", "suite=backend", "-f", "pattern=src/a b/x.spec.ts"]])
        with mock.patch.object(F, "run", Fake(lambda c: done("", 1, "HTTP 403: Resource not accessible"))):
            self.assertEqual(D.dispatch(FULL, "chunk/209-1", "backend", "x.spec.ts"), (False, "HTTP 403: Resource not accessible"))

    def test_result(self):
        self.assertEqual(D.result({"status": "completed", "conclusion": "success"}), "GREEN")
        for st in ("queued", "in_progress", "waiting", "requested", "pending"):
            self.assertEqual(D.result({"status": st, "conclusion": None}), "WAITING")
        for c in ("failure", "cancelled", "timed_out", "startup_failure", None):
            self.assertEqual(D.result({"status": "completed", "conclusion": c}), "RED")

    def test_log_tail(self):
        log = "\n".join("job\tstep\t\x1b[31mline %d\x1b[0m %s" % (i, "x" * 300) for i in range(100))
        fake = Fake(lambda c: done(log))
        with mock.patch.object(F, "run", fake):
            tail = D.log_tail(FULL, 77)
        self.assertEqual(fake.calls[0], ["run", "view", "77", "-R", FULL, "--log-failed"])
        self.assertEqual(len(tail), 60)
        self.assertTrue(tail[0].startswith("job\tstep\tline 40 "))
        self.assertTrue(all(len(l) <= 200 and "\x1b" not in l for l in tail))


class TestFactorySuite(unittest.TestCase):
    URL = "https://github.com/o/rerun/actions/runs/1/job/2"
    DT = "test_trigger::TestFire::test_fire_ok"

    def state(self, cs, log=""):
        with mock.patch.object(G, "head_checks", lambda full, sha: cs), mock.patch.object(G, "job_log", lambda full, url: log):
            return D.factory_state("special-place-ai-heaven/rerun", HEAD, self.DT)

    def check(self, status, conclusion, name=D.FACTORY_CHECK):
        return {"name": name, "status": status, "conclusion": conclusion, "id": 2, "url": self.URL}

    def test_green_needs_success_and_the_named_test(self):
        ok = "2026-11-12T08:00:00.0000000Z test_fire_ok (test_trigger.TestFire.test_fire_ok) ... ok\n"
        self.assertEqual(self.state([self.check("completed", "success"), self.check("completed", "failure", "other")], ok), ("GREEN", self.URL))
        self.assertEqual(self.state([self.check("completed", "success")], ok.replace("test_fire_ok (", "test_other (").replace(".test_fire_ok)", ".test_other)"))[0], "RED")
        self.assertEqual(self.state([self.check("completed", "success")], ok.replace("... ok", "... FAIL"))[0], "RED")

    def test_waiting_and_red(self):
        self.assertEqual(self.state([])[0], "WAITING")
        self.assertEqual(self.state([self.check("in_progress", None)])[0], "WAITING")
        self.assertEqual(self.state([self.check("completed", "failure")]), ("RED", self.URL))


class Cli(unittest.TestCase):
    def main(self, argv, fake):
        out = io.StringIO()
        with mock.patch.object(F, "run", fake), mock.patch.object(D, "POLL_S", 0), contextlib.redirect_stdout(out):
            try:
                code = D.main(argv)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()


class TestProbeOne(Cli):
    ARGV = ["probe-one", "--repo", "testpilot", "--ref", "chunk/209-1", "--suite", "backend", "--pattern", "src/a.spec.ts"]

    def answer(self, view):
        def a(c):
            if c[:2] == ["api", "repos/%s/branches/chunk/209-1" % FULL]:
                return done(json.dumps({"commit": {"sha": HEAD}}))
            if c[:2] == ["workflow", "run"]:
                return done()
            if c[:2] == ["run", "list"]:
                return done(runs((9, HEAD, "2099-01-01T00:00:00Z", "queued", None)))
            if c[:2] == ["run", "view"]:
                return done(json.dumps(view.pop(0) if len(view) > 1 else view[0]))
            return done("", 1, "unexpected")
        return a

    def test_ok(self):
        fake = Fake(self.answer([{"databaseId": 9, "status": "in_progress", "conclusion": None}, {"databaseId": 9, "status": "completed", "conclusion": "success"}]))
        self.assertEqual(self.main(self.ARGV, fake), (0, "ONE OK 9 success\n"))
        self.assertIn(["run", "view", "9", "-R", FULL, "--json", "databaseId,headSha,createdAt,status,conclusion,url"], fake.calls)

    def test_red_or_not_found(self):
        code, out = self.main(self.ARGV, Fake(self.answer([{"databaseId": 9, "status": "completed", "conclusion": "failure"}])))
        self.assertEqual((code, out), (1, "ONE FAIL 9 failure\n"))
        with mock.patch.object(D, "FIND_S", 0):
            code, out = self.main(self.ARGV, Fake(lambda c: done(json.dumps({"commit": {"sha": HEAD}})) if c[0] == "api" else done("[]")))
        self.assertEqual(code, 1)
        self.assertTrue(out.startswith("ONE FAIL - no one.yml run"), out)
        self.assertEqual(self.main(self.ARGV[:5], Fake(lambda c: done()))[0], 2)


class TestProbeMerge(Cli):
    def answer(self, fail=None, labels=()):
        def a(c):
            path = next(x for x in c if x.startswith("repos/"))
            if fail and fail in path:
                return done("", 1, "HTTP 403: Resource not accessible by integration")
            if path == "repos/%s/commits/dev" % FULL:
                return done(json.dumps({"sha": "d" * 40, "parents": [{"sha": "p" * 40}]}))
            if path == "repos/%s/issues/209" % FULL:
                return done(json.dumps({"labels": [{"name": n} for n in labels]}))
            if path.endswith("/issues/209/comments"):
                return done(json.dumps({"id": 555}))
            return done("{}" if "-X" in c and c[c.index("-X") + 1] != "DELETE" else "")
        return a

    def writes(self, fake):
        return [c for c in fake.calls if "-X" in c]

    def test_ok_and_only_the_scratch_ref_is_written(self):
        fake = Fake(self.answer())
        self.assertEqual(self.main(["probe-merge", "--repo", "testpilot", "--issue", "209"], fake), (0, "MERGE OK\n"))
        w = self.writes(fake)
        self.assertEqual([(c[c.index("-X") + 1], c[c.index("-X") + 2].split(FULL + "/")[1].split("/")[0]) for c in w],
                         [("POST", "git"), ("POST", "merges"), ("POST", "issues"), ("DELETE", "issues"), ("POST", "issues"), ("PATCH", "issues"), ("DELETE", "git")])
        ref = next(x for x in w[0] if x.startswith("ref=refs/heads/"))[len("ref=refs/heads/"):]
        self.assertTrue(ref.startswith("factory-probe/"))
        self.assertIn("sha=" + "p" * 40, w[0])
        self.assertIn("base=" + ref, w[1])
        self.assertIn("head=dev", w[1])
        self.assertEqual(w[-1][-1], "repos/%s/git/refs/heads/%s" % (FULL, ref))
        self.assertTrue(w[5][-1].endswith("/issues/comments/555") or "repos/%s/issues/comments/555" % FULL in w[5])
        for c in w:
            self.assertFalse(any(x in ("base=dev", "base=main") or x.endswith("/refs/heads/dev") or x.endswith("/refs/heads/main") for x in c), c)

    def test_no_issue_refuses_before_any_call(self):
        fake = Fake(self.answer())
        code, out = self.main(["probe-merge", "--repo", "rerun"], fake)
        self.assertEqual(code, 2)
        self.assertIn("--issue", out)
        self.assertEqual(fake.calls, [])

    def test_failed_step_still_deletes_the_ref(self):
        fake = Fake(self.answer(fail="/merges"))
        code, out = self.main(["probe-merge", "--repo", "testpilot", "--issue", "209"], fake)
        self.assertEqual(code, 1)
        self.assertTrue(out.startswith("MERGE FAIL merge dev into the scratch ref: HTTP 403"), out)
        w = self.writes(fake)
        self.assertEqual(w[-1][w[-1].index("-X") + 1], "DELETE")
        self.assertIn("/git/refs/heads/factory-probe/", w[-1][-1])

    def test_label_already_set_refuses_before_any_write(self):
        fake = Fake(self.answer(labels=("factory-blocked",)))
        code, out = self.main(["probe-merge", "--repo", "testpilot", "--issue", "209"], fake)
        self.assertEqual(code, 1)
        self.assertIn("already", out)
        self.assertEqual(self.writes(fake), [])


if __name__ == "__main__":
    unittest.main()
