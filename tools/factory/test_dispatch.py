import contextlib, datetime, gc, io, json, os, sqlite3, sys, tempfile, unittest, unittest.mock, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D

HEAD = "abcdef1234567890"
T0 = datetime.datetime(2026, 11, 13, 18, 0, 0, tzinfo=datetime.timezone.utc).timestamp()


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def run_shape(rid, steps, started, status="running", tokens=120000):
    return {"runId": rid, "status": status, "steps": steps, "startedAt": iso(started), "finishedAt": None, "error": None,
            "totalTokens": tokens, "goal": {"lastLineForms": [{"prefix": "PR:", "rest": "pull-url"}, {"prefix": "BLOCKED:", "rest": "sentence"}],
                                           "turnLimit": 3, "state": "running", "verdicts": []}}

def ready(extra="", deps="none"):
    return "%s\n**Depends on**: %s\n**Worker**: coder\n**Files**\n- `a/b.py`\n- `a/test_b.py`\n**Test file**: `a/test_b.py`\n" % (extra, deps)


PR_LINE = "Done.\nPR: https://github.com/o/r/pull/42"
ACCEPT = "".join("EVIDENCE %d: shown\n" % n for n in range(1, 21)) + "VERDICT: ACCEPT @abcdef1"


class World:
    def __init__(self, issues=None):
        self.issues = issues if issues is not None else [{"number": 5, "title": "Fix x", "body": ready(), "comments": []}]
        self.sends, self.runs, self.order = [], {}, []
        self.gh_calls, self.merges = [], []
        self.workflows, self.pr_state, self.clock = {}, "OPEN", 1000.0
        self.cut_off_next_send = False
        self.mergeable, self.unlabelled = "MERGEABLE", set()
        self.open_numbers = {7, 129}
        self.close_reasons = {}
        self.open_prs = []
        self.branches = {}
        self.compare_files = []
        self.compare_messages, self.compare_patches = [], []
        self.ref_exists, self.patch_error, self.pr_create_error, self.ref_error = False, None, None, None
        self.ledger = None
        self.intent_seen = []
        self.cancels, self.sent_at, self.hide_runs = [], {}, False
        self.problems, self.reruns, self.deleted = [], [], set()
        self.commits, self.dev_runs = [], []
        self.merge_sha = "feedface12345678"
        self.reports, self.report_answer = [], None
        self.open_children, self.closed = [], []
        self.search_finds = True
        self.souls, self.soul_updates = {}, []
        self.send_args = []
        self.check_runs = [{"name": n, "status": "completed", "conclusion": "success"} for n in ("Typecheck and lint", "No comments in code", "Factory tools tests")]

    @staticmethod
    def goal_ok(goal):
        if not isinstance(goal, dict) or set(goal) != {"lastLineForms", "turnLimit"}:
            return False
        forms, limit = goal["lastLineForms"], goal["turnLimit"]
        return (isinstance(limit, int) and 1 <= limit <= 10 and isinstance(forms, list) and 1 <= len(forms) <= 4
                and all(isinstance(f, dict) and set(f) == {"prefix", "rest"} and isinstance(f["prefix"], str) and 1 <= len(f["prefix"]) <= 40
                        and f["rest"] in ("pull-url", "sha", "sentence") for f in forms))

    def account(self, tool, args, **kw):
        if kw and (tool != "factory_report" or self.report_answer is None):
            raise TypeError(tool)
        if tool == "factory_report":
            self.reports.append(args["snapshot"])
            return self.report_answer
        if tool == "send_message":
            self.send_args.append(dict(args))
            if "goal" in args and not self.goal_ok(args["goal"]):
                self.sends.append((args["agentId"], args["message"], args["waitSeconds"]))
                raise D.Error("account send_message failed: the tool reported an error invalid_goal")
            if getattr(self, "invalid_goal", False) and args.get("goal"):
                self.sends.append((args["agentId"], args["message"], args["waitSeconds"]))
                raise D.Error("account send_message failed: error invalid_goal")
            if self.ledger:
                self.intent_seen.append(self.rows("SELECT status, run_id FROM fires ORDER BY id DESC LIMIT 1"))
            rid = "run%d" % (len(self.sends) + 1)
            self.sends.append((args["agentId"], args["message"], args["waitSeconds"]))
            self.runs[rid] = {"status": "running"}
            self.order.append((rid, args["agentId"]))
            self.sent_at[rid] = self.clock
            if self.cut_off_next_send:
                self.cut_off_next_send = False
                raise D.Error("account send_message failed: TimeoutError")
            return {"runId": rid, "status": "running"}
        if tool == "cancel_run":
            self.cancels.append((args["agentId"], args["runId"]))
            was = self.runs[args["runId"]].get("status") == "running"
            self.runs[args["runId"]]["status"] = "cancelled"
            return {"runId": args["runId"], "status": "cancelled", "wasRunning": was}
        if tool == "list_runs":
            return [] if self.hide_runs else [{"runId": r, "status": "running", "startedAt": iso(self.sent_at[r])}
                                              for r, a in reversed(self.order) if a == args["agentId"]]
        if tool == "get_agent":
            return {"id": args["agentId"], "soul": self.souls.get(args["agentId"])}
        if tool == "update_agent":
            self.souls[args["agentId"]] = args["soul"]
            self.soul_updates.append((args["agentId"], args["soul"]))
            return {"id": args["agentId"], "soul": args["soul"]}
        return dict(self.runs[args["runId"]], runId=args["runId"])

    def rows(self, sql, *args):
        db = sqlite3.connect("file:%s?mode=ro" % self.ledger, uri=True)
        try:
            return db.execute(sql, args).fetchall()
        finally:
            db.close()

    def finish(self, agent, output, status="done", goal=None):
        rid = [r for r, a in self.order if a == agent][-1]
        self.runs[rid] = {"status": status, "output": output, "error": "boom" if status == "error" else None}
        if goal is not None:
            self.runs[rid]["goal"] = goal

    def issue(self, n):
        return next(i for i in self.issues + self.problems if i["number"] == int(n))

    def problem(self, a):
        n = int(a[2]) if len(a) > 2 and a[2].isdigit() else None
        return next((p for p in self.problems if p["number"] == n), None)

    def problem_gh(self, a):
        opt = lambda k: a[a.index(k) + 1] if k in a else None
        if a[:2] == ["issue", "create"]:
            n = 900 + len(self.problems)
            self.problems.append({"number": n, "title": opt("--title"), "body": opt("--body"), "comments": [],
                                  "labels": [opt("--label")], "state": "OPEN"})
            return "https://github.com/o/r/issues/%d\n" % n
        if a[:2] == ["issue", "list"]:
            return json.dumps([{"number": p["number"], "body": p["body"], "labels": [{"name": x} for x in p["labels"]]}
                               for p in self.problems if p["state"] == "OPEN"])
        if a[:2] == ["api", "graphql"]:
            n = int(next(x for x in a if x.startswith("n="))[2:])
            return json.dumps(next(p for p in self.problems if p["number"] == n).get("events", [])[-20:])
        if a[0] == "issue" and len(a) > 2 and a[2].isdigit() and int(a[2]) in self.deleted:
            raise D.Error("gh %s %s failed: exit 1: GraphQL: Could not resolve to an issue or pull request with the number of %s." % (a[0], a[1], a[2]))
        p = self.problem(a)
        if a[:2] == ["issue", "edit"]:
            p["body"] = opt("--body") or p["body"]
            p["labels"] = [x for x in p["labels"] if x != opt("--remove-label")] + (opt("--add-label").split(",") if opt("--add-label") else [])
        elif a[:2] == ["issue", "close"]:
            p["state"] = "CLOSED"
            p["comments"] += [opt("--comment")] if opt("--comment") else []
        elif a[:2] == ["issue", "reopen"]:
            p["state"] = "OPEN"
        elif a[:2] == ["issue", "comment"]:
            p["comments"].append(opt("--body"))
        return ""

    def unlabel(self, n, label, actor):
        p = next(p for p in self.problems if p["number"] == n)
        p["labels"].remove(label)
        p.setdefault("events", []).append({"label": {"name": label}, "actor": {"login": actor}})

    def delete(self, n):
        self.problems = [p for p in self.problems if p["number"] != n]
        self.deleted.add(n)

    def gh(self, args):
        a = list(args)
        self.gh_calls.append(a)
        timeline = a[:2] == ["api", "graphql"] and any("UNLABELED_EVENT" in x for x in a)
        gone = a[0] == "issue" and len(a) > 2 and a[2].isdigit() and int(a[2]) in self.deleted
        if a[:2] == ["issue", "create"] or "factory-problem" in a or (a[0] == "issue" and self.problem(a)) or timeline or gone:
            return self.problem_gh(a)
        if a[0] == "api" and "POST" in a and a[-1].endswith("/rerun"):
            self.reruns.append(a[-1])
            return ""
        if a[:2] == ["run", "rerun"]:
            self.reruns.append(a)
            return ""
        if a[:2] == ["issue", "edit"] and "--add-label" in a and a[a.index("--add-label") + 1] == "factory":
            self.unlabelled.discard(int(a[2]))
            return ""
        if a[:2] == ["issue", "list"] and "--search" in a and any(x.startswith("Part of #") for x in a):
            return json.dumps(self.open_children if self.search_finds else [])
        if a[:2] == ["issue", "list"] and "--search" not in a and "--label" not in a and "number,body" in a:
            return json.dumps(self.open_children)
        if a[:2] == ["issue", "list"] and "Factory follow-ups inbox in:title" in a:
            return json.dumps([{"number": p["number"], "title": p["title"]} for p in self.problems if p["state"] == "OPEN"])
        if a[:2] == ["issue", "list"] and "--label" in a and a[a.index("--label") + 1] == "factory-paused":
            return json.dumps([{"number": i["number"]} for i in self.issues if "factory-paused" in i.get("labels", [])])
        if a[:2] == ["issue", "list"] and "--label" in a and a[a.index("--label") + 1] == "instructions":
            return json.dumps([{"number": i["number"], "title": i["title"], "body": i["body"]} for i in self.issues
                               if "instructions" in i.get("labels", []) and i.get("state", "OPEN") == "OPEN"])
        if a[:2] == ["issue", "list"] and "number,title,body,labels" in a:
            return json.dumps([{"number": p["number"], "title": p["title"], "body": p["body"], "labels": [{"name": x} for x in p["labels"]]}
                               for p in self.problems if p["state"] == "OPEN"])
        if a[:2] == ["issue", "list"] and "--label" not in a and "--search" not in a and any(i.get("labels") for i in self.issues):
            return json.dumps([{"number": i["number"], "title": i["title"], "body": i.get("body", ""), "labels": i["labels"], "createdAt": i.get("createdAt", "")}
                               for i in self.issues if i.get("labels")])
        if a[:2] == ["issue", "list"] and "--label" not in a:
            return json.dumps([{"number": n} for n in sorted(self.open_numbers)])
        if a[:2] == ["issue", "list"]:
            return json.dumps([{"number": i["number"], "title": i["title"], "body": i["body"], "labels": [{"name": x} for x in i.get("labels", [])]}
                               for i in self.issues if i["number"] not in self.unlabelled])
        if a[:2] == ["issue", "view"]:
            i = self.issue(a[2])
            return json.dumps({"title": i.get("title", ""), "state": i.get("state", "OPEN"), "body": i["body"],
                               "comments": [{"body": c} for c in i["comments"]]})
        if a[:2] == ["issue", "close"]:
            self.closed.append((int(a[2]), a[a.index("--comment") + 1]))
            for i in self.issues:
                if i["number"] == int(a[2]):
                    i["state"] = "CLOSED"
            return ""
        if a[:2] == ["issue", "comment"]:
            self.issue(a[2])["comments"].append(a[a.index("--body") + 1])
            return ""
        if a[:2] == ["issue", "edit"]:
            if "--remove-label" in a:
                self.unlabelled.add(int(a[2]))
            return ""
        if a[:2] == ["pr", "view"]:
            return json.dumps({"headRefOid": HEAD, "state": self.pr_state, "mergeable": self.mergeable, "comments": [{"body": c} for c in getattr(self, "pr_comments", [])],
                               "mergeCommit": {"oid": self.merge_sha}})
        if a[:2] == ["pr", "list"]:
            return json.dumps(self.open_prs)
        if a[0] == "api" and "/compare/dev..." in a[1]:
            return json.dumps({"files": self.compare_files, "messages": self.compare_messages, "patches": self.compare_patches})
        if a[0] == "api" and "/git/ref/heads/" in a[1]:
            if self.ref_error:
                raise D.Error(self.ref_error)
            name = a[1].split("/git/ref/heads/", 1)[1]
            if name not in self.branches:
                raise D.Error("gh api failed: exit 1: Not Found")
            return json.dumps({"object": {"sha": self.branches[name]}})
        if a[0] == "api" and "-X" in a and a[a.index("-X") + 1] == "POST" and any(x.endswith("/git/refs") for x in a):
            if self.ref_exists:
                raise D.Error("gh api failed: exit 1: Reference already exists")
            return "{}"
        if a[0] == "api" and "-X" in a and a[a.index("-X") + 1] == "PATCH" and any("/git/refs/heads/" in x for x in a):
            if self.patch_error:
                raise D.Error(self.patch_error)
            return "{}"
        if a[:2] == ["pr", "create"]:
            if self.pr_create_error:
                raise D.Error(self.pr_create_error)
            return "https://github.com/o/r/pull/42"
        if a[0] == "api" and "/compare/" in a[1]:
            return "[]"
        if a[0] == "api" and "/timeline" in a[1]:
            return "[]"
        if a[0] == "api" and "/issues/" in a[1]:
            n = int(a[1].rsplit("/", 1)[1])
            return json.dumps({"state": "open" if n in self.open_numbers else "closed", "state_reason": self.close_reasons.get(n, "completed")})
        if a[0] == "api" and "/commits?" in a[1]:
            return json.dumps(self.commits)
        if a[0] == "api" and "/actions/runs/" in a[1] and a[1].endswith("/jobs"):
            return json.dumps({"jobs": getattr(self, "run_jobs", {}).get(a[1].split("/actions/runs/")[1].split("/")[0], [])})
        if a[0] == "api" and "/check-runs" in a[1]:
            return json.dumps({"check_runs": self.check_runs})
        if a[0] == "api" and "/actions/workflows/" in a[1]:
            return json.dumps({"workflow_runs": self.dev_runs})
        if a[0] == "api":
            sha = a[1].split("head_sha=")[1].split("&")[0]
            return json.dumps({"workflow_runs": self.workflows.get(sha, [])})
        if a[:2] == ["label", "create"]:
            return ""
        if a[:2] == ["pr", "close"]:
            return ""
        if a[:2] == ["pr", "merge"]:
            self.merges.append(a)
            self.pr_state = "MERGED"
            return ""
        raise AssertionError("unexpected gh call %r" % a)

    def edits(self, n):
        return [c for c in self.gh_calls if c[:3] == ["issue", "edit", str(n)]]


