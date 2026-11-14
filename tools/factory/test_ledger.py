import json, os, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G
import ledger as L

PLAN53 = """## Chunks
- [ ] 1. Trigger client, read-only run reader, probe, check-triggers (body and model only), challenge.md body | builder: larry | test: factory tools/factory/test_trigger.py | done-test: test_trigger::TestFire::test_fire_ok | paths: tools/factory/trigger.py, tools/factory/triggers/challenge.md, tools/factory/runner.json, tools/factory/install.sh, tools/factory/test_trigger.py | max-lines: 300 | depends on: -
- [ ] 2. Ledger comment parse/render with `<`/`>` escaping, chunk-line parser and shape check, `gate.same()` bare-module match | builder: hopper | test: factory tools/factory/test_ledger.py | done-test: test_ledger::TestLedger::test_roundtrip_with_comment_end | paths: tools/factory/ledger.py, tools/factory/gate.py, tools/factory/test_ledger.py | max-lines: 300 | depends on: -
- [ ] 3. Counters and limits as pure functions (fix builds, rounds, caps, 45-min, restart refire, pending firing resolution, re-plan keeps MERGED chunks) | builder: hopper | test: factory tools/factory/test_limits.py | done-test: test_limits::TestLimits::test_third_failure_returns_to_plan | paths: tools/factory/limits.py, tools/factory/test_limits.py | max-lines: 300 | depends on: 2
- [ ] 4. Evidence readers for Plan, Challenge (current-round rule), Build (compare, paths) and Review comments, GitHub fetcher injected | builder: larry | test: factory tools/factory/test_evidence.py | done-test: test_evidence::TestEvidence::test_stale_plan_ready_ignored | paths: tools/factory/evidence.py, tools/factory/test_evidence.py | max-lines: 300 | depends on: 2
- [ ] 5. `one` dispatch, run lookup, result and log tail, factory-suite check-run mode, probe-one, probe-merge | builder: house | test: factory tools/factory/test_testdispatch.py | done-test: test_testdispatch::TestDispatch::test_find_run_by_sha | paths: tools/factory/testdispatch.py, tools/factory/test_testdispatch.py | max-lines: 300 | depends on: -
- [ ] 6. Runner 5a: tick, ledger I/O with pre-fire intent and flock, PLAN, CHALLENGE, plan-to-body PATCH, BLOCKED comment, --dry-run, plan.md body | builder: larry | test: factory tools/factory/test_runner.py | done-test: test_runner::TestTick::test_crash_after_post_does_not_refire | paths: tools/factory/runner.py, tools/factory/triggers/plan.md, tools/factory/runner.json, tools/factory/test_runner.py | max-lines: 300 | depends on: 1 (C then B passed), 2, 3, 4
- [ ] 7. Runner 5b: BUILD, TEST, chunk merge into job branch, build.md body | builder: larry | test: factory tools/factory/test_runner_build.py | done-test: test_runner_build::TestBuild::test_green_chunk_merges | paths: tools/factory/runner.py, tools/factory/triggers/build.md, tools/factory/test_runner_build.py | max-lines: 300 | depends on: 5 (probe-merge passed), 6
- [ ] 8. Runner stages JOBPR, REVIEW, READY (job PR, risk lookup, SHA-bound verdict, label, three numbers), review.md body | builder: larry | test: factory tools/factory/test_jobstages.py | done-test: test_jobstages::TestJobStages::test_ready_needs_sha_bound_accept | paths: tools/factory/jobstages.py, tools/factory/runner.py, tools/factory/triggers/review.md, tools/factory/test_jobstages.py | max-lines: 300 | depends on: 7
- [ ] 9. systemd service (`User=rerun`) and timer files, runner.env.example, verify-trial and report commands, install.sh additions | builder: house | test: factory tools/factory/test_install.py | done-test: test_install::TestInstall::test_service_runs_as_rerun | paths: tools/factory/systemd/**, tools/factory/runner.env.example, tools/factory/install.sh, tools/factory/runner.py, tools/factory/test_install.py | max-lines: 300 | depends on: 8

(Nine chunks.)
- [ ] 10. a line after the section text still counts | builder: x | test: factory a/test_a.py | done-test: test_a::A::test_a | paths: a/test_a.py | max-lines: 9 | depends on: -
## Risks
- [ ] 11. not in the Chunks section | builder: x
"""
GOOD = "- [ ] 3. Title | builder: hopper | test: backend src/a.spec.ts | done-test: src/a.spec.ts | paths: src/a.ts, src/a.spec.ts | max-lines: 300 | depends on: 2"


