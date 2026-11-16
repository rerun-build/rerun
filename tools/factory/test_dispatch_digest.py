import contextlib, io, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D


class Digest(unittest.TestCase):
    def make(self, issues=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.calls = []
        self.gh_calls = []
        self.t = 1794000100.0
        rows = [{"number": 700, "title": "Factory control"}] if issues is None else issues

        def account(tool, args, timeout=30):
            self.calls.append((tool, args, timeout))
            return {}

        def gh(args):
            self.gh_calls.append(args)
            if args[0] == "issue":
                return json.dumps(rows)
            if args[0] == "api":
                return json.dumps({"id": 9001})
            return "[]"

        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"), "json_state_file": os.path.join(tmp.name, "d.json"),
               "heartbeat_file": os.path.join(tmp.name, "hb"),
               "builders": [{"id": "b1", "name": "B1"}], "reviewers": [{"id": "r1", "name": "R1"}]}
        self.d = D.Dispatcher(cfg, account, gh, now=lambda: self.t)
        self.addCleanup(self.d.close)

    def once(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.d.once()

    def apis(self):
        return [c for c in self.gh_calls if c[0] == "api"]

    def test_the_first_beat_writes_the_digest_into_the_control_issue_and_the_next_edits_it_ten_minutes_later(self):
        self.make()
        self.once()
        a = self.apis()
        self.assertEqual(len(a), 1)
        self.assertIn("POST", a[0])
        self.assertIn("repos/o/r/issues/700/comments", a[0])
        self.assertTrue(a[0][-1].startswith("body=<!-- factory-digest -->\n```json"))
        self.t += 30
        self.once()
        self.assertEqual(len(self.apis()), 1)
        self.t += 600
        self.once()
        a = self.apis()
        self.assertEqual(len(a), 2)
        self.assertIn("PATCH", a[1])
        self.assertIn("repos/o/r/issues/comments/9001", a[1])

    def test_no_control_issue_means_no_write(self):
        self.make(issues=[])
        self.once()
        self.assertEqual(self.apis(), [])

    def test_the_snapshot_of_the_beat_carries_the_digest(self):
        self.make()
        self.once()
        snap = [c for c in self.calls if c[0] == "factory_report"][0][1]["snapshot"]
        self.assertEqual(set(snap["digest"]), {"stations", "threads", "anomalies", "measures", "planners"})


if __name__ == "__main__":
    unittest.main()
