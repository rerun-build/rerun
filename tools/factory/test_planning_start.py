import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
import store as S

P1, P2 = "p1", "p2"
CFG = {"repo": "o/r", "types": {"planner": {"coworkers": [
    {"id": P1, "name": "One", "runs": 1}, {"id": P2, "name": "Two", "runs": 2}]}}}


def issue(n, label, created):
    return {"number": n, "title": "T%d" % n, "labels": [{"name": label}], "createdAt": created}


BACKLOG = [issue(11, "P0", "2026-11-10T00:00:00Z"), issue(12, "P0", "2026-11-05T00:00:00Z"),
           issue(30, "P1", "2026-11-01T00:00:00Z")]
STAMP = "1970-01-01T00:16:40Z"


class Rig:
    def __init__(self, cfg=None, children=None):
        self.dir = tempfile.TemporaryDirectory()
        self.store = S.Store(os.path.join(self.dir.name, "s.db"))
        self.cfg = cfg or json.loads(json.dumps(CFG))
        self.children = children or {}
        self.calls, self.sends, self.runs = [], [], []
        self.fail = []
        self.fail_after_run = []
        self.station = planning.Station(self.cfg, self.store, self.account, self.gh, lambda: 1000.0)

    def gh(self, args):
        self.calls.append(list(args))
        if "--search" in args:
            n = int(args[args.index("--search") + 1].split("#")[1].split()[0])
            return json.dumps(self.children.get(n, []))
        if args[:2] == ["issue", "list"]:
            return json.dumps(BACKLOG)
        return ""

    def account(self, tool, args):
        if tool == "send_message":
            n = len(self.sends) + 1
            if self.fail:
                self.fail.pop(0)
                raise RuntimeError("TimeoutError")
            self.sends.append((args["agentId"], args["message"], args["goal"]))
            self.runs.append({"runId": "run%d" % n, "agentId": args["agentId"], "startedAt": STAMP})
            if self.fail_after_run:
                self.fail_after_run.pop(0)
                raise RuntimeError("TimeoutError")
            return {"runId": "run%d" % n, "status": "running"}
        if tool == "list_runs":
            return [r for r in self.runs if r["agentId"] == args["agentId"]]
        return {"status": "running"}

    def listed(self):
        return [c for c in self.calls if c[:2] == ["issue", "list"] and "--search" not in c]

    def edits(self):
        return [(c[2], c[c.index("--add-label") + 1] if "--add-label" in c else "-" + c[c.index("--remove-label") + 1])
                for c in self.calls if c[:2] == ["issue", "edit"]]

    def numbers(self):
        return [int(s[1].split("#")[1].split(",")[0].split()[0]) for s in self.sends]


