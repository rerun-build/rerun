import json, os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stall_alarm as S

FIXTURE = os.path.join(HERE, "fixtures", "stall_runs.json")
NOW = 1794834000
FIRST = "STALL coder run run-50 job rerun#52 running 50 min, branch chunk/52-1 last push 2026-11-16T12:20:00Z"


def load():
    with open(FIXTURE) as f:
        return json.load(f)


def run(rid, started, status="running", agent="agt-kent", job=None, branch=None):
    return {"id": rid, "agentId": agent, "status": status, "startedAt": started, "jobRef": job, "branch": branch}


class StallAlarm(unittest.TestCase):
    def test_fixture_now_is_the_test_clock(self):
        self.assertEqual(S.ts(load()["now"]), NOW)

    def test_names_only_the_50_minute_run(self):
        self.assertEqual([r["id"] for r in S.stalled(load()["runs"], NOW)], ["run-50"])

    def test_limit_is_45_minutes(self):
        self.assertEqual(S.DEFAULT_LIMIT_S, 2700)
        at = run("at", "2026-11-16T12:15:00.000Z")
        past = run("past", "2026-11-16T12:14:59.000Z")
        self.assertEqual([r["id"] for r in S.stalled([at, past], NOW)], ["past"])

    def test_an_ended_run_is_never_named(self):
        self.assertEqual(S.stalled([run("old", "2026-11-16T10:00:00.000Z", status="done")], NOW), [])

    def test_line_names_coworker_job_and_last_push(self):
        d = load()
        r = d["runs"][0]
        self.assertEqual(S.line(r, d["agents"][r["agentId"]], d["pushes"][r["branch"]], NOW), FIRST)

    def test_line_without_job_or_branch(self):
        r = run("run-x", "2026-11-16T12:14:00.000Z")
        self.assertEqual(S.line(r, "kent", None, NOW), "STALL kent run run-x job - running 46 min, branch - last push -")

    def test_cli_prints_only_the_first(self):
        out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "stall_alarm.py"), "--fixture", FIXTURE],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, FIRST + "\n")


if __name__ == "__main__":
    unittest.main()
