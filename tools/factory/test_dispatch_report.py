import contextlib, io, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D


class Reply:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Report(unittest.TestCase):
    def make(self, fail=None, warm=True):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.calls = []
        self.fail = fail
        self.t = 1794000000.0

        def account(tool, args, timeout=30):
            self.calls.append((tool, args, timeout))
            if tool == "factory_report" and self.fail:
                raise self.fail
            return {}

        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"), "json_state_file": os.path.join(tmp.name, "d.json"),
               "heartbeat_file": os.path.join(tmp.name, "hb"),
               "builders": [{"id": "b1", "name": "B1"}], "reviewers": [{"id": "r1", "name": "R1"}]}
        gh = lambda args: "[]"
        self.d = D.Dispatcher(cfg, account, gh, now=lambda: self.t)
        self.addCleanup(self.d.close)
        if warm:
            self.t += 100

    def once(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.d.once()
        return out.getvalue()

    def reports(self):
        return [c for c in self.calls if c[0] == "factory_report"]

    def test_each_beat_sends_one_factory_report_with_a_10_second_timeout(self):
        self.make()
        self.once()
        self.once()
        r = self.reports()
        self.assertEqual(len(r), 2)
        self.assertEqual({c[2] for c in r}, {10})
        self.assertEqual(r[1][1]["snapshot"]["beat"], 2)
        self.assertEqual(r[0][1]["snapshot"]["repo"], "o/r")

    def test_the_report_carries_the_epics(self):
        self.make()
        self.d.store.put_job("60", "queued", {"issue": 60, "title": "T", "body": "**Part of**: #50\n"})
        self.d.gh = lambda args: json.dumps({"title": "Epic T", "labels": [{"name": "feature"}]}) if args[:2] == ["issue", "view"] else "[]"
        self.d.report_line()
        self.assertEqual(self.reports()[0][1]["snapshot"]["epics"], [{"issue": 50, "title": "Epic T", "kind": "feature"}])

    def test_a_failed_or_unknown_tool_answer_is_logged_once_and_the_beat_goes_on(self):
        self.make(D.Error("account factory_report failed: HTTP 404"))
        text = self.once() + self.once()
        self.assertEqual(text.count("factory_report: account factory_report failed: HTTP 404"), 1)
        self.assertEqual(len(self.reports()), 2)
        self.fail = KeyError("x")
        self.assertEqual(self.once().count("factory_report: KeyError"), 1)
        self.fail = None
        self.once()
        self.fail = KeyError("x")
        self.assertEqual(self.once().count("factory_report: KeyError"), 1)

    def test_a_failure_in_the_first_90_seconds_is_not_logged_unless_it_lasts(self):
        self.make(D.Error("account factory_report failed: HTTP 404"), warm=False)
        self.t += 89
        self.assertNotIn("factory_report", self.once())
        self.t += 2
        text = self.once() + self.once()
        self.assertEqual(text.count("factory_report: account factory_report failed: HTTP 404"), 1)
        self.assertEqual(len(self.reports()), 3)

    def test_a_report_that_works_within_90_seconds_logs_nothing(self):
        self.make(D.Error("account factory_report failed: HTTP 404"), warm=False)
        self.assertNotIn("factory_report", self.once())
        self.fail = None
        self.t += 200
        self.assertNotIn("factory_report", self.once())

    def test_make_account_passes_the_timeout_and_keeps_30_by_default(self):
        seen = []

        def opener(req, timeout):
            seen.append(timeout)
            return Reply(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "{}"}]}}).encode())

        call = D.make_account("http://x/mcp", "k", opener=opener)
        call("a", {})
        call("b", {}, timeout=10)
        self.assertEqual(seen, [30, 10])


if __name__ == "__main__":
    unittest.main()
