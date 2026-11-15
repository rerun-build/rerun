import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planners

BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"
SHAPER = "1b325848-c3fd-4e6f-9ad7-43f3adac08b6"
CFG = {"repo": "o/r", "types": {"planner": {"coworkers": [
    {"id": BOSS, "name": "Boss", "runs": 1}, {"id": SHAPER, "name": "Scope Shaper", "runs": 1}]}}}
START = "2026-11-15T02:00:00Z"


def status(*agents):
    return {"checkedAt": "2026-11-15T02:10:00Z", "agents": list(agents)}


BOSS_RUNNING = {"id": BOSS, "name": "Boss", "handle": "boss", "status": "working",
                "running": [{"runId": "run-b1", "startedAt": START, "steps": 12}]}


class Fake:
    def __init__(self, team, parents=None, kids=None):
        self.team, self.calls, self.searches = team, 0, []
        self.parents = parents if parents is not None else [{"number": 450, "title": "Floor"}]
        self.kids = kids if kids is not None else {450: [
            {"number": 451, "createdAt": "2026-11-15T01:50:00Z", "body": "**Part of**: #450."},
            {"number": 452, "createdAt": "2026-11-15T02:05:00Z", "body": "**Part of**: #450."},
            {"number": 453, "createdAt": "2026-11-15T02:06:00Z", "body": "Part of #450"},
            {"number": 454, "createdAt": "2026-11-15T02:07:00Z", "body": "**Part of**: #4500."}]}

    def account(self, tool, args):
        assert tool == "get_team_status"
        self.calls += 1
        if isinstance(self.team, Exception):
            raise self.team
        return self.team

    def gh(self, args):
        self.searches.append(list(args))
        if "--label" in args:
            assert args[args.index("--label") + 1] == "factory-plan"
            return json.dumps(self.parents)
        n = int(args[args.index("--search") + 1].split("#")[1].split()[0])
        return json.dumps(self.kids.get(n, []))


def reader(fake, cfg=CFG):
    return planners.Planners(cfg, fake.account, fake.gh)


class Planners(unittest.TestCase):
    def test_no_planner_pool_makes_no_call(self):
        f = Fake(status(BOSS_RUNNING))
        r = reader(f, {"repo": "o/r", "types": {"coder": {"max_jobs": 1, "coworkers": []}}})
        self.assertEqual([r.read(b) for b in range(1, 12)], [[]] * 11)
        self.assertEqual((f.calls, f.searches), (0, []))

    def test_a_running_boss_and_a_labelled_parent_make_one_plan(self):
        f = Fake(status(BOSS_RUNNING, {"id": "other", "name": "code", "running": [{"runId": "x", "startedAt": START}]}))
        self.assertEqual(reader(f).read(1), [{"parent": 450, "title": "Floor", "children": 3, "filed": 2, "coworkers": [
            {"id": BOSS, "name": "Boss", "runId": "run-b1", "startedAt": START, "steps": 12}]}])

    def test_the_status_is_read_on_beat_one_and_every_second_beat_and_reused_between(self):
        f = Fake(status(BOSS_RUNNING))
        r = reader(f)
        got = [r.read(b) for b in range(1, 11)]
        self.assertEqual(f.calls, 6)
        self.assertEqual(len([s for s in f.searches if "--label" in s]), 6)
        self.assertEqual(got[0], got[2])
        self.assertEqual(got[5], got[6])

    def test_a_missing_agents_or_running_counts_as_empty(self):
        for team in ({}, {"agents": None}, status({"id": BOSS, "name": "Boss"}), status({"id": BOSS, "running": None}), None):
            out = reader(Fake(team)).read(1)
            self.assertEqual([p["coworkers"] for p in out], [[]], team)
            self.assertEqual(out[0]["filed"], 0)

    def test_a_run_without_an_iso_start_or_a_run_id_is_dropped(self):
        team = status({"id": BOSS, "name": "Boss", "running": [
            {"runId": "a", "startedAt": 1794000000}, {"runId": "b", "startedAt": "yesterday"}, {"startedAt": START},
            {"runId": "c", "startedAt": "2026-11-15T02:00:00.5+00:00", "steps": "many"}]})
        self.assertEqual(reader(Fake(team)).read(1)[0]["coworkers"], [
            {"id": BOSS, "name": "Boss", "runId": "c", "startedAt": "2026-11-15T02:00:00.5+00:00", "steps": None}])

    def test_no_labelled_parent_and_a_running_planner_is_one_plan_with_no_parent(self):
        f = Fake(status(BOSS_RUNNING), parents=[])
        self.assertEqual(reader(f).read(1), [{"parent": None, "title": "", "children": 0, "filed": 0, "coworkers": [
            {"id": BOSS, "name": "Boss", "runId": "run-b1", "startedAt": START, "steps": 12}]}])
        self.assertFalse([s for s in f.searches if "--search" in s])

    def test_no_labelled_parent_and_no_running_planner_is_no_plan(self):
        self.assertEqual(reader(Fake(status({"id": BOSS, "name": "Boss"}), parents=[])).read(1), [])

    def test_an_account_error_keeps_the_last_result_and_never_raises(self):
        f = Fake(status(BOSS_RUNNING))
        r = reader(f)
        first = r.read(1)
        f.team = RuntimeError("down")
        self.assertEqual(r.read(5), first)
        self.assertEqual(r.read(6), first)

    def test_a_first_read_that_fails_is_empty_and_not_retried_before_the_next_second_beat(self):
        f = Fake(RuntimeError("down"))
        r = reader(f)
        self.assertEqual([r.read(b) for b in range(1, 4)], [[]] * 3)
        self.assertEqual(f.calls, 2)
        f.team = status(BOSS_RUNNING)
        self.assertEqual(r.read(4)[0]["parent"], 450)

    def test_at_most_five_parents_and_eight_runs(self):
        parents = [{"number": 400 + n, "title": "P%d" % n} for n in range(7)]
        runs = [{"runId": "r%d" % n, "startedAt": START} for n in range(10)]
        out = reader(Fake(status({"id": BOSS, "name": "Boss", "running": runs}), parents=parents)).read(1)
        self.assertEqual([p["parent"] for p in out], [400, 401, 402, 403, 404])
        self.assertEqual(len(out[0]["coworkers"]), 8)


if __name__ == "__main__":
    unittest.main()