def wf(name, conclusion, status="completed", wid=1):
    return {"name": name, "workflow_id": wid, "status": status, "conclusion": conclusion}


class Base(unittest.TestCase):
    builders = ["b1", "b2"]

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.w = World()
        self.cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "checks_timeout_s": 3600, "auto_plan_marker": True,
                    "ledger_file": os.path.join(self.dir.name, "ledger.db"),
                    "json_state_file": os.path.join(self.dir.name, "dispatch.json"),
                    "heartbeat_file": os.path.join(self.dir.name, "heartbeat"),
                    "builders": [{"id": b, "name": b.upper()} for b in self.builders],
                    "reviewers": [{"id": r, "name": r.upper()} for r in ("r1", "r2")]}
        self.w.ledger = self.cfg["ledger_file"]
        self.out = io.StringIO()
        self.addCleanup(self.close)

    def close(self):
        if getattr(self, "d", None):
            self.d.close()
            self.d = None

    def new(self):
        return D.Dispatcher(self.cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)

    def tick(self, n=1, fresh=False):
        d = getattr(self, "d", None)
        for _ in range(n):
            if fresh or d is None:
                self.close()
                d = self.d = self.new()
            with contextlib.redirect_stdout(self.out):
                d.once()

    def state(self, n=5):
        return self.w.rows("SELECT state FROM jobs WHERE job=?", str(n))[0][0]

    def job_ids(self):
        return sorted(r[0] for r in self.w.rows("SELECT job FROM jobs"))

    def to_review(self):
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick(2)

    def to_checks(self):
        self.to_review()
        self.w.finish("r1", ACCEPT)
        self.tick()