def state():
    s = L.new(42)
    s.update(stage="BLOCKED", chunk="2", plan_round=1, fired_total=3,
             blocked={"at": "BUILD", "reason": "run r9 ended --> with <b>error</b> | piped"},
             chunks={"1": {"state": "MERGED", "builds": 1, "fix_builds": 0, "restart_refires": 0, "sha": "ab12cd34", "test_run": 123, "merged": "9f8e7d6c"}},
             runs=[{"stage": "plan", "coworker": "ada", "run": "r1", "fired": "2026-11-12T08:00:00Z", "ended": "2026-11-12T08:09:00Z",
                    "status": "error", "in": 812000, "out": 9000, "error": "interrupted: engine restarted -->"},
                   {"run": None, "firing": "2026-11-12T08:10:00Z", "slug": "factory-challenge"}])
    return s


class TestLedger(unittest.TestCase):
    def test_roundtrip_with_comment_end(self):
        s = state()
        body = L.render(s, now="2026-11-12T08:02:11Z")
        self.assertEqual(L.parse(body), s)
        line = next(l for l in body.splitlines() if l.startswith(L.STATE_OPEN))
        self.assertTrue(line.endswith(" -->"))
        self.assertEqual(line.count("-->"), 1)
        self.assertEqual(json.loads(line[len(L.STATE_OPEN):-4])["blocked"]["reason"], s["blocked"]["reason"])
        self.assertNotIn("<b>", line)

    def test_header_lines(self):
        lines = L.render(state(), now="2026-11-12T08:02:11Z").splitlines()
        self.assertEqual(lines[:3], ["<!-- factory-ledger -->", "**Factory ledger** (written by the runner; GitHub facts win over this comment)",
                                     "Stage: BLOCKED | chunk 2 | updated 2026-11-12T08:02:11Z"])
        self.assertEqual(lines[4:6], ["| stage | chunk | coworker | run | fired | ended | status | input tokens |", "|---|---|---|---|---|---|---|---|"])
        self.assertEqual(lines[6], "| plan | - | ada | r1 | 2026-11-12T08:00:00Z | 2026-11-12T08:09:00Z | error | 812000 |")
        self.assertEqual(lines[7], "| factory-challenge | - | - | - | 2026-11-12T08:10:00Z | - | firing | - |")
        self.assertEqual(L.render(L.new(7)).splitlines()[2][:24], "Stage: PLAN | chunk - | ")

    def test_table_cells_cannot_break_the_table(self):
        s = L.new(1)
        s["runs"] = [{"stage": "build", "coworker": "a|b", "run": "r<!--", "status": "x\ny"}]
        row = L.render(s).splitlines()[-1]
        self.assertEqual(row.count(" | "), 7)
        self.assertNotIn("<!--", row)
        self.assertNotIn("\n", row)

    def test_bad_ledger_raises(self):
        good = L.render(state())
        for body in (good.replace('"v":1', '"v":2'), good.replace('"stage":"BLOCKED"', '"stage":"NOPE"'), good.replace(L.STATE_OPEN + "{", L.STATE_OPEN + "{,"),
                     good.replace(" -->\n|", "\n|"), "plain comment", "", None, good.split(L.STATE_OPEN)[0]):
            with self.assertRaises(ValueError):
                L.parse(body)
        self.assertEqual(L.parse(good.replace("\n", "\r\n")), state())

    def test_oldest_ledger_comment_wins(self):
        mk = lambda i, t, b: {"id": i, "created_at": t, "body": b}
        cm = [mk(5, "2026-11-12T09:00:00Z", L.MARK + "\nnewer"), mk(3, "2026-11-12T07:00:00Z", "a reply quoting " + L.MARK),
              mk(4, "2026-11-12T08:00:00Z", L.MARK + "\nolder")]
        self.assertEqual(L.find(cm)["id"], 4)
        self.assertIsNone(L.find([mk(1, "2026-11-12T07:00:00Z", "no ledger"), mk(2, "2026-11-12T07:00:00Z", None)]))


