import json, os, sqlite3, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
UNTIL = "2026-11-19T15:00:00Z"
SCHEMA = """create table runs (id text, session_id text, status text, provider text, model text, started_at text, finished_at text, step_count integer, input_tokens integer, cached_input_tokens integer, cost_micros integer);
create table messages (session_id text, role text, content_json text, created_at text);
create table tool_calls (run_id text, tool_name text, input_json text);"""
BUILD = 'One job, sent by the dispatcher and not by Boss: rerun #%d, "x". You work alone on it.'
FIX = "One fix round, sent by the dispatcher and not by Boss: pull request #9 of rerun (job #7). The reviewer rejected it."
HEAD = "| job type | path | runs | pass | steps mean | steps median | input mean | cache reads mean | cache share | cost mean | tool calls | read-only calls | top programs |"


def db(root, name):
    d = os.path.join(root, name, "data")
    if not os.path.isdir(d):
        os.makedirs(d)
        with open(os.path.join(root, name, "config.json"), "w") as f:
            json.dump({"displayName": name}, f)
        con = sqlite3.connect(os.path.join(d, "system.db"))
        con.executescript(SCHEMA)
        con.close()
    return sqlite3.connect(os.path.join(d, "system.db"))


def run(root, agent, rid, brief, start, status="done", provider="rerun", end=None, steps=1, inp=None, cached=None, cost=None, tools=()):
    con = db(root, agent)
    if status == "running":
        end = None
    elif end is None:
        end = start[:-1] + ".500Z"
    con.execute("insert into runs values (?, ?, ?, ?, 'm', ?, ?, ?, ?, ?, ?)", (rid, "s-" + rid, status, provider, start[:-1] + ".000Z", end, steps, inp, cached, cost))
    con.execute("insert into messages values (?, 'user', ?, ?)", ("s-" + rid, json.dumps([{"type": "text", "text": brief}]), start[:-1] + ".300Z"))
    for name, args in tools:
        con.execute("insert into tool_calls values (?, ?, ?)", (rid, name, json.dumps(args)))
    con.commit()
    con.close()


def baseline(root, *args):
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "runbaseline.py")] + list(args), capture_output=True, text=True,
                       env=dict(os.environ, RUNBASELINE_AGENTS=root), timeout=60)
    return r.returncode, r.stdout + r.stderr


def two_builds(root):
    run(root, "code", "ra", BUILD % 7, "2026-11-19T10:00:00Z", steps=4, inp=1000, cached=900, cost=20000,
        tools=[("shell_exec", {"command": "cd /w && git status | grep x"}), ("fs_read", {"path": "a"})])
    run(root, "code", "rb", BUILD % 8, "2026-11-19T11:00:00Z", status="error", steps=2, inp=600, cached=300,
        tools=[("shell_exec", {"command": "GH_TOKEN=ghp_secret123 /data/tools/bin/gh pr view 1"})])


class RunBaseline(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def test_a_row_is_computed_from_its_runs(self):
        two_builds(self.root)
        code, out = baseline(self.root, "--until", UNTIL)
        self.assertEqual(code, 0, out)
        lines = out.splitlines()
        self.assertEqual(lines[:5], ["# Code mode baseline", "", "As of %s: the 10 most recent finished runs per job type and path, read from %s/*/data/system.db." % (UNTIL, self.root),
                                     "Path engine: the engine loop, which programmatic tool calling can reach. Path cli: the Claude or Codex CLI, which it cannot.",
                                     "Pass: the run finished (status done); a build also needs no later fix round on its job."])
        self.assertEqual(lines[6], HEAD)
        self.assertEqual(lines[7], "|---" * 13 + "|")
        self.assertEqual(lines[8], "| build | engine | 2 | 50.0% | 3 | 3 | 800 | 600 | 75.0% | $0.0200 | 3 | 1 (33.3%) | gh 1, git 1, grep 1 |")
        self.assertEqual([l.split(" | ")[0:2] for l in lines[8:18]], [["| " + t, p] for t in ("build", "review", "fix", "proof", "plan") for p in ("engine", "cli")])
        self.assertIn("| review | cli | 0 | - | - | - | - | - | - | - | - | - | - |", lines)
        self.assertEqual(lines[18:23], ["", "Verdict: not enough engine-loop runs to judge (2 of 10).", "Unclassified dispatcher runs: 0", "", "## Runs"])
        self.assertEqual(lines[23:], ["- build engine: rb ra"])
        self.assertNotIn("ghp_secret123", out)

    def test_a_later_fix_round_fails_a_build(self):
        two_builds(self.root)
        run(self.root, "linus", "rf", FIX, "2026-11-19T10:30:00Z", provider="claude")
        code, out = baseline(self.root, "--until", UNTIL)
        self.assertEqual(code, 0, out)
        self.assertIn("| build | engine | 2 | 0.0% |", out)
        self.assertIn("| fix | cli | 1 | 100.0% |", out)

    def verdict(self, read):
        for i in range(10):
            tool = ("fs_read", {"path": "a"}) if read and i == 0 else ("shell_exec", {"command": "ls"})
            run(self.root, "code", "r%02d" % i, BUILD % (100 + i), "2026-11-19T10:%02d:00Z" % i, tools=[tool])
        code, out = baseline(self.root, "--until", UNTIL)
        self.assertEqual(code, 0, out)
        return out

    def test_the_verdict_pays_at_ten_percent(self):
        self.assertIn("Verdict: stage 2 pays: read-only built-in calls are 10.0% of 10 engine-loop tool calls in the sampled runs (threshold 10%).", self.verdict(True))

    def test_the_verdict_does_not_pay_below_ten_percent(self):
        self.assertIn("Verdict: stage 2 does not pay: read-only built-in calls are 0.0% of 10 engine-loop tool calls in the sampled runs (threshold 10%).", self.verdict(False))

    def test_which_runs_count(self):
        review = "One review, sent by the dispatcher and not by Boss: pull request #9 of rerun, for job #7."
        run(self.root, "bruce", "v1", review, "2026-11-19T09:00:00Z", provider="claude", steps=5, inp=100, cached=50,
            tools=[("mcp__rerun__shell_exec", {"command": "ls -la"})])
        run(self.root, "bruce", "v2", review, "2026-11-19T14:50:00Z", provider="claude", end="2026-11-19T15:10:00Z")
        run(self.root, "bruce", "v3", review, "2026-11-19T14:55:00Z", provider="claude", status="running")
        run(self.root, "bruce", "w1", "One sweep, sent by the dispatcher and not by Boss: rerun.", "2026-11-19T08:00:00Z", provider="claude")
        code, out = baseline(self.root, "--until", UNTIL)
        self.assertEqual(code, 0, out)
        self.assertIn("| review | cli | 1 | 100.0% | 5 | 5 | 100 | 50 | 50.0% | - | 1 | 0 (0.0%) | ls 1 |", out)
        self.assertIn("Unclassified dispatcher runs: 1", out)
        self.assertIn("- review cli: v1\n", out + "\n")

    def test_a_bad_until_is_refused(self):
        code, out = baseline(self.root, "--until", "yesterday")
        self.assertEqual(code, 2, out)
        self.assertIn("usage: runbaseline.py [--until YYYY-MM-DDTHH:MM:SSZ]", out)

    def test_a_missing_agents_folder_is_refused(self):
        code, out = baseline(os.path.join(self.root, "nope"), "--until", UNTIL)
        self.assertEqual(code, 2, out)
        self.assertIn("no agents folder: %s" % os.path.join(self.root, "nope"), out)


if __name__ == "__main__":
    unittest.main()
