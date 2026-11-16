import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as TD

BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"
PLANNER = {"coworkers": [{"id": "p1", "name": "One", "runs": 1}]}


def backlog():
    return [{"number": 11, "title": "T11", "labels": [{"name": "P0"}], "createdAt": "2026-11-10T00:00:00Z"}]


class PWorld(TD.World):
    def __init__(self):
        super().__init__(issues=[])
        self.backlog = backlog()
        self.listed = 0

    def gh(self, args):
        a = list(args)
        if a[:2] == ["issue", "list"] and "--search" in a:
            self.gh_calls.append(a)
            return "[]"
        if a[:2] == ["issue", "list"] and "--label" not in a:
            self.gh_calls.append(a)
            self.listed += 1
            return json.dumps(self.backlog)
        if a[:2] == ["issue", "edit"] and "--add-label" in a and a[2] == "11":
            label = a[a.index("--add-label") + 1]
            if label != "factory":
                self.backlog[0]["labels"].append({"name": label})
        return super().gh(a)


class Queue(TD.Base):
    max_queue = 3

    def setUp(self):
        super().setUp()
        self.w = PWorld()
        self.w.ledger = self.cfg["ledger_file"]
        self.cfg["types"] = {"planner": PLANNER}
        self.cfg["planning"] = {"max_queue": self.max_queue}

    def fill(self, n, state="queued"):
        self.w.backlog = []
        self.tick()
        self.w.backlog = backlog()
        for i in range(n):
            self.d.store.put_job(str(1000 + i), state, {"issue": 1000 + i})

    def planned(self):
        return [s for s in self.w.sends if "#11" in s[1]]

    def test_no_cut_when_queue_is_at_max(self):
        self.fill(3)
        self.w.listed = 0
        self.d.beats = 5
        self.tick()
        self.assertEqual(self.planned(), [])
        self.assertEqual(self.w.listed, 0)

    def test_one_below_max_still_plans(self):
        self.fill(2)
        self.d.beats = 5
        self.tick()
        self.assertEqual(len(self.planned()), 1)

    def test_waiting_jobs_count_too(self):
        self.fill(3, "waiting")
        self.d.beats = 5
        self.tick()
        self.assertEqual(self.planned(), [])

    def plans_with(self, state):
        self.fill(3, state)
        self.d.beats = 5
        self.tick()
        return len(self.planned())

    def test_building_jobs_do_not_count(self):
        self.assertEqual(self.plans_with("building"), 1)

    def test_review_wait_jobs_do_not_count(self):
        self.assertEqual(self.plans_with("review_wait"), 1)

    def test_max_queue_defaults_to_20(self):
        del self.cfg["planning"]
        self.fill(20)
        self.d.beats = 5
        self.tick()
        self.assertEqual(self.planned(), [])

    def test_max_queue_default_lets_19_plan(self):
        del self.cfg["planning"]
        self.fill(19)
        self.d.beats = 5
        self.tick()
        self.assertEqual(len(self.planned()), 1)


class Blocked(TD.Base):
    def setUp(self):
        super().setUp()
        self.w = PWorld()
        self.w.ledger = self.cfg["ledger_file"]
        self.cfg["types"] = {"planner": PLANNER}

    def run_blocked(self, text):
        self.tick()
        self.assertEqual(len(self.w.sends), 1)
        self.w.runs["run1"] = {"status": "done", "output": text}
        self.tick()

    def likely_fixed(self):
        return [c for c in self.w.gh_calls if c[:3] == ["issue", "edit", "11"] and "likely-fixed" in c]

    def comments(self):
        return [c for c in self.w.gh_calls if c[:3] == ["issue", "comment", "11"]]

    def test_blocked_already_built_labels_likely_fixed(self):
        self.run_blocked("BLOCKED: the parent is already built by #700")
        self.assertEqual(len(self.likely_fixed()), 1)
        self.assertEqual(self.d.station.store.get_all("plan:11")["state"], "blocked")
        self.assertTrue(self.comments())
        self.d.station.store.set("plan:11", "state", "unsent")
        before = len(self.w.sends)
        self.d.beats = 5
        self.tick()
        self.assertEqual(len(self.w.sends), before)

    def test_other_blocked_reason_no_label(self):
        self.run_blocked("BLOCKED: the issue names no file")
        self.assertEqual(self.likely_fixed(), [])
        self.assertTrue(self.comments())


class Shipped(TD.Base):
    def test_shipped_settings_keep_boss_first(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")
        with open(path) as f:
            shipped = json.load(f)
        self.assertEqual(shipped["planning"]["max_queue"], 20)
        self.w = PWorld()
        self.w.ledger = self.cfg["ledger_file"]
        self.cfg["types"] = {"planner": shipped["types"]["planner"]}
        self.cfg["planning"] = shipped["planning"]
        self.tick()
        self.assertEqual(self.w.sends[0][0], BOSS)


if __name__ == "__main__":
    unittest.main()