class Checks(Base):
    def setUp(self):
        super().setUp()
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")) as f:
            self.cfg["checks_timeout_s"] = json.load(f)["checks_timeout_s"]

    def test_a_check_running_at_45_minutes_keeps_waiting(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success", wid=1), wf("image", None, status="in_progress", wid=2)]
        self.w.clock += 45 * 60
        self.tick()
        self.assertEqual(self.state(), "checks")
        self.assertEqual(self.w.merges, [])

    def test_red_while_another_still_runs_waits_then_fails_when_it_ends(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "failure", wid=1), wf("image", None, status="in_progress", wid=2)]
        self.w.clock += 45 * 60
        self.tick()
        self.assertEqual(self.state(), "checks")
        self.w.workflows[HEAD] = [wf("ci", "failure", wid=1), wf("image", "success", wid=2)]
        self.tick()
        self.assertEqual(self.state(), "fix_wait")

    def test_nothing_passed_after_60_minutes_fails_with_what_was_running(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("image", None, status="in_progress", wid=2)]
        self.w.clock += 60 * 60 + 1
        self.tick()
        self.assertEqual(self.state(), "failed")
        self.assertIn("running: image", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.w.merges, [])


class Intake(Base):
    def test_labelled_issue_taken_and_build_goes_to_a_free_builder(self):
        self.tick()
        self.assertEqual(len(self.w.sends), 1)
        agent, msg, wait = self.w.sends[0]
        self.assertEqual((agent, wait), ("b1", D.WAIT_S))
        self.assertIn('rerun #5, "Fix x"', msg)
        self.assertEqual(self.w.issue(5)["comments"], ["SMALL FIX: taken by the factory dispatcher on the owner's label."])
        self.assertEqual(self.state(), "building")

    def test_no_plan_comment_when_the_issue_has_a_plan_line(self):
        self.w.issues[0]["body"] = ready("intro\nPLAN READY (facts read on dev 4296d1f): three chunks")
        self.tick()
        self.assertEqual(self.w.issue(5)["comments"], [])
        self.assertEqual(len(self.w.sends), 1)

    def test_max_jobs_limits_intake(self):
        self.w.issues = [{"number": n, "title": "t%d" % n, "body": ready("SMALL FIX"), "comments": []} for n in (1, 2, 3)]
        self.cfg["max_jobs"] = 2
        self.tick()
        self.assertEqual(self.job_ids(), ["1", "2"])


class Depends(Base):
    def job(self, n, line, title=None):
        return {"number": n, "title": title or "t%d" % n, "body": ready("intro\nmore", line), "comments": []}

    def open_calls(self):
        return [c for c in self.w.gh_calls if c[:2] == ["issue", "list"] and "--label" not in c and "--search" not in c
                and not any(x.startswith("number,labels,title") for x in c)]

    def test_waits_while_dependency_is_open_then_is_taken(self):
        self.w.issues = [self.job(5, "#7")]
        self.tick(3)
        self.assertEqual(self.w.issue(5)["comments"], [])
        self.assertEqual(self.out.getvalue().count("waits on #7"), 1)
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(json.loads(self.w.rows("SELECT data FROM jobs")[0][0])["waiting"], [7])
        self.w.open_numbers.discard(7)
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertEqual(len(self.w.sends), 1)
        self.assertNotIn("waiting", json.loads(self.w.rows("SELECT data FROM jobs")[0][0]))

    def test_waiting_line_not_repeated_after_a_restart(self):
        self.w.issues = [self.job(5, "#7")]
        self.tick(3, fresh=True)
        self.assertEqual(self.out.getvalue().count("waits on #7"), 1)

    def test_none_and_no_line_are_taken_as_before(self):
        self.w.issues = [self.job(5, "none"), {"number": 6, "title": "t6", "body": ready(), "comments": []}]
        self.tick()
        self.assertEqual(self.state(5), "building")
        self.assertEqual(self.state(6), "building")
        self.assertEqual(self.open_calls(), [])

    def test_waiting_issue_does_not_use_room(self):
        self.w.issues = [self.job(5, "#7"), self.job(6, "none")]
        self.cfg["max_jobs"] = 1
        self.tick()
        self.assertEqual(self.state(6), "building")
        self.assertEqual(self.job_ids(), ["5", "6"])
        self.assertEqual(self.state(5), "waiting")

    def test_open_issues_read_once_per_pass(self):
        self.w.issues = [self.job(5, "#7"), self.job(6, "#129")]
        self.tick()
        self.assertEqual(len(self.open_calls()), 1)

    def test_partial_dependencies_log_only_the_open_one(self):
        self.w.issues = [self.job(5, "#135, #129 (a note in brackets)")]
        self.tick()
        self.assertIn("waits on #129", self.out.getvalue())
        self.assertNotIn("#135", self.out.getvalue())
        self.assertEqual(self.w.sends, [])


