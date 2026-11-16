import io, json, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stall_alarm as S
from engine import Engine
from ghclient import GhError

NOW = 1794834000
LINE = "STALL coder run run-50 job rerun#52 running 50 min, branch chunk/52-1 last push 2026-11-16T12:20:00Z"
RUNS = {
    "agt-coder": [{"id": "run-50", "agentId": "agt-coder", "status": "running", "startedAt": "2026-11-16T12:10:00.000Z", "jobRef": "rerun#52", "branch": "chunk/52-1"}],
    "agt-kent": [{"id": "run-5", "agentId": "agt-kent", "status": "running", "startedAt": "2026-11-16T12:55:00.000Z", "jobRef": "rerun#52", "branch": "chunk/52-2"},
                 {"id": "run-solo", "agentId": "agt-kent", "status": "running", "startedAt": "2026-11-16T12:00:00.000Z", "jobRef": None, "branch": None}],
}


class FakeEngine:
    def __init__(self):
        self.calls = []

    def list_agents(self):
        return [{"id": "agt-coder", "name": "coder"}, {"id": "agt-kent", "name": "kent"}]

    def list_runs(self, agent_id, status=None, limit=50):
        self.calls.append((agent_id, status))
        return RUNS[agent_id]


class FakeGh:
    def __init__(self):
        self.posts = []

    def branch_sha(self, branch):
        if branch != "chunk/52-1":
            raise GhError("GET branch failed: HTTP 404", 404)
        return "abc123"

    def commit(self, sha):
        return {"commit": {"committer": {"date": "2026-11-16T12:20:00Z"}}}

    def req(self, method, path, body=None):
        self.posts.append((method, path, body))
        return {"id": 1}


class Reply(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class StallAlarmPost(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.boss = os.path.join(self.dir.name, "ACTIVE-DISPATCHES.md")
        self.gh = FakeGh()
        self.repos = []

    def tearDown(self):
        self.dir.cleanup()

    def gh_for(self, repo):
        self.repos.append(repo)
        return self.gh

    def test_engine_lists_agents(self):
        seen = []

        def urlopen(req, timeout):
            seen.append((req.get_method(), req.full_url, req.get_header("Authorization")))
            return Reply(json.dumps({"agents": [{"id": "agt-coder", "name": "coder"}]}).encode())

        eng = Engine(base_url="http://engine", key="k", urlopen=urlopen)
        self.assertEqual(eng.list_agents(), [{"id": "agt-coder", "name": "coder"}])
        self.assertEqual(seen, [("GET", "http://engine/agents", "Bearer k")])

    def test_collect_asks_each_coworker_for_running_runs(self):
        eng = FakeEngine()
        got = S.collect(eng)
        self.assertEqual(eng.calls, [("agt-coder", "running"), ("agt-kent", "running")])
        self.assertEqual([(r["id"], name) for r, name in got], [("run-50", "coder"), ("run-5", "kent"), ("run-solo", "kent")])

    def test_last_push_is_the_head_commit_date(self):
        self.assertEqual(S.last_push(self.gh, "chunk/52-1"), "2026-11-16T12:20:00Z")
        self.assertIsNone(S.last_push(self.gh, "gone"))
        self.assertIsNone(S.last_push(self.gh, None))
        self.assertIsNone(S.last_push(None, "chunk/52-1"))

    def test_alarm_posts_one_line_to_the_issue_and_to_boss(self):
        lines = S.alarm(FakeEngine(), self.gh_for, self.boss, NOW)
        solo = "STALL kent run run-solo job - running 60 min, branch - last push -"
        self.assertEqual(lines, [LINE, solo])
        self.assertEqual(self.gh.posts, [("POST", "/issues/52/comments", {"body": LINE})])
        self.assertEqual(set(self.repos), {"rerun"})
        with open(self.boss) as f:
            self.assertEqual(f.read(), LINE + "\n" + solo + "\n")

    def test_alarm_names_a_run_once(self):
        S.alarm(FakeEngine(), self.gh_for, self.boss, NOW)
        self.gh.posts.clear()
        self.assertEqual(S.alarm(FakeEngine(), self.gh_for, self.boss, NOW + 600), [])
        self.assertEqual(self.gh.posts, [])
        with open(self.boss) as f:
            self.assertEqual(len(f.read().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