class Start(unittest.TestCase):
    def test_two_sends_in_order(self):
        r = Rig()
        r.station.once(1)
        self.assertEqual([s[0] for s in r.sends], [P1, P2])
        self.assertEqual(r.numbers(), [12, 11])
        self.assertEqual(r.sends[0][2], {"lastLineForms": planning.GOAL, "turnLimit": 3})
        self.assertEqual([c[2] for c in r.calls if c[:2] == ["issue", "edit"]], ["12", "11"])
        self.assertEqual([e[1] for e in r.edits()], ["factory-plan", "factory-plan"])
        rec = r.store.get_all("plan:12")
        self.assertEqual((rec["run"], rec["state"], rec["started"]), ("run1", "running", STAMP))

    def test_parallel_setting(self):
        r = Rig()
        r.cfg["planning"] = {"parallel": 1}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        r.station.once(1)
        self.assertEqual(len(r.sends), 1)
        r = Rig()
        r.cfg["planning"] = {"parallel": 3}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        r.station.once(1)
        self.assertEqual([s[0] for s in r.sends], [P1, P2, P2])

    def test_backlog_read_every_fifth_beat(self):
        r = Rig()
        r.cfg["planning"] = {"parallel": 5}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        for beat in range(1, 6):
            r.station.once(beat)
        self.assertEqual(len(r.listed()), 1)
        r.station.once(6)
        self.assertEqual(len(r.listed()), 2)

    def test_open_child_skips_parent(self):
        r = Rig(children={12: [{"number": 101, "body": "**Part of**: #12"}]})
        r.station.once(1)
        self.assertEqual(r.numbers(), [11, 30])

    def test_parallel_five_sends_three(self):
        r = Rig()
        r.cfg["planning"] = {"parallel": 5}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        r.station.once(1)
        r.station.once(6)
        self.assertEqual(len(r.sends), 3)

    def test_failed_send_is_retried(self):
        r = Rig()
        r.fail = [1]
        r.station.once(1)
        self.assertEqual(r.store.get_all("plan:12")["state"], "unsent")
        self.assertIn(("12", "-factory-plan"), [(c[2], "-" + c[c.index("--remove-label") + 1]) for c in r.calls
                                                if c[:2] == ["issue", "edit"] and "--remove-label" in c])
        self.assertEqual(r.numbers(), [11])
        r.station.once(6)
        self.assertEqual(r.numbers(), [11, 12])
        self.assertEqual(r.store.get_all("plan:12")["state"], "running")

    def test_no_pool_or_auto_off(self):
        r = Rig(cfg={"repo": "o/r", "types": {"coder": {"coworkers": []}}})
        r.station.once(1)
        r2 = Rig()
        r2.cfg["planning"] = {"auto": False}
        r2.station = planning.Station(r2.cfg, r2.store, r2.account, r2.gh, lambda: 1000.0)
        r2.station.once(1)
        self.assertEqual((r.calls, r.sends, r2.calls, r2.sends), ([], [], [], []))

    def test_send_that_raised_after_the_run_started_is_adopted(self):
        r = Rig()
        r.cfg["planning"] = {"parallel": 1}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        r.fail_after_run = [1]
        r.station.once(1)
        r.station.once(6)
        self.assertEqual(len(r.sends), 1)
        rec = r.store.get_all("plan:12")
        self.assertEqual((rec["state"], rec["run"]), ("running", "run1"))

    def test_next_beat_adoption_records_run_and_label(self):
        r = Rig()
        r.cfg["planning"] = {"parallel": 1}
        r.station = planning.Station(r.cfg, r.store, r.account, r.gh, lambda: 1000.0)
        r.fail = [1]
        r.station.once(1)
        r.runs.append({"runId": "late1", "agentId": P2, "startedAt": STAMP})
        r.runs.append({"runId": "late1", "agentId": P1, "startedAt": STAMP})
        r.station.once(6)
        rec = r.store.get_all("plan:12")
        self.assertEqual((rec["state"], rec["run"]), ("running", "late1"))
        self.assertIn("late1", r.store.known_run_ids())
        self.assertEqual(len(r.sends), 0)
        self.assertEqual([e for e in r.edits() if e[0] == "12"],
                         [("12", "factory-plan"), ("12", "-factory-plan"), ("12", "factory-plan")])

    def test_set_many_rolls_back_all_kv_fields_if_interrupted_mid_write(self):
        r = Rig()
        self.addCleanup(r.store.close)
        self.addCleanup(r.dir.cleanup)
        r.store.db.execute(
            "CREATE TEMP TRIGGER kill_second AFTER INSERT ON kv "
            "WHEN (SELECT COUNT(*) FROM kv WHERE job=NEW.job) >= 2 "
            "BEGIN SELECT RAISE(ABORT, 'killed mid-write'); END")

        with self.assertRaises(Exception):
            for k, v in (("state", "sending"), ("agent", P1), ("copy", 1)):
                r.store.set("plan:99", k, v)
        self.assertEqual(r.store.get_all("plan:99"), {"state": "sending"})
        with self.assertRaises(KeyError):
            r.station.running()
        r.store.forget("plan:99")

        with self.assertRaises(Exception):
            r.station.send(BACKLOG[0], (P1, 1))
        self.assertEqual(r.store.get_all("plan:11"), {})
        self.assertEqual(r.station.running(), [])

        r.cfg["planning"] = {"plan_by": ["One"], "cut_by": ["Two"], "recheck": {"tries": 1}}
        r.station = planning.Station(r.cfg, r.store, r.account, lambda a: "a" * 40 if "commits/dev" in str(a) else r.gh(a), lambda: 1000.0)
        r.store.put_job("7", "waiting", {"issue": 7, "title": "Fix 7", "body": "", "recheck": True, "rechecks": 1})
        with self.assertRaises(Exception):
            r.station.send_recheck(r.store.get_job("7"))
        self.assertEqual(r.store.get_all("recheck:7"), {})
        self.assertEqual(r.station.running(), [])


if __name__ == "__main__":
    unittest.main()