class IntakeGate(Base):
    def cut(self, n, body):
        return {"number": n, "title": "t%d" % n, "body": body, "comments": []}

    def test_number_on_the_next_line_is_not_started_and_gets_one_comment(self):
        self.w.issues = [self.cut(5, ready().replace("**Depends on**: none", "**Depends on**:\n#7"))]
        self.tick(2)
        self.assertEqual(self.w.sends, [])
        self.assertEqual(len(self.w.issue(5)["comments"]), 1)
        self.assertIn("dependency line", self.w.issue(5)["comments"][0])
        self.assertEqual(self.w.rows("SELECT job FROM jobs"), [])

    def test_a_changed_body_is_read_again_and_commented_again(self):
        self.w.issues = [self.cut(5, "no shape")]
        self.tick()
        self.w.issues[0]["body"] = "still no shape"
        self.tick()
        self.assertEqual(len(self.w.issue(5)["comments"]), 2)

    def test_a_cycle_holds_both_issues(self):
        self.w.issues = [self.cut(5, ready(deps="#6")), self.cut(6, ready(deps="#5"))]
        self.w.open_numbers = {5, 6}
        self.tick(2)
        self.assertEqual(self.w.sends, [])
        for n in (5, 6):
            self.assertEqual(len(self.w.issue(n)["comments"]), 1)
            self.assertIn("in a cycle", self.w.issue(n)["comments"][0])

    def test_a_readable_issue_starts_with_its_paths_in_the_ledger(self):
        self.tick()
        data = json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])
        self.assertEqual((data["worker"], data["paths"], data["test"]), ("coder", ["a/b.py", "a/test_b.py"], "a/test_b.py"))
        self.assertEqual(len(self.w.sends), 1)

    def test_another_worker_type_is_not_started_and_gets_one_comment(self):
        self.w.issues = [self.cut(5, ready().replace("coder", "reviewer"))]
        self.tick(2)
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.w.issue(5)["comments"], ["worker type reviewer has no queue yet (phase B of #198)"])


class BuildBrief(unittest.TestCase):
    def test_build_message_asks_for_lint_and_type_check(self):
        b = D.build_brief({"issue": 7, "title": "Fix x"})
        self.assertIn("lint", b)
        self.assertIn("ts-check", b)
        self.assertIn("capped at 2", b)
        self.assertIn("No full suite", b)


class OneBuilder(Base):
    builders = ["b1"]

    def test_two_jobs_never_share_a_coworker(self):
        self.w.issues.append({"number": 6, "title": "Fix y", "body": ready(), "comments": []})
        self.tick(3)
        self.assertEqual([s[0] for s in self.w.sends], ["b1"])
        self.assertEqual(self.state(6), "queued")
        self.w.finish("b1", PR_LINE)
        self.tick()
        self.assertEqual([s[0] for s in self.w.sends], ["b1", "b1"])
        self.assertIn("rerun #6", self.w.sends[1][1])

    def test_fix_waits_for_its_builder(self):
        self.w.issues.append({"number": 6, "title": "Fix y", "body": ready(), "comments": []})
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: wrong")
        self.tick(2)
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual(len([s for s in self.w.sends if s[0] == "b1"]), 2)
        self.w.finish("b1", "BLOCKED: no")
        self.tick(2)
        self.assertEqual(self.state(), "fixing")
        self.assertIn("One fix round", self.w.sends[-1][1])


