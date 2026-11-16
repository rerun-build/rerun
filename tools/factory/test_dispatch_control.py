import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import World, ready


class ControlWorld(World):
    def __init__(self, issues, control_body=None):
        super().__init__(issues)
        self.control_body = control_body
        self.control_comments = []

    def gh(self, args):
        a = list(args)
        if a[:2] == ["issue", "list"] and "--search" in a:
            self.gh_calls.append(a)
            if self.control_body is None:
                return "[]"
            return json.dumps([{"number": 99, "title": "Factory control", "body": self.control_body}])
        if a[:3] == ["issue", "comment", "99"]:
            self.gh_calls.append(a)
            self.control_comments.append(a[a.index("--body") + 1])
            return ""
        return super().gh(a)


def issue(n):
    return {"number": n, "title": "Fix %d" % n, "body": ready(), "comments": []}


class DispatchControl(unittest.TestCase):
    def make(self, control_body=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.w = ControlWorld([issue(n) for n in (5, 6, 7)], control_body)
        cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"),
               "json_state_file": os.path.join(tmp.name, "dispatch.json"),
               "heartbeat_file": os.path.join(tmp.name, "heartbeat"),
               "types": {"coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "code", "runs": 1}]},
                         "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]}}}
        self.w.ledger = cfg["ledger_file"]
        self.d = D.Dispatcher(cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        self.addCleanup(self.d.close)

    def beat(self, n):
        for _ in range(n):
            self.d.once()

    def sent(self):
        return [s[0] for s in self.w.sends]

    def test_without_a_control_issue_the_pool_keeps_the_copies_of_the_settings(self):
        self.make()
        self.beat(2)
        self.assertEqual(self.sent(), ["b1"])
        self.assertEqual(self.d.store.events(), [])

    def test_the_effective_copies_of_the_control_block_fill_the_pool(self):
        self.make('```json\n{"copies": {"code": 3}}\n```')
        self.beat(2)
        self.assertEqual(self.sent(), ["b1", "b1", "b1"])
        events = self.d.store.events()
        self.assertEqual([(e["key"], e["from"], e["to"]) for e in events], [("copies.code", 1, 3)])

    def test_a_value_above_the_bound_leaves_the_pool_as_it_was_and_gets_one_comment(self):
        self.make('```json\n{"copies": {"code": 9}}\n```')
        self.beat(6)
        self.assertEqual(self.sent(), ["b1"])
        self.assertEqual(self.d.store.events(), [])
        self.assertEqual(len(self.w.control_comments), 1)
        self.assertEqual(len([c for c in self.w.gh_calls if c[:3] == ["issue", "comment", "99"]]), 1)


if __name__ == "__main__":
    unittest.main()
