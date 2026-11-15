import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import store as ledger_store

NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}
BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"


def plan(parent=450, **kw):
    entry = {"parent": parent, "title": "Floor", "children": 3, "filed": 2, "coworkers": [
        {"id": BOSS, "name": "Boss", "runId": "run-b1", "startedAt": "2026-11-15T02:00:00Z", "steps": 12}]}
    entry.update(kw)
    return entry


class Planning(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def build(self, **kw):
        return snapshot.build_snapshot(self.st, CFG, NOW, None, beat=3, **kw)

    def test_no_planning_leaves_the_key_out(self):
        self.assertNotIn("planning", self.build())
        self.assertNotIn("planning", self.build(planning=[]))
        self.assertNotIn("planning", self.build(planning=None))

    def test_a_plan_is_carried_with_the_contract_keys(self):
        snap = self.build(planning=[plan()])
        self.assertEqual(snap["planning"], [plan()])
        self.assertEqual(set(snap["planning"][0]), {"parent", "title", "coworkers", "children", "filed"})
        self.assertEqual(set(snap["planning"][0]["coworkers"][0]), {"id", "name", "runId", "startedAt", "steps"})
        json.dumps(snap)

    def test_an_entry_with_no_parent_is_carried_with_parent_none(self):
        snap = self.build(planning=[plan(None, title="", children=0, filed=0)])
        entry = snap["planning"][0]
        self.assertEqual((entry["parent"], entry["title"], entry["children"], entry["filed"]), (None, "", 0, 0))
        json.dumps(snap)

    def test_limits_follow_the_contract(self):
        runs = [dict(plan()["coworkers"][0], runId="r" * 80, id="i" * 80, name="n" * 80) for _ in range(9)]
        snap = self.build(planning=[plan(400 + n, title="t" * 300, coworkers=runs, children=-4, filed=-1) for n in range(6)])
        self.assertEqual(len(snap["planning"]), 5)
        entry = snap["planning"][0]
        self.assertEqual((len(entry["title"]), len(entry["coworkers"]), entry["children"], entry["filed"]), (256, 8, 0, 0))
        self.assertEqual({len(entry["coworkers"][0][k]) for k in ("id", "name", "runId")}, {64})

    def test_steps_stay_a_count_or_none(self):
        snap = self.build(planning=[plan(coworkers=[dict(plan()["coworkers"][0], steps=None), dict(plan()["coworkers"][0], steps=-3)])])
        self.assertEqual([c["steps"] for c in snap["planning"][0]["coworkers"]], [None, 0])


if __name__ == "__main__":
    unittest.main()
