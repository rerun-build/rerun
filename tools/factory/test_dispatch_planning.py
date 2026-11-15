import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import World

BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"
START = "2026-11-15T02:00:00Z"
PLANNER = {"coworkers": [{"id": BOSS, "name": "Boss", "runs": 1}]}
TEAM = {"checkedAt": START, "agents": [{"id": BOSS, "name": "Boss", "handle": "boss", "status": "working",
                                         "running": [{"runId": "run-b1", "startedAt": START, "steps": 4}]}]}


class PlanWorld(World):
    def __init__(self):
        super().__init__()
        self.team, self.team_calls, self.reports, self.label_searches = TEAM, 0, [], 0

    def account(self, tool, args, timeout=None):
        if tool == "get_team_status":
            self.team_calls += 1
            if isinstance(self.team, Exception):
                raise self.team
            return self.team
        if tool == "factory_report":
            self.reports.append(args["snapshot"])
            return {}
        return super().account(tool, args)

    def gh(self, args):
        a = list(args)
        if a[:2] == ["issue", "list"] and "--label" in a and a[a.index("--label") + 1] == "factory-plan":
            self.label_searches += 1
            return json.dumps([{"number": 450, "title": "Floor"}])
        if a[:2] == ["issue", "list"] and "--search" in a:
            return json.dumps([{"number": 451, "createdAt": "2026-11-15T02:05:00Z", "body": "**Part of**: #450."}])
        return super().gh(a)


def beats(extra, n):
    with tempfile.TemporaryDirectory() as d:
        w = PlanWorld()
        cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "auto_plan_marker": True,
               "ledger_file": os.path.join(d, "ledger.db"), "json_state_file": os.path.join(d, "dispatch.json"),
               "heartbeat_file": os.path.join(d, "heartbeat"),
               "types": {"coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
                         "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]}}}
        cfg["types"].update(extra.get("types", {}))
        w.ledger = cfg["ledger_file"]
        extra.get("prepare", lambda w: None)(w)
        disp = D.Dispatcher(cfg, w.account, w.gh, now=lambda: w.clock)
        try:
            for _ in range(n):
                disp.once()
        finally:
            disp.close()
        return w


class Wiring(unittest.TestCase):
    def test_the_report_carries_the_plan_of_the_labelled_parent(self):
        w = beats({"types": {"planner": PLANNER}}, 1)
        plan = w.reports[-1]["planning"]
        self.assertEqual(len(plan), 1)
        self.assertEqual((plan[0]["parent"], plan[0]["title"], plan[0]["children"], plan[0]["filed"]), (450, "Floor", 1, 1))
        self.assertEqual(plan[0]["coworkers"], [{"id": BOSS, "name": "Boss", "runId": "run-b1", "startedAt": START, "steps": 4}])

    def test_one_status_call_and_one_label_search_every_second_beat(self):
        w = beats({"types": {"planner": PLANNER}}, 6)
        self.assertEqual((w.team_calls, w.label_searches), (4, 4))
        self.assertTrue(all("planning" in r for r in w.reports))

    def test_no_planner_pool_makes_no_call_and_no_key(self):
        w = beats({}, 3)
        self.assertEqual((w.team_calls, w.label_searches), (0, 0))
        self.assertTrue(w.reports and all("planning" not in r for r in w.reports))

    def test_an_account_error_never_fails_the_beat(self):
        w = beats({"types": {"planner": PLANNER}, "prepare": lambda w: setattr(w, "team", RuntimeError("down"))}, 2)
        self.assertTrue(w.reports and all("planning" not in r for r in w.reports))
        self.assertEqual(w.team_calls, 2)

    def test_the_planner_pool_gets_no_work(self):
        w = beats({"types": {"planner": PLANNER}}, 3)
        self.assertNotIn(BOSS, [s[0] for s in w.sends])
        self.assertTrue(w.sends)


if __name__ == "__main__":
    unittest.main()
