import contextlib, io, json, os, sys, tempfile, time, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D

NOW = 1794000000.0


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


class Beat(unittest.TestCase):
    def make(self, days):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.calls = []

        def gh(args):
            self.calls.append(args)
            if args[:2] == ["issue", "list"] and "likely-fixed" in args:
                return json.dumps([{"number": 7}])
            if args[0] == "api" and "issues/7/timeline" in args[1]:
                return json.dumps([
                    {"event": "commented", "created_at": iso(NOW - 12 * 86400), "html_url": "https://x/c1"},
                    {"event": "labeled", "created_at": iso(NOW - 10 * 86400), "label": {"name": "likely-fixed"}},
                ])
            return "[]"

        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"), "json_state_file": os.path.join(tmp.name, "d.json"),
               "heartbeat_file": os.path.join(tmp.name, "hb"),
               "builders": [{"id": "b1", "name": "B1"}], "reviewers": [{"id": "r1", "name": "R1"}]}
        if days:
            cfg["likely_fixed_days"] = days
        self.d = D.Dispatcher(cfg, lambda t, a, timeout=30: {}, gh, now=lambda: NOW)
        self.addCleanup(self.d.close)

    def beats(self, n):
        with contextlib.redirect_stdout(io.StringIO()):
            for _ in range(n):
                self.d.once()

    def test_the_beat_closes_a_likely_fixed_issue_once_a_day(self):
        self.make(7)
        self.beats(3)
        closes = [c for c in self.calls if c[:2] == ["issue", "close"]]
        self.assertEqual(len(closes), 1)
        self.assertEqual(closes[0][2], "7")

    def test_without_the_setting_the_beat_never_looks(self):
        self.make(None)
        self.beats(3)
        self.assertEqual([c for c in self.calls if "likely-fixed" in " ".join(c)], [])

    def test_the_shipped_settings_turn_it_on_with_7_days(self):
        self.assertEqual(D.settings()["likely_fixed_days"], 7)


if __name__ == "__main__":
    unittest.main()
