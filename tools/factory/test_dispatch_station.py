import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import World

BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"
PLANNER = {"coworkers": [{"id": BOSS, "name": "Boss", "runs": 1}]}
BACKLOG = [{"number": 40, "title": "Floor", "labels": [{"name": "P1"}], "createdAt": "2026-11-15T02:00:00Z", "author": {"login": "special-place-administrator"}},
           {"number": 41, "title": "Crash", "labels": [{"name": "bug"}], "createdAt": "2026-11-15T02:01:00Z", "author": {"login": "special-place-administrator"}}]


class StationWorld(World):
    def __init__(self):
        super().__init__(issues=[])

    def account(self, tool, args, timeout=None):
        if tool == "get_team_status":
            return {"checkedAt": "2026-11-15T02:00:00Z", "agents": []}
        return super().account(tool, args)

    def gh(self, args):
        a = list(args)
        if a[:2] == ["issue", "list"] and "--json" in a and a[a.index("--json") + 1] in ("number,title,labels,createdAt", "number,title,labels,createdAt,author"):
            self.gh_calls.append(a)
            return json.dumps(BACKLOG)
        if a[:2] == ["issue", "list"] and "--search" in a:
            self.gh_calls.append(a)
            return "[]"
        if a[:3] == ["issue", "edit", "40"]:
            self.gh_calls.append(a)
            return ""
        return super().gh(a)


def beats(extra, n):
    with tempfile.TemporaryDirectory() as d:
        w = StationWorld()
        cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "auto_plan_marker": True,
               "ledger_file": os.path.join(d, "ledger.db"), "json_state_file": os.path.join(d, "dispatch.json"),
               "heartbeat_file": os.path.join(d, "heartbeat"),
               "types": {"coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
                         "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]}}}
        cfg["types"].update(extra)
        w.ledger = cfg["ledger_file"]
        disp = D.Dispatcher(cfg, w.account, w.gh, now=lambda: w.clock)
        try:
            for _ in range(n):
                disp.once()
        finally:
            disp.close()
        return w


class Station(unittest.TestCase):
    def test_one_beat_sends_the_unplanned_issue_to_the_planner_and_labels_it(self):
        w = beats({"planner": PLANNER}, 1)
        sent = [s for s in w.sends if s[0] == BOSS]
        self.assertEqual(len(sent), 1)
        self.assertIn('#40, "Floor"', sent[0][1])
        self.assertIn(["issue", "edit", "40", "-R", "o/r", "--add-label", "factory-plan"], w.gh_calls)

    def test_no_planner_pool_sends_nothing_to_it(self):
        w = beats({}, 2)
        self.assertEqual([s for s in w.sends if s[0] == BOSS], [])

    def test_six_beats_send_exactly_one_message_to_the_planner(self):
        w = beats({"planner": PLANNER}, 6)
        self.assertEqual(len([s for s in w.sends if s[0] == BOSS]), 1)


if __name__ == "__main__":
    unittest.main()
