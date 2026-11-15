import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
import store as S

CFG = {"repo": "o/r", "types": {"planner": {"coworkers": [{"id": "p1", "name": "One", "runs": 1}]}}}
STARTED = "1970-01-01T00:16:40Z"


def body(n, depends=True, path="tools/factory/y.py"):
    lines = ["PLAN READY (cut of #12; facts read on dev abcdef1)", "", "**Part of**: #12", "**Worker**: coder",
             "**Test file**: `tools/factory/test_y.py`", "", "**Files**", "- `%s`" % path,
             "- `tools/factory/test_y.py`", "", "**Change**", "- x", ""]
    if depends:
        lines.append("**Depends on**: none")
    return "\n".join(lines)


class Rig:
    def __init__(self, state="running", now=1100.0, bodies=None, changed=None):
        self.dir = tempfile.TemporaryDirectory()
        self.store = S.Store(os.path.join(self.dir.name, "s.db"))
        self.cfg = json.loads(json.dumps(CFG))
        self.bodies = bodies or {}
        self.changed = changed or []
        self.calls, self.acalls = [], []
        self.status = {"status": "running"}
        for k, v in (("state", state), ("agent", "p1"), ("copy", 1), ("run", "run1"), ("started", STARTED),
                     ("title", "T"), ("why", "")):
            self.store.set("plan:12", k, v)
        self.station = planning.Station(self.cfg, self.store, self.account, self.gh, lambda: now)

    def gh(self, args):
        self.calls.append(list(args))
        if args[:2] == ["issue", "view"]:
            k = int(args[2])
            return json.dumps({"number": k, "title": "C%d" % k, "labels": [], "body": self.bodies.get(k, body(k))})
        if args[0] == "api":
            return json.dumps({"status": "ahead", "files": [{"filename": f} for f in self.changed]})
        return ""

    def account(self, tool, args):
        self.acalls.append(tool)
        if tool == "get_run":
            return self.status
        return {}

    def edits(self):
        return [(c[2], c[c.index("--add-label") + 1] if "--add-label" in c else "-" + c[c.index("--remove-label") + 1])
                for c in self.calls if c[:2] == ["issue", "edit"]]

    def comments(self):
        return [c for c in self.calls if c[:2] == ["issue", "comment"]]

    def record(self):
        return self.store.get_all("plan:12")


class Finish(unittest.TestCase):
    def test_running_stays(self):
        r = Rig()
        r.station.once(2)
        self.assertEqual(r.calls, [])
        self.assertEqual(r.record()["state"], "running")

    def test_cut_labels_children(self):
        r = Rig()
        r.status = {"status": "done", "output": "CUT: #601, #602"}
        r.station.once(2)
        self.assertEqual(r.edits(), [("601", "factory"), ("602", "factory"), ("12", "-factory-plan")])
        self.assertEqual(r.record()["state"], "cut")
        self.assertEqual(r.record()["why"], "#601, #602")

    def test_child_missing_depends_gets_comment(self):
        r = Rig(bodies={602: body(602, depends=False)})
        r.status = {"status": "done", "output": "CUT: #601, #602"}
        r.station.once(2)
        self.assertEqual(len(r.comments()), 1)
        self.assertEqual(r.comments()[0][2], "602")
        self.assertEqual(r.edits(), [("601", "factory"), ("12", "-factory-plan")])

    def test_stale_path_gets_comment_no_label(self):
        r = Rig(changed=["tools/factory/x.py", "tools/factory/y.py"])
        r.status = {"status": "done", "output": "CUT: #601"}
        r.station.once(2)
        self.assertEqual(len(r.comments()), 1)
        self.assertEqual(r.comments()[0][2], "601")
        self.assertEqual(r.edits(), [("12", "-factory-plan")])

    def test_blocked_comments(self):
        r = Rig()
        r.status = {"status": "done", "output": "BLOCKED: the design is missing"}
        r.station.once(2)
        self.assertEqual(r.record()["state"], "blocked")
        self.assertEqual(r.edits(), [("12", "-factory-plan")])
        self.assertEqual(len(r.comments()), 1)
        c = r.comments()[0]
        self.assertEqual(c[c.index("--body") + 1], "The factory planner stopped: the design is missing")

    def test_error_status(self):
        r = Rig()
        r.status = {"status": "error"}
        r.station.once(2)
        self.assertEqual(r.record()["state"], "blocked")
        self.assertEqual(r.record()["why"], "the plan run ended error")

    def test_over_limit_cancels(self):
        r = Rig(now=3701.0)
        r.station.once(2)
        self.assertEqual(r.acalls, ["get_run", "cancel_run"])
        self.assertEqual(r.record()["state"], "blocked")

    def test_sending_is_lost(self):
        r = Rig(state="sending")
        r.station.once(2)
        self.assertEqual(r.acalls, [])
        self.assertEqual(r.record()["state"], "lost")

    def test_finished_not_read_again(self):
        r = Rig()
        r.status = {"status": "done", "output": "CUT: #601"}
        r.station.once(2)
        n = len(r.acalls)
        r.station.once(3)
        self.assertEqual(len(r.acalls), n)


if __name__ == "__main__":
    unittest.main()
