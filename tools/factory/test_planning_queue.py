import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
from test_planning_start import Rig, BACKLOG

HERE = os.path.dirname(os.path.abspath(__file__))
BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"


def fill(rig, count, state):
    for k in range(count):
        rig.store.put_job("job%d" % k, state, {})


class Queue(unittest.TestCase):
    def rig(self):
        r = Rig()
        r.cfg["planning"] = {"max_queue": 20}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        return r

    def test_no_cut_when_queue_is_at_max(self):
        r = self.rig()
        for k in range(10):
            r.store.put_job("q%d" % k, "queued", {})
            r.store.put_job("w%d" % k, "waiting", {})
        r.station.start()
        self.assertEqual(r.sends, [])
        self.assertEqual(r.listed(), [])
        r = self.rig()
        fill(r, 19, "queued")
        r.station.start()
        self.assertEqual(len(r.sends), 2)

    def test_only_waiting_and_queued_count(self):
        r = self.rig()
        for k in range(10):
            r.store.put_job("a%d" % k, "building", {})
            r.store.put_job("b%d" % k, "review_wait", {})
        r.station.start()
        self.assertEqual(len(r.sends), 2)

    def test_max_queue_defaults_to_20(self):
        r = Rig()
        fill(r, 20, "queued")
        r.station.start()
        self.assertEqual(r.sends, [])
        r = Rig()
        fill(r, 19, "queued")
        r.station.start()
        self.assertEqual(len(r.sends), 2)


class Blocked(unittest.TestCase):
    def run_blocked(self, reason):
        r = Rig()
        r.station.start()
        n = r.numbers()[0]
        original = r.account

        def account(tool, args):
            if tool == "get_run":
                return {"status": "done", "output": "BLOCKED: %s" % reason}
            return original(tool, args)

        r.station.account = account
        r.station.once(2)
        return r, n

    def test_blocked_already_built_labels_likely_fixed(self):
        r, n = self.run_blocked("the parent is already built by #700")
        self.assertIn((str(n), "likely-fixed"), r.edits())
        labelled = [dict(i, labels=i["labels"] + [{"name": "likely-fixed"}]) if i["number"] == n else i for i in BACKLOG]
        r.sends.clear()

        def gh(args):
            if "--search" in args:
                return "[]"
            if args[:2] == ["issue", "list"]:
                return json.dumps(labelled)
            return ""

        r.station.gh = gh
        r.station.start()
        self.assertNotIn(n, r.numbers())

    def test_other_blocked_reason_no_label(self):
        r, n = self.run_blocked("the issue names no file")
        self.assertNotIn("likely-fixed", [e[1] for e in r.edits()])


class Shipped(unittest.TestCase):
    def test_shipped_settings_keep_boss_first(self):
        with open(os.path.join(HERE, "dispatch.json")) as f:
            cfg = json.load(f)
        self.assertEqual(cfg["planning"]["max_queue"], 20)
        r = Rig(cfg={"repo": "o/r", "planning": cfg["planning"], "types": {"planner": cfg["types"]["planner"]}})
        r.station.start()
        self.assertEqual(r.sends[0][0], BOSS)


if __name__ == "__main__":
    unittest.main()
