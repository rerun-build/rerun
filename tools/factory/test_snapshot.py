import json, os, sys, tempfile, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import store as ledger_store

SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "packages", "contracts", "fixtures", "factory-snapshot.sample.json")
NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


def kinds(v):
    return {k: type(x).__name__ for k, x in v.items()}


def full(v):
    return {"history": [], "runs": [], **{k: x for k, x in v.items() if k not in ("department", "departments")}}


class Snapshot(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, **data):
        d = {"issue": n, "title": "T%d" % n, "body": "**Depends on**: none\n"}
        d.update(data)
        self.st.put_job(str(n), state, d, data.get("reason"))

    def build(self, hold=None):
        return snapshot.build_snapshot(self.st, CFG, NOW, hold, beat=7)

    def test_keys_and_types_match_the_sample(self):
        sample = json.load(open(SAMPLE))
        fid = self.st.intent("5", "", "build", coworker="CODE")
        self.st.steps_seen(fid, 4)
        self.put(5, "building", agent="b1", copy=1, fire_id=fid, pr=None, round=1)
        self.put(6, "waiting", waiting=[5, 9])
        self.put(7, "merged", pr=11, round=2)
        snap = self.build({"kind": "sign-in renewal", "until": NOW + 60})
        self.assertEqual(set(snap) - {"digest"}, set(sample) - {"plan"})
        self.assertEqual(kinds(snap["jobs"][0]), kinds(full(sample["jobs"][0])))
        self.assertEqual(kinds(snap["jobs"][2]), {**kinds(full(sample["jobs"][5])), "pr": "int", "round": "int"})
        self.assertEqual(kinds(snap["jobs"][1]), kinds(full(sample["jobs"][2])))
        self.assertEqual(set(snap["holds"][0]), set(sample["holds"][0]))
        self.assertEqual(kinds(snap["holds"][0]), kinds(sample["holds"][0]))
        self.assertEqual(set(snap["pools"][0]), set(sample["pools"][0]))
        self.assertEqual(kinds(snap["pools"][0]["coworkers"][0]), kinds(sample["pools"][0]["coworkers"][0]))
        self.assertEqual(kinds(snap["endedToday"]), kinds(sample["endedToday"]))
        self.assertEqual(set(snap["endedToday"]), set(sample["endedToday"]))
        self.assertEqual(snap["jobs"][0]["steps"], 4)
        self.assertEqual(snap["jobs"][0]["coworker"], "CODE")
        self.assertEqual(snap["jobs"][1]["reason"], "waits on #5, #9")
        self.assertIsNone(snap["jobs"][2]["coworker"])
        self.assertEqual(snap["madeAt"][-1], "Z")
        self.assertEqual(snap["beat"], 7)
        json.dumps(snap)

    def test_limits(self):
        self.put(1, "blocked", title="x" * 400, reason="y" * 500, body="**Depends on**: " + ", ".join("#%d" % n for n in range(100, 125)) + "\n")
        j = self.build()["jobs"][0]
        self.assertEqual((len(j["title"]), len(j["reason"]), len(j["dependsOn"])), (256, 300, 20))
        for n in range(2, 306):
            self.put(n, "merged" if n % 2 else "queued")
        snap = self.build()
        self.assertEqual(len(snap["jobs"]), 300)
        self.assertEqual({x["state"] for x in snap["jobs"] if x["issue"] % 2 == 0 and x["issue"] > 1}, {"queued"})
        self.assertEqual([x["issue"] for x in snap["jobs"]], sorted(x["issue"] for x in snap["jobs"]))

    def test_enteredAt_is_the_last_state_change(self):
        self.st.put_job("3", "queued", {"issue": 3, "title": "t"}, at="2026-11-14T01:00:00Z")
        self.st.put_job("3", "queued", {"issue": 3, "title": "t"}, at="2026-11-14T02:00:00Z")
        self.assertEqual(self.build()["jobs"][0]["enteredAt"], "2026-11-14T01:00:00Z")
        self.st.put_job("3", "building", {"issue": 3, "title": "t"}, at="2026-11-14T03:00:00Z")
        self.st.put_job("3", "building", {"issue": 3, "title": "t"}, at="2026-11-14T04:00:00Z")
        self.assertEqual(self.build()["jobs"][0]["enteredAt"], "2026-11-14T03:00:00Z")

    def test_parent_comes_from_cutshape_and_is_none_when_absent(self):
        self.put(4, "queued")
        self.assertIsNone(self.build()["jobs"][0]["parent"])
        with unittest.mock.patch.object(snapshot.cutshape, "parse", return_value={"parent": 312, "deps": []}):
            self.assertEqual(self.build()["jobs"][0]["parent"], 312)

    def test_pools_holds_and_ended_today(self):
        self.put(1, "building", agent="b1", copy=1)
        self.put(2, "building", agent="b1", copy=2)
        self.put(3, "reviewing", agent="r1", copy=1)
        self.put(4, "merged")
        self.put(5, "blocked")
        self.st.put_job("6", "merged", {"issue": 6, "title": "old"}, at="2020-01-01T00:00:00Z")
        snap = self.build({"kind": "sign-in renewal", "until": 1794000060.0})
        pools = [{**p, "coworkers": [c for c in p["coworkers"]]} for p in snap["pools"]]
        self.assertEqual(pools, [
            {"type": "coder", "coworkers": [{"name": "CODE", "id": "b1", "runs": 2, "out": 2}]},
            {"type": "reviewer", "coworkers": [{"name": "LINUS", "id": "r1", "runs": 1, "out": 1}]}])
        self.assertEqual(snap["holds"], [{"kind": "sign-in renewal", "until": snapshot.iso(1794000060.0)}])
        self.assertEqual(snap["holds"][0]["until"][-1], "Z")
        self.assertEqual(snap["endedToday"], {"merged": 1, "rejected": 0, "blocked": 1, "failed": 0, "returned": 0})
        self.assertEqual(self.build()["holds"], [])

    def test_a_job_closed_by_hand_carries_closedOutside(self):
        self.put(5, "blocked", reason="x")
        self.put(6, "failed")
        self.st.set("5", "closed_seen", "1794000000")
        snap = self.build()
        j = {x["issue"]: x for x in snap["jobs"]}
        self.assertIs(j[5]["closedOutside"], True)
        self.assertNotIn("closedOutside", j[6])
        json.dumps(snap)


if __name__ == "__main__":
    unittest.main()