class Flow(Base):
    def test_pr_line_parsed_and_review_sent_with_the_head_commit(self):
        self.to_review()
        agent, msg, _ = self.w.sends[-1]
        self.assertEqual(agent, "r1")
        self.assertIn("pull request #42 of rerun, for job #5", msg)
        self.assertIn("at commit abcdef1.", msg)
        self.assertIn("Do not wait for them", msg)
        self.assertEqual(self.state(), "reviewing")

    def test_no_pr_line_blocks_with_the_last_line(self):
        self.tick()
        self.w.finish("b1", "tried\nBLOCKED: the issue names no file")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("BLOCKED: the issue names no file", self.w.issue(5)["comments"][-1])

    def test_accept_then_green_runs_merge_once_at_that_commit(self):
        self.to_checks()
        self.tick()
        self.assertEqual(self.w.merges, [])
        self.w.workflows[HEAD] = [wf("ci", None, "in_progress")]
        self.tick()
        self.assertEqual(self.w.merges, [])
        self.w.workflows[HEAD] = [wf("ci", "success"), wf("docs", "skipped", wid=2), wf("ci", "cancelled")]
        self.tick(3)
        self.assertEqual(self.w.merges, [["pr", "merge", "42", "-R", "o/r", "--merge", "--match-head-commit", HEAD, "--delete-branch"]])
        self.assertEqual(self.state(), "merged")
        self.assertIn("merged pull request #42", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.w.edits(5), [["issue", "edit", "5", "-R", "o/r", "--remove-label", "factory", "--add-label", "factory-done"]])

    def test_the_pull_request_of_an_earlier_take_is_closed_when_the_job_merges(self):
        self.to_checks()
        self.w.open_prs = [{"number": 30, "title": "an earlier take (#5)"}, {"number": 31, "title": "another job (#6)"}, {"number": 42, "title": "this take (#5)"}]
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick(3)
        self.assertEqual(self.state(), "merged")
        closed = [c for c in self.w.gh_calls if c[:2] == ["pr", "close"]]
        self.assertEqual([c[2] for c in closed], ["30"])
        self.assertIn("finished by pull request #42", closed[0][closed[0].index("--comment") + 1])

    def test_failed_workflow_run_blocks_the_merge_and_goes_back_to_the_builder_once(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success", wid=1), wf("e2e", "failure", wid=2)]
        self.tick(2)
        self.assertEqual(self.w.merges, [])
        agent, msg, _ = self.w.sends[-1]
        self.assertEqual(agent, "b1")
        self.assertIn("checks failed", msg)
        self.assertIn("e2e", msg)
        self.assertEqual(self.state(), "fixing")
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.w.finish("r1", "VERDICT: ACCEPT @abcdef1")
        self.tick(2)
        self.assertEqual(self.w.merges, [])
        self.assertEqual(self.state(), "failed")
        self.assertIn("e2e", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.w.edits(5)[0][-1], "factory-blocked")

    def test_a_merge_refused_five_times_ends_the_job(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        gh, merges = self.w.gh, []
        def merge_refused(args):
            if list(args[:2]) == ["pr", "merge"]:
                merges.append(list(args))
                raise D.Error("gh pr merge failed: exit 1")
            return gh(args)
        self.w.gh = merge_refused
        self.tick(4, fresh=True)
        self.assertEqual(len(merges), 4)
        self.assertEqual(self.state(), "checks")
        self.tick(3, fresh=True)
        self.assertEqual(len(merges), 5)
        self.assertEqual(self.state(), "failed")
        self.assertIn("merge of #42 at abcdef1 refused 5 times", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.w.edits(5)[0][-1], "factory-blocked")

    def test_a_merge_refused_once_lands_on_the_next_beat(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        gh, tries = self.w.gh, []
        def refused_once(args):
            if list(args[:2]) == ["pr", "merge"]:
                tries.append(list(args))
                if len(tries) == 1:
                    raise D.Error("gh pr merge failed: exit 1")
            return gh(args)
        self.w.gh = refused_once
        self.tick(2, fresh=True)
        self.assertEqual(len(tries), 2)
        self.assertEqual(self.state(), "merged")


    def test_external_merge_with_moved_head_does_not_set_own_merge(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        gh, failed = self.w.gh, []
        def moved_head(args):
            a = list(args)
            if a[:2] == ["pr", "merge"]:
                failed.append(a)
                raise D.Error("gh pr merge failed: exit 1")
            if a[:2] == ["pr", "view"] and failed:
                return json.dumps({"state": "MERGED", "headRefOid": "9876543210fedcba"})
            return gh(a)
        self.w.gh = moved_head
        self.tick(1, fresh=True)
        self.assertEqual(len(failed), 1)
        j = self.d.store.get_job("5")
        self.assertEqual(j["state"], "merged")
        self.assertFalse(j.get("own_merge"))
        self.assertEqual(j["reason"], "merged outside the delegator")
        self.assertEqual([c for c in self.w.gh_calls if c[:3] == ["issue", "comment", "5"] and "merged pull request" in c[-1]], [])
    def test_cancelled_run_without_a_success_of_its_workflow_does_not_merge(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success", wid=1), wf("e2e", "cancelled", wid=2)]
        self.tick()
        self.assertEqual(self.w.merges, [])
        self.w.clock += 3601
        self.tick()
        self.assertEqual(self.state(), "failed")
        self.assertIn("e2e cancelled", self.w.issue(5)["comments"][-1])

    def test_reject_gives_one_fix_round_and_a_second_reject_goes_to_the_senior_round(self):
        self.to_review()
        self.w.finish("r1", "bad\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick(2)
        fix = self.w.sends[-1]
        self.assertEqual(fix[0], "b1")
        self.assertIn("VERDICT: REJECT @abcdef1: wrong sum", fix[1])
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.assertEqual(self.w.sends[-1][0], "r1")
        self.assertIn("One review", self.w.sends[-1][1])
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: still wrong")
        self.tick(3)
        self.assertEqual(self.state(), "fixing")
        self.assertEqual(len([s for s in self.w.sends if "One fix round" in s[1]]), 1)
        self.assertEqual(len(self.w.sends), 5)
        self.assertEqual(self.w.sends[-1][0], "b1")
        self.assertIn("still wrong", self.w.sends[-1][1])

    def test_no_verdict_line_rejects(self):
        self.to_review()
        self.w.finish("r1", "I looked at it.")
        self.tick()
        self.assertEqual(self.state(), "rejected")

    def test_run_in_error_is_sent_again_once(self):
        self.tick()
        self.w.finish("b1", "", status="error")
        self.tick()
        self.assertEqual(len(self.w.sends), 2)
        self.assertEqual(self.w.sends[0][:2], self.w.sends[1][:2])
        self.assertEqual(self.state(), "building")
        self.w.finish("b1", "", status="error")
        self.tick(2)
        self.assertEqual(len(self.w.sends), 2)
        self.assertEqual(self.state(), "failed")


class Clocks(Base):
    def job_data(self, n=5):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job=?", str(n))[0][0])

    def test_a_build_at_450000_tokens_is_not_cancelled_with_the_shipped_settings(self):
        self.cfg["clocks"] = D.settings()["clocks"]
        self.w.clock = T0
        self.tick()
        self.w.runs["run1"] = run_shape("run1", 10, T0, tokens=450000)
        self.tick()
        self.w.clock = T0 + 300
        self.w.runs["run1"] = run_shape("run1", 20, T0, tokens=450000)
        self.tick()
        self.assertEqual(self.w.cancels, [])
        self.w.clock = T0 + 400
        self.w.runs["run1"] = run_shape("run1", 30, T0, tokens=3100000)
        self.tick()
        self.assertEqual(self.w.cancels, [("b1", "run1")])

    def test_a_long_build_whose_step_count_keeps_moving_is_not_cancelled_with_the_shipped_settings(self):
        self.cfg["clocks"] = D.settings()["clocks"]
        self.w.clock = T0
        self.tick()
        for i, at in enumerate((0, 840, 1680, 2520)):
            self.w.clock = T0 + at
            self.w.runs["run1"] = run_shape("run1", 1 + i, T0)
            self.tick()
        self.assertEqual(self.w.cancels, [])

    def test_a_build_silent_past_the_stall_limit_is_cancelled_with_the_shipped_settings(self):
        self.cfg["clocks"] = D.settings()["clocks"]
        self.w.clock = T0
        self.tick()
        self.w.runs["run1"] = run_shape("run1", 5, T0)
        self.tick()
        self.w.clock = T0 + 1199
        self.tick()
        self.assertEqual(self.w.cancels, [])
        self.w.clock = T0 + 1201
        self.tick()
        self.assertEqual(self.w.cancels, [("b1", "run1")])

    def test_stalled_run_is_cancelled_and_sent_once_more(self):
        self.w.clock = T0
        self.tick()
        self.w.runs["run1"] = run_shape("run1", 7, T0)
        self.tick()
        self.assertEqual(self.w.cancels, [])
        self.w.clock = T0 + 601
        self.tick()
        self.assertEqual(self.w.cancels, [("b1", "run1")])
        self.assertEqual(len(self.w.sends), 2)
        self.assertEqual(self.state(), "building")
        self.w.runs["run2"] = run_shape("run2", 3, T0 + 601)
        self.tick()
        self.w.clock = T0 + 601 + 601
        self.tick()
        self.assertEqual(self.w.cancels, [("b1", "run1"), ("b1", "run2")])
        self.assertEqual(len(self.w.sends), 2)
        self.assertEqual(self.state(), "failed")
        self.assertIn("stalled: no new step for 601 s", self.job_data()["reason"])

    def refuse(self):
        self.w.finish("b1", "BLOCKED: 5 builders are already active (wt refused)")
        self.tick()

    def test_no_room_refusal_waits_one_minute_and_is_not_an_attempt(self):
        self.tick()
        self.refuse()
        self.assertEqual(self.state(), "queued")
        self.assertEqual(len(self.w.sends), 1)
        self.w.clock += 59
        self.tick()
        self.assertEqual(len(self.w.sends), 1)
        self.w.clock += 1
        self.tick()
        self.assertEqual(len(self.w.sends), 2)
        self.assertEqual(self.state(), "building")
        self.assertEqual(self.job_data()["attempt"], 1)

    def test_the_next_successful_transition_resets_the_refusal_count(self):
        self.tick()
        self.refuse()
        self.assertEqual(self.w.rows("SELECT v FROM kv WHERE k='retry:transient'"), [("1",)])
        self.w.clock += 60
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertEqual(self.w.rows("SELECT v FROM kv WHERE k='retry:transient'"), [])

    def test_four_refusals_end_blocked(self):
        for _ in range(4):
            self.tick()
            self.refuse()
            self.w.clock += 240
        self.assertEqual(self.state(), "blocked")
        self.assertIn("four refusals a second try did not clear: BLOCKED: 5 builders are already active", self.job_data()["reason"])

    def test_plan_fault_ends_returned_and_the_next_job_says_so(self):
        self.w.issues.append({"number": 6, "title": "Next", "body": ready(deps="#5"), "comments": []})
        self.w.open_numbers.add(5)
        self.tick()
        self.w.finish("b1", "BLOCKED: plan: a file outside its paths")
        self.tick()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.job_data()["reason"], "BLOCKED: plan: a file outside its paths")
        self.assertIn("returned to the planner", self.w.issue(5)["comments"][-1])
        self.assertEqual(self.w.edits(5)[0][-1], "factory-blocked")
        self.tick()
        self.assertEqual(self.state(6), "waiting")
        self.assertEqual(self.job_data(6)["waits_on_returned"], [5])
        self.assertEqual(self.job_data(6)["waiting"], [5])
        self.assertIn("waits on returned #5", self.out.getvalue())

    def test_build_and_fix_briefs_name_the_plan_line(self):
        j = {"issue": 5, "title": "T", "pr": 1, "review": "r"}
        line = "If the plan itself is wrong (a file outside its paths that is not such a test, a test it cannot write), end with BLOCKED: plan: <why>."
        for brief in (D.build_brief(j), D.fix_brief(j, 1, "r"), D.senior_brief(j, 1, "r")):
            self.assertIn(line, brief)
            self.assertIn("## Tests adapted", brief)
        self.assertIn("## Tests adapted", D.review_brief(j, 1, "abcdef1234"))
        self.assertIn("## Tests adapted", D.proof_brief(j, 1, "abcdef1234", ["x"]))


class Cut(BaseException):
    pass


class Restart(Base):
    def test_delegator_stopped_during_a_send_adopts_the_run_after_restart(self):
        real = self.w.account
        def cut(tool, args):
            r = real(tool, args)
            if tool == "send_message":
                raise Cut()
            return r
        self.d = self.new()
        self.d.account = cut
        with self.assertRaises(Cut), contextlib.redirect_stdout(self.out):
            self.d.once()
        self.close()
        self.tick(3, fresh=True)
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.state(), "building")
        self.assertEqual(self.w.rows("SELECT run_id FROM fires")[0][0], "run1")

    def import_state(self, job):
        with open(self.cfg["json_state_file"], "w") as f:
            json.dump({"jobs": {"5": dict(job, issue=5, title="Fix x", agent="b1")}}, f)

    def test_imported_job_caught_mid_send_ends_blocked_at_once(self):
        self.import_state({"state": "building", "sending": "build"})
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("sending 'build' was cut off before its intent was recorded", self.out.getvalue())
        self.assertNotIn("KeyError", self.out.getvalue())
        self.assertEqual(len(self.w.sends), 0)

    def test_imported_run_older_than_ten_minutes_is_not_cancelled_at_the_first_beat(self):
        self.import_state({"state": "building", "run": "r-old"})
        self.w.clock = T0
        self.w.runs["r-old"] = run_shape("r-old", 40, T0 - 1200)
        self.tick()
        self.assertEqual(self.w.cancels, [])
        self.w.clock = T0 + 601
        self.tick()
        self.assertEqual(self.w.cancels, [("b1", "r-old")])

    def test_fresh_dispatcher_every_pass_sends_each_step_once(self):
        self.tick(2, fresh=True)
        self.w.finish("b1", PR_LINE)
        self.tick(3, fresh=True)
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: x")
        self.tick(3, fresh=True)
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(3, fresh=True)
        self.w.finish("r1", "VERDICT: ACCEPT @abcdef1")
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick(4, fresh=True)
        self.assertEqual([s[0] for s in self.w.sends], ["b1", "r1", "b1", "r1"])
        self.assertEqual(len(self.w.merges), 1)
        self.assertEqual(len(self.w.issue(5)["comments"]), 2)
        self.assertEqual(len(self.w.edits(5)), 1)

    def test_send_cut_off_after_it_went_out_is_found_in_the_run_list_and_never_sent_again(self):
        self.w.cut_off_next_send = True
        self.tick()
        self.tick(3, fresh=True)
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.state(), "building")
        self.assertEqual(self.w.rows("SELECT run_id, status FROM fires")[0], ("run1", "running"))

    def test_send_never_found_in_three_beats_is_abandoned_and_goes_back_as_transient(self):
        self.w.cut_off_next_send = True
        self.w.hide_runs = True
        self.tick()
        self.tick(2)
        self.assertEqual(self.state(), "building")
        self.tick()
        self.assertEqual(self.state(), "queued")
        self.assertEqual(self.w.rows("SELECT status FROM fires")[0][0], "lost")
        self.assertEqual(len(self.w.sends), 1)


    def test_merge_done_before_a_restart_is_not_repeated(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.w.pr_state = "MERGED"
        gh = self.w.gh
        def merge_fails(args):
            if list(args[:2]) == ["pr", "merge"]:
                raise D.Error("gh pr merge failed: exit 1")
            return gh(args)
        self.w.gh = merge_fails
        self.tick(fresh=True)
        self.assertEqual(self.state(), "merged")


class Report(Base):
    def test_failed_relabel_is_retried_without_a_second_comment(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: no")
        gh, fails = self.w.gh, [1]
        def edit_fails_once(args):
            if list(args[:2]) == ["issue", "edit"] and fails:
                fails.pop()
                raise D.Error("gh issue edit failed: exit 1")
            return gh(args)
        self.w.gh = edit_fails_once
        self.tick(3, fresh=True)
        self.assertEqual(len(self.w.issue(5)["comments"]), 2)
        self.assertEqual(len(self.w.edits(5)), 1)
        self.assertIn("stopped this job: blocked. Pull request: none.", self.w.issue(5)["comments"][-1])


class Secrets(Base):
    KEY, TOKEN = "acct-key-SECRET-0123456789", "ghp_SECRETtoken0123456789"

    def test_no_key_or_token_in_anything_printed(self):
        seen, ran = [], []

        class Resp:
            def __init__(self, text):
                self.text = text
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return self.text.encode()

        def opener(req, timeout):
            seen.append(dict(req.header_items()))
            args = json.loads(req.data)["params"]["arguments"]
            if args.get("agentId") == "b2":
                raise ValueError("Invalid header value %r" % self.KEY)
            if args.get("agentId") == "b1":
                raise urllib.error.HTTPError(req.full_url, 500, "echo " + self.KEY, {}, io.BytesIO(self.KEY.encode()))
            fake = self.w.account(json.loads(req.data)["params"]["name"], args)
            body = {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": json.dumps(fake)}]}}
            return Resp("event: message\ndata: " + json.dumps(body) + "\n\n")

        class Proc:
            def __init__(self, rc, out):
                self.returncode, self.stdout, self.stderr = rc, out, "error " + Secrets.TOKEN

        fail_once = [1]

        def run(argv, capture_output, text, env, timeout):
            ran.append((argv, env))
            if argv[1:3] == ["issue", "comment"] and fail_once:
                fail_once.pop()
                return Proc(1, "")
            return Proc(0, self.w.gh(argv[1:]))

        self.cfg["builders"].reverse()
        self.w.issues.append({"number": 6, "title": "Fix y", "body": ready("SMALL FIX"), "comments": []})
        err = io.StringIO()
        d = D.Dispatcher(self.cfg, D.make_account("https://acct.example/mcp", self.KEY, opener), D.make_gh(self.TOKEN, run))
        with contextlib.redirect_stdout(self.out), contextlib.redirect_stderr(err):
            for _ in range(3):
                d.once()
            gc.collect()
        printed = self.out.getvalue() + err.getvalue()
        self.assertIn("ValueError", printed)
        self.assertIn("HTTP 500", printed)
        self.assertIn("exit 1", printed)
        self.assertNotIn(self.KEY, printed)
        self.assertNotIn(self.TOKEN, printed)
        self.assertTrue(seen and all(h["Authorization"] == "Bearer " + self.KEY for h in seen))
        self.assertTrue(ran and all(e["GH_TOKEN"] == self.TOKEN and self.TOKEN not in " ".join(a) for a, e in ran))
        self.assertNotIn(self.TOKEN, str(d.store.jobs()))

    def test_start_line_for_once(self):
        for name, fake in (("settings", lambda: dict(self.cfg, proof=True)), ("make_account", lambda url, key: self.w.account),
                           ("make_gh", lambda tok: self.w.gh), ("read_secret", lambda path: "fake-key")):
            self.addCleanup(setattr, D, name, getattr(D, name))
            setattr(D, name, fake)
        env = dict(os.environ, DISPATCH_ACCOUNT_URL="http://account.invalid")
        with unittest.mock.patch.dict(os.environ, env):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(D.main(["once"]), 0)
            lines = [l for l in out.getvalue().splitlines() if "dispatcher started:" in l]
            self.assertEqual(len(lines), 1)
            self.assertIn("%d builders, 2 reviewers, label factory, repo o/r" % len(self.cfg["builders"]), lines[0])


class Hardening(Base):
    def test_conflicting_pull_request_goes_back_to_its_builder_once(self):
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.w.mergeable = "CONFLICTING"
        self.tick(3)
        agent, msg, _ = self.w.sends[-1]
        self.assertEqual(agent, "b1")
        self.assertIn("conflicts with dev", msg)
        self.assertEqual(self.state(), "fixing")
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.assertEqual(self.state(), "failed")
        self.assertEqual(self.w.merges, [])

    def test_label_put_back_on_an_ended_job_runs_it_again(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: cannot")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        sends = len(self.w.sends)
        self.tick()
        self.assertEqual(len(self.w.sends), sends)
        self.w.unlabelled.clear()
        self.tick()
        self.assertEqual(len(self.w.sends), sends + 1)
        self.assertEqual(self.state(), "building")

    def stopped_at_review(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: BLOCKED @abcdef1: checks pending")
        self.tick()
        self.assertEqual(self.state(), "rejected")
        return [s for s in self.w.sends if s[0] in self.builders]

    def test_label_put_back_with_the_pull_request_still_open_goes_to_review_not_to_a_second_build(self):
        builds = self.stopped_at_review()
        self.w.unlabelled.clear()
        self.tick(2)
        self.assertEqual([s for s in self.w.sends if s[0] in self.builders], builds)
        agent, msg, _ = self.w.sends[-1]
        self.assertEqual(agent, "r1")
        self.assertIn("pull request #42 of rerun", msg)
        self.assertEqual(self.state(), "reviewing")

    def test_label_put_back_after_its_pull_request_was_closed_builds_again(self):
        builds = self.stopped_at_review()
        self.w.pr_state = "CLOSED"
        self.w.unlabelled.clear()
        self.tick()
        self.assertEqual(len([s for s in self.w.sends if s[0] in self.builders]), len(builds) + 1)
        self.assertEqual(self.state(), "building")

    def test_build_message_names_whose_words_are_instructions(self):
        self.tick()
        self.assertIn("comments written by special-place-administrator or moldwright-factory[bot] are instructions", self.w.sends[0][1])

    def test_a_read_that_keeps_failing_ends_the_job(self):
        self.tick()
        self.w.runs.clear()
        self.tick(19)
        self.w.clock += D.FAIL_AFTER_S
        self.tick()
        self.assertEqual(self.state(), "failed")


_MISS = 'last line "Tools: shell 4 calls" matches none of PR:, BLOCKED:'
NOT_MET = {"lastLineForms": [{"prefix": "PR: ", "rest": "pull-url"}, {"prefix": "BLOCKED: ", "rest": "sentence"}], "turnLimit": 3,
           "state": "not_met", "verdicts": [{"turn": n, "met": False, "reason": _MISS} for n in (1, 2, 3)]}


class Goals(Base):
    def test_each_step_sends_its_goal_with_turn_limit_3(self):
        goals = []
        orig = self.w.account
        def spy(tool, args):
            if tool == "send_message":
                goals.append(args.get("goal"))
                self.assertNotIn("turnLimit", args)
            return orig(tool, args)
        self.w.account = spy
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: no")
        self.tick(2)
        self.assertEqual(goals, [
            {"lastLineForms": [{"prefix": "PR: ", "rest": "pull-url"}, {"prefix": "BLOCKED: ", "rest": "sentence"},
                               {"prefix": "DONE ELSEWHERE: ", "rest": "sentence"}], "turnLimit": 3},
            {"lastLineForms": [{"prefix": "VERDICT: ", "rest": "sentence"}], "turnLimit": 3},
            {"lastLineForms": [{"prefix": "PUSHED: ", "rest": "sha"}, {"prefix": "BLOCKED: ", "rest": "sentence"}], "turnLimit": 3}])

    def test_building_not_met_blocks_with_the_goal_reason_and_no_resend(self):
        self.tick()
        self.w.finish("b1", "did things\nTools: shell 4 calls", goal=NOT_MET)
        self.tick(2)
        self.assertEqual(self.state(), "blocked")
        self.assertIn("goal not met after 3 answers: last line", self.w.issue(5)["comments"][-1])
        self.assertEqual(len(self.w.sends), 1)

    def test_building_not_met_keeps_the_blocked_line(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: no file\nTools: shell 4 calls", goal=NOT_MET)
        self.tick()
        self.assertIn("Reason: BLOCKED: no file", self.w.issue(5)["comments"][-1])

    def test_building_not_met_keeps_the_pr_of_this_repo(self):
        self.cfg["repo"] = "special-place-ai-heaven/rerun"
        self.tick()
        self.w.finish("b1", "opened https://github.com/special-place-ai-heaven/rerun/pull/171\nTools: shell 1 calls", goal=NOT_MET)
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("Pull request: #171", self.w.issue(5)["comments"][-1])

    def test_goal_missing_or_null_goes_on_as_before(self):
        for g in (None, "null"):
            self.setUp(); self.d = None
            self.tick()
            self.w.finish("b1", PR_LINE)
            if g == "null":
                self.w.runs["run1"]["goal"] = None
            self.tick()
            self.assertEqual(self.state(), "review_wait")

    def test_reviewing_not_met_with_a_reject_goes_to_the_fix_round(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @abc1234: " + "long sentence " * 10 + "\nTools: shell 2 calls", goal=NOT_MET)
        self.tick()
        self.assertEqual(self.state(), "fix_wait")

    def test_reviewing_not_met_without_a_verdict_blocks(self):
        self.to_review()
        self.w.finish("r1", "looked fine\nTools: shell 2 calls", goal=NOT_MET)
        self.tick()
        self.assertEqual(self.state(), "blocked")

    def test_invalid_goal_fails_the_job_and_is_sent_once(self):
        self.w.invalid_goal = True
        self.tick(3)
        self.assertEqual(self.state(), "failed")
        self.assertEqual(len(self.w.sends), 1)
        self.assertIn("invalid_goal", self.w.issue(5)["comments"][-1])



class Ledger(Base):
    def test_every_state_change_is_a_transition_row(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick()
        rows = self.w.rows("SELECT to_state, at FROM transitions WHERE job='5' ORDER BY id")
        self.assertTrue(all(at for _, at in rows))
        seq = [st for k, (st, _) in enumerate(rows) if k == 0 or rows[k - 1][0] != st]
        self.assertEqual(seq, ["queued", "building", "review_wait", "reviewing", "checks", "merged"])

    def test_intent_row_is_written_before_the_send(self):
        self.tick()
        self.assertEqual(self.w.intent_seen, [[("intent", None)]])
        self.assertEqual(self.w.rows("SELECT status, run_id FROM fires"), [("running", "run1")])

    def test_open_json_jobs_are_imported_once(self):
        job = {"issue": 5, "title": "Fix x", "body": "", "state": "review_wait", "round": 1, "pr": 42, "builder": "b1"}
        with open(self.cfg["json_state_file"], "w") as f:
            json.dump({"jobs": {"5": job}}, f)
        self.tick()
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual([s[0] for s in self.w.sends], ["r1"])
        n = len(self.w.rows("SELECT id FROM transitions"))
        self.tick(fresh=True)
        self.assertEqual(len(self.w.rows("SELECT job FROM jobs")), 1)
        self.assertEqual(len(self.w.rows("SELECT id FROM transitions WHERE reason='imported'")), 1)
        self.assertFalse(os.path.exists(self.cfg["json_state_file"]))
        self.assertGreaterEqual(len(self.w.rows("SELECT id FROM transitions")), n)


if __name__ == "__main__":
    unittest.main()


class Heartbeat(Base):
    def test_each_beat_writes_the_time_and_the_state_per_stage(self):
        self.tick()
        first = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        self.assertIn("beat 1 | waiting 0, queued 0, building 0,", first)
        self.d.store.put_job("6", "waiting", {"issue": 6, "relabelled": True})
        self.d.store.put_job("7", "merged", {"issue": 7, "relabelled": True})
        self.out.truncate(0)
        self.out.seek(0)
        self.tick()
        line = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        self.assertEqual(line, "1970-01-01T00:16:40Z beat 2 | waiting 1, queued 0, building 1, review_wait 0, reviewing 0, "
                               "fix_wait 0, fixing 0, checks 0, proof_wait 0, proving 0 | ended today: merged 1, blocked 0, failed 0, returned 0,"
                               " rejected 0 | by type: coder ready 0 running 1 waiting 1, reviewer ready 0 running 0 waiting 0, "
                               "researcher ready 0 running 0 waiting 0, designer ready 0 running 0 waiting 0, security ready 0 running 0 waiting 0, data ready 0 running 0 waiting 0, contracts ready 0 running 0 waiting 0 | features: none | "
                               "unreadable 0, dead waits 0 | problems 0 open, 0 owner")
        self.assertIn(line, self.out.getvalue().splitlines())
        
        self.assertFalse([f for f in os.listdir(self.dir.name) if f.startswith("heartbeat") and f != "heartbeat"])


class Final(Base):
    def build_out(self, out):
        self.tick()
        self.w.finish("b1", out)
        self.tick()

    def test_pr_line_at_the_end_of_a_joined_line_goes_to_review(self):
        self.build_out("Test first. Now the change. Commit and open PR. PR: https://github.com/o/r/pull/9")
        self.assertIn(self.state(), ("review_wait", "reviewing"))

    def test_blocked_at_the_end_of_a_joined_line_gives_its_reason(self):
        self.build_out("wt new refused. BLOCKED: the test cannot pass")
        self.assertEqual(self.state(), "blocked")
        self.assertIn("Reason: BLOCKED: the test cannot pass", self.w.issue(5)["comments"][-1])

    def test_verdict_at_the_end_of_a_joined_line_is_read(self):
        self.to_review()
        self.w.finish("r1", "Read the diff. Nothing blocks. VERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_blocked_reason_is_the_blocked_line_not_the_tools_footer(self):
        self.build_out("...\nBLOCKED: dev has no snapshot table\nTools: shell 4 calls")
        self.assertEqual(self.state(), "blocked")
        self.assertIn("Reason: BLOCKED: dev has no snapshot table", self.w.issue(5)["comments"][-1])

    def test_pr_url_in_text_is_kept_when_the_last_line_is_blocked(self):
        self.cfg["repo"] = "special-place-ai-heaven/rerun"
        self.build_out("opened https://github.com/special-place-ai-heaven/rerun/pull/171 ok\nBLOCKED: ci red\nTools: shell 1 calls")
        self.assertEqual(self.state(), "blocked")
        self.assertIn("Pull request: #171", self.w.issue(5)["comments"][-1])

    def test_open_pr_found_by_title_and_other_issue_ignored(self):
        self.w.open_prs = [{"number": 9, "title": "Y (#6)"}, {"number": 8, "title": "X (#5)"}]
        self.build_out("BLOCKED: stuck")
        self.assertIn("Pull request: #8", self.w.issue(5)["comments"][-1])

    def test_other_issue_title_alone_is_ignored(self):
        self.w.open_prs = [{"number": 9, "title": "Y (#6)"}]
        self.build_out("BLOCKED: stuck")
        self.assertIn("Pull request: none", self.w.issue(5)["comments"][-1])

    def test_last_final_line_decides_the_build(self):
        self.build_out("PR: https://github.com/o/r/pull/42\nBLOCKED: later")
        self.assertEqual(self.state(), "blocked")

    def test_pr_as_last_final_line_goes_to_review(self):
        self.build_out("BLOCKED: x\nPR: https://github.com/o/r/pull/42\nTools: shell 2 calls")
        self.tick()
        self.assertEqual(self.state(), "reviewing")

    def test_fix_pushed_then_tools_line_goes_to_review(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: no")
        self.tick(2)
        self.w.finish("b1", "PUSHED: abc1234\nTools: shell 2 calls")
        self.tick(2)
        self.assertEqual(self.state(), "reviewing")

    def test_fix_with_only_a_tools_line_blocks_with_no_final_line(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: no")
        self.tick(2)
        self.w.finish("b1", "Tools: shell 2 calls")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("Reason: no final line", self.w.issue(5)["comments"][-1])

    def test_run_and_files_are_read_from_a_body_with_windows_line_endings(self):
        body = "**Files**\r\n- `a/b.py`\r\n\r\n**Run** (run on dev)\r\n```\r\npython3 -m unittest x\r\ncd y && z\r\n```\r\n"
        self.assertEqual(D.issue_run(body), "python3 -m unittest x ; cd y && z")
        self.assertEqual(D.issue_files(body), "a/b.py")

    def test_builders_are_told_no_comments_and_reviewers_reject_them(self):
        j = {"issue": 7, "title": "Fix x", "body": ""}
        for b in (D.build_brief(j), D.fix_brief(j, 3, "r"), D.first_brief(dict(j, worker="researcher"))):
            self.assertIn("NEVER make comments in code", b)
            self.assertIn("eslint-disable-next-line", b)
        self.assertIn("is a reason to reject", D.review_brief(j, 3, HEAD))

    def test_each_brief_has_one_final_state_block_with_forms_and_run(self):
        body = "**Files**\n- `a/b.py`\n\n**Run**\n```\npython3 -m unittest x\n```\n"
        j = {"issue": 7, "title": "Fix x", "body": body}
        for b, form in ((D.build_brief(j), "PR: <url>"), (D.review_brief(j, 3, HEAD), "VERDICT: ACCEPT"), (D.fix_brief(j, 3, "r"), "PUSHED: <first 7")):
            self.assertEqual(b.count("Final state"), 1)
            self.assertIn(form, b)
            self.assertIn("python3 -m unittest x", b)
            self.assertIn("a/b.py", b)
            self.assertNotIn("End your answer", b)