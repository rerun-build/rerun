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
    def __init__(self, state="running", now=1100.0, bodies=None, changed=None, open_issues=None):
        self.dir = tempfile.TemporaryDirectory()
        self.open_issues = open_issues
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
        if args[:2] == ["issue", "list"] and self.open_issues is not None:
            return json.dumps([{"number": k} for k in self.open_issues])
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

    def child_comments(self):
        return [c for c in self.calls if c[:2] == ["issue", "comment"] and c[2] != "12"]

    def shape(self):
        return [c[c.index("--body") + 1] for c in self.calls if c[:2] == ["issue", "comment"] and c[2] == "12"]

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
        self.assertEqual(len(r.child_comments()), 1)
        self.assertEqual(r.child_comments()[0][2], "602")
        self.assertEqual(r.edits(), [("601", "factory"), ("12", "-factory-plan")])
        self.assertEqual(len(r.shape()), 1)
        self.assertIn("| all | 2 | 1 |", r.shape()[0])
        self.assertIn("refused by the checks: #602", r.shape()[0])

    def test_stale_path_gets_comment_no_label(self):
        r = Rig(changed=["tools/factory/x.py", "tools/factory/y.py"])
        r.status = {"status": "done", "output": "CUT: #601"}
        r.station.once(2)
        self.assertEqual(len(r.child_comments()), 1)
        self.assertEqual(r.child_comments()[0][2], "601")
        self.assertEqual(r.edits(), [("12", "-factory-plan")])

    def test_cut_posts_its_shape_by_type(self):
        r = Rig(bodies={602: body(602).replace("**Depends on**: none", "**Depends on**: #601"),
                        603: body(603).replace("**Worker**: coder", "**Worker**: researcher")})
        r.status = {"status": "done", "output": "CUT: #601, #602, #603"}
        r.station.once(2)
        self.assertEqual(len(r.shape()), 1)
        text = r.shape()[0]
        self.assertTrue(text.startswith("## Cut shape"))
        for line in ("Children: #601, #602, #603", "| coder | 2 | 1 |", "| researcher | 1 | 1 |", "| all | 3 | 2 |"):
            self.assertIn(line, text)

    def test_the_cut_shape_names_the_longest_chain(self):
        r = Rig(bodies={602: body(602).replace("**Depends on**: none", "**Depends on**: #601"),
                        603: body(603).replace("**Depends on**: none", "**Depends on**: #602")})
        r.status = {"status": "done", "output": "CUT: #601, #602, #603"}
        r.station.once(2)
        self.assertEqual(len(r.shape()), 1)
        self.assertIn("| all | 3 | 1 |\n\nLongest chain: 3 (#601 -> #602 -> #603)", r.shape()[0])
        r = Rig()
        r.status = {"status": "done", "output": "CUT: #602, #601"}
        r.station.once(2)
        self.assertIn("Longest chain: 1 (#601)", r.shape()[0])

    def test_an_open_outside_dependency_waits(self):
        r = Rig(bodies={601: body(601).replace("**Depends on**: none", "**Depends on**: #700"),
                        602: body(602).replace("**Depends on**: none", "**Depends on**: #701")},
                open_issues=[700])
        r.status = {"status": "done", "output": "CUT: #601, #602"}
        r.station.once(2)
        self.assertEqual(len(r.shape()), 1)
        self.assertIn("| coder | 2 | 1 |", r.shape()[0])

    def test_unread_open_issues_count_as_waiting(self):
        r = Rig(bodies={601: body(601).replace("**Depends on**: none", "**Depends on**: #700")})
        r.status = {"status": "done", "output": "CUT: #601"}
        r.station.once(2)
        self.assertEqual(len(r.shape()), 1)
        self.assertIn("| coder | 1 | 0 |", r.shape()[0])
        self.assertIn("could not be read", r.shape()[0])
        self.assertEqual(r.record()["state"], "cut")

    def test_cut_after_repair_posts_its_shape(self):
        r = Rig(state="repairing", bodies={602: body(602, depends=False)})
        r.cfg["planning"] = {"repair": {"tries": 1}}
        r.store.set("plan:12", "cut_children", json.dumps([601, 602]))
        r.store.set("plan:12", "repair", json.dumps({"602": ["dependency line"]}))
        r.store.set("plan:12", "repair_tries", "1")
        r.status = {"status": "done", "output": "FIXED: the dependency line"}
        r.station.once(2)
        self.assertEqual(r.record()["state"], "cut")
        self.assertEqual(len(r.shape()), 1)
        for line in ("Children: #601, #602", "| coder | 2 | 1 |", "| all | 2 | 1 |", "refused by the checks: #602"):
            self.assertIn(line, r.shape()[0])

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
        r.store.set("plan:12", "resent", '["plan"]')
        r.station.once(2)
        self.assertEqual(r.record()["state"], "blocked")
        self.assertEqual(r.record()["why"], "the plan run ended error")

    def test_over_limit_cancels(self):
        r = Rig(now=3701.0)
        r.store.set("plan:12", "resent", '["plan"]')
        r.station.once(2)
        self.assertEqual(r.acalls, ["get_run", "cancel_run"])
        self.assertEqual(r.record()["state"], "blocked")

    def test_first_loss_of_the_plan_step_is_kept_for_one_send_again(self):
        r = Rig()
        r.status = {"status": "error", "handoverPath": "/d/n.md"}
        r.station.once(2)
        rec = r.record()
        self.assertEqual((rec["state"], rec["resent"], rec["handover"]), ("unsent", '["plan"]', "/d/n.md"))

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