class TestChunkLine(unittest.TestCase):
    def test_plan_53_lines_pass(self):
        lines = L.chunk_lines(PLAN53)
        self.assertEqual([L.chunk(l)["id"] for l in lines], [str(i) for i in range(1, 11)])
        for l in lines:
            self.assertEqual(L.shape(l), [], l)
        c = L.chunk(lines[0])
        self.assertEqual(c["title"], "Trigger client, read-only run reader, probe, check-triggers (body and model only), challenge.md body")
        self.assertEqual((c["builder"], c["suite"], c["test"], c["done_test"], c["max_lines"], c["depends"]),
                         ("larry", "factory", "tools/factory/test_trigger.py", "test_trigger::TestFire::test_fire_ok", 300, "-"))
        self.assertEqual(len(c["paths"]), 5)

    def test_gate_finds_the_same_fields(self):
        line = L.chunk_lines(PLAN53)[1]
        with mock.patch.object(G, "gh_json", lambda path: {"body": PLAN53}):
            gl, _, fld = G.parse_issue("special-place-ai-heaven/rerun", "rerun", "53", "2")
        self.assertEqual(gl, line)
        self.assertEqual(fld["done-test"], L.chunk(line)["done_test"])
        self.assertEqual(fld["max-lines"], "300")

    def test_bad_shapes(self):
        bad = {
            "- chunk 1 | builder: x": "not a chunk line",
            GOOD.replace(" | builder: hopper", ""): "missing builder",
            GOOD.replace("src/a.ts,", "../a.ts,"): "path not relative: ../a.ts",
            GOOD.replace("src/a.ts,", "/etc/a.ts,"): "path not relative: /etc/a.ts",
            GOOD.replace("src/a.ts,", "src/../../a.ts,"): "path not relative: src/../../a.ts",
            GOOD.replace("backend src/a.spec.ts", "backend src/a.spec.ts src/b.spec.ts"): "test must name one suite and one test file",
            GOOD.replace("backend src/a.spec.ts", "backend"): "test must name one suite and one test file",
            GOOD.replace("backend src/a.spec.ts", "backend lib/a.spec.ts"): "test file lib/a.spec.ts is in no path",
            GOOD.replace("backend", "e2e"): "suite e2e is not one of backend, frontend, layout, factory",
            GOOD.replace("src/a.ts, src/a.spec.ts", "a, b, c, d, e, f, src/a.spec.ts"): "more than 6 paths",
            GOOD.replace("max-lines: 300", "max-lines: about 300"): "max-lines is not a number",
            GOOD.replace("done-test: src/a.spec.ts", "done-test: two words"): "done-test is not one test id",
            GOOD.replace("backend src/a.spec.ts", "factory src/a.spec.ts").replace("done-test: src/a.spec.ts", "done-test: test_a"):
                "done-test is not module::Class::test",
        }
        self.assertEqual(L.shape(GOOD), [])
        for line, why in bad.items():
            self.assertIn(why, L.shape(line), line)


class TestSame(unittest.TestCase):
    def test_bare_module_matches_its_tests(self):
        name = G.results("2026-11-12T08:00:00.0000000Z test_fire_ok (test_trigger.TestFire.test_fire_ok) ... ok\n")[0][1]
        self.assertEqual(name, "test_trigger::TestFire::test_fire_ok")
        self.assertTrue(G.same(name, "test_trigger::TestFire::test_fire_ok"))
        self.assertTrue(G.same(name, "test_trigger"))
        self.assertFalse(G.same("test_triggerx::TestFire::test_fire_ok", "test_trigger"))
        self.assertFalse(G.same("test_ledger::TestFire::test_fire_ok", "test_trigger"))
        self.assertFalse(G.same("TestFire::test_x", "TestFire"))


if __name__ == "__main__":
    unittest.main()
