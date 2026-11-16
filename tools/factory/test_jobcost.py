import json, os, sqlite3, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = """create table messages (session_id text, role text, content_json text, created_at text);
create table tool_calls (run_id text, input_json text, is_error integer);
create table runs (id text, session_id text, status text, model text, started_at text, finished_at text, step_count integer, error text);
create table run_steps (run_id text, input_tokens integer, cached_input_tokens integer, cache_write_tokens integer, output_tokens integer);"""


def agent(root, name, text):
    d = os.path.join(root, name, "data")
    os.makedirs(d)
    with open(os.path.join(root, name, "config.json"), "w") as f:
        json.dump({"displayName": name}, f)
    con = sqlite3.connect(os.path.join(d, "system.db"))
    con.executescript(SCHEMA)
    con.execute("insert into messages values ('s', 'user', ?, '2026-11-12T10:00:00Z')", (json.dumps(text),))
    con.execute("insert into runs values (?, 's', 'done', 'claude-sonnet', '2026-11-12T10:00:01Z', '2026-11-12T10:05:00Z', 3, null)", ("run-" + name,))
    con.execute("insert into run_steps values (?, 100, 60, 10, 7)", ("run-" + name,))
    con.commit()
    con.close()


class JobCostMatch(unittest.TestCase):
    def cost(self, *texts):
        root = tempfile.mkdtemp()
        for i, t in enumerate(texts):
            agent(root, "a%d" % i, t)
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "jobcost.py"), "rerun#84"], capture_output=True, text=True,
                           env=dict(os.environ, JOBCOST_AGENTS=root), timeout=60)
        return r.returncode, r.stdout

    def test_short_and_owner_forms_both_count(self):
        code, out = self.cost("JOB rerun#84\nTask: a", "JOB special-place-ai-heaven/rerun#84\nTask: b")
        self.assertEqual(code, 0, out)
        self.assertIn("JOB rerun#84: 2 runs", out)
        self.assertRegex(out, r"TOTAL\s+0\s+0\s+200\s+120\s+20\s+60\s+14")

    def test_other_issue_numbers_and_repos_do_not_count(self):
        code, out = self.cost("JOB rerun#84\nTask: a", "JOB rerun#840\nTask: b", "JOB special-place-ai-heaven/rerun#8\nTask: c", "JOB testpilot#84\nTask: d")
        self.assertEqual(code, 0, out)
        self.assertIn("JOB rerun#84: 1 runs", out)


if __name__ == "__main__":
    unittest.main()
