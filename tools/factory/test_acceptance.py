import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acceptance, store as S


def job(n, state, parent=None, pr=None, title=None):
    body = "**Depends on**: none\n"
    if parent:
        body += "**Part of**: #%d\n" % parent
    return {"issue": n, "title": title or "child %d" % n, "state": state, "pr": pr, "body": body}


PARENT = {"number": 50, "title": "Big thing", "body": "Ask one.\nAsk two."}
KIDS = [job(51, "merged", 50, 70, "first"), job(52, "superseded", 50, None, "second")]


class DueTests(unittest.TestCase):
    def test_a_parent_is_due_when_every_child_is_merged_or_superseded(self):
        self.assertEqual(acceptance.due(KIDS + [job(54, "merged", 50, 71), job(53, "merged", 60, 72)]), {50: [51, 52, 54], 60: [53]})

    def test_one_child_still_at_work_or_stopped_holds_the_parent(self):
        for state in ("waiting", "queued", "building", "review_wait", "reviewing", "blocked", "failed", "rejected", "returned", "checks", "fixing"):
            self.assertEqual(acceptance.due(KIDS + [job(55, state, 50)]), {}, state)

    def test_a_parent_with_no_merged_child_is_not_due(self):
        self.assertEqual(acceptance.due([job(51, "superseded", 50), job(52, "superseded", 50)]), {})

    def test_a_job_without_a_part_of_line_belongs_to_no_parent(self):
        self.assertEqual(acceptance.due([job(51, "merged")]), {})
        self.assertEqual(acceptance.due(KIDS + [job(56, "building")]), {50: [51, 52]})


class PlanTests(unittest.TestCase):
    def test_plan_reads_the_latest_plan_comment(self):
        cs = [{"body": "## Plan\nold"}, {"body": "chatter"}, {"body": "## Plan\nnew"}, {"body": "later chatter"}]
        self.assertEqual(acceptance.plan(cs), "## Plan\nnew")
        self.assertIsNone(acceptance.plan([{"body": "x"}]))
        self.assertIsNone(acceptance.plan([]))


class BriefTests(unittest.TestCase):
    def text(self, plan_text="## Plan\nstep"):
        return acceptance.brief("o/r", PARENT, plan_text, KIDS)

    def test_the_brief_carries_the_parent_text_its_plan_and_the_children(self):
        t = self.text()
        self.assertIn("sent by the dispatcher", t)
        self.assertIn("work alone", t)
        self.assertIn("https://github.com/o/r/issues/50", t)
        self.assertIn("Big thing", t)
        self.assertIn("Ask one.\nAsk two.", t)
        self.assertIn("## Plan\nstep", t)
        self.assertIn("- #51 first (merged, pull request #70)", t)
        self.assertIn("- #52 second (superseded)", t)
        self.assertLess(t.index("Ask one."), t.index("## Plan\nstep"))
        self.assertLess(t.index("## Plan\nstep"), t.index("- #51"))

    def test_the_brief_asks_for_the_check_against_dev_and_as_the_user(self):
        t = self.text()
        for phrase in ("against the code on dev", "as its user", "how one reaches it", "how one leaves it", "what it shows when it is empty", "when the input is wrong"):
            self.assertIn(phrase, t)

    def test_the_brief_names_both_last_lines_and_the_gap_issue_form(self):
        t = self.text()
        for phrase in ("ACCEPTED: <one sentence>", "GAPS: #a", "P1", "**Part of**: #50", "**Repairs**: #<child>"):
            self.assertIn(phrase, t)

    def test_the_brief_names_the_spec_the_run_lines_and_closed_children(self):
        t = acceptance.brief("o/r", PARENT, "## Plan\nstep", KIDS, others=[{"number": 40, "title": "old"}], cut=True)
        for phrase in ("The spec is the parent text and its", "run the lines under **Run** in its issue on today's dev", "- #40 old", "stopped at 200 closed issues"):
            self.assertIn(phrase, t)
        self.assertNotIn("Closed outside", self.text())

    def test_a_missing_plan_comment_is_said_so(self):
        t = self.text(None)
        self.assertIn("has no `## Plan` comment", t)


class OutcomeTests(unittest.TestCase):
    def test_accepted_is_the_last_line_with_its_sentence(self):
        self.assertEqual(acceptance.outcome("work\nACCEPTED: all asks met\n"), ("accepted", [], "ACCEPTED: all asks met"))

    def test_gaps_names_the_issues_in_order_once(self):
        self.assertEqual(acceptance.outcome("x\nGAPS: #12, #7, #12\n"), ("gaps", [12, 7], "GAPS: #12, #7, #12"))

    def test_gaps_without_a_number_or_no_final_line_is_none(self):
        self.assertEqual(acceptance.outcome("GAPS: none")[0], "none")
        self.assertEqual(acceptance.outcome("nothing here")[0], "none")
        self.assertEqual(acceptance.outcome("")[0], "none")

    def test_a_line_inside_a_code_fence_does_not_count(self):
        self.assertEqual(acceptance.outcome("```\nACCEPTED: fake\n```\n")[0], "none")
        self.assertEqual(acceptance.outcome("ACCEPTED: real\n```\nGAPS: #3\n```\n"), ("accepted", [], "ACCEPTED: real"))



class CrashTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.addCleanup(self.d.cleanup)
        self.store = S.Store(os.path.join(self.d.name, "a.db"))
        self.addCleanup(self.store.close)
        self.cfg = {"repo": "o/r", "types": {"acceptor": {"coworkers": [{"id": "a1", "name": "BARBARA", "runs": 1}]}}}
        self.now = 1000.0

    def station(self):
        def gh(args):
            if args[:2] == ["issue", "list"]:
                return "[]"
            return json.dumps(dict(PARENT, state="OPEN", comments=[]))

        return acceptance.Station(self.cfg, self.store, lambda *a: {"runId": "r1", "status": "running"}, gh, lambda: self.now, lambda *a: None)

    def test_set_many_rolls_back_all_kv_fields_if_interrupted_mid_write(self):
        st = self.station()
        self.store.db.execute(
            "CREATE TEMP TRIGGER kill_second AFTER INSERT ON kv "
            "WHEN (SELECT COUNT(*) FROM kv WHERE job=NEW.job) >= 2 "
            "BEGIN SELECT RAISE(ABORT, 'killed mid-write'); END")

        with self.assertRaises(Exception):
            for k, v in (("state", "running"), ("agent", "a1"), ("copy", 1), ("fire", 1)):
                self.store.set("accept:11", k, v)
        self.assertEqual(self.store.get_all("accept:11"), {"state": "running"})
        with self.assertRaises(KeyError):
            st.once(1, [])
        self.store.forget("accept:11")

        with self.assertRaises(Exception):
            st.send(10, PARENT, KIDS, ("a1", 1), {})
        self.assertEqual(self.store.get_all("accept:10"), {})
        st.once(1, [])

    def test_revive_interrupted_mid_write_keeps_left_state_without_burning_revival(self):
        st = self.station()
        self.store.set_many("accept:12", (("sends", 2), ("left_at", 100.0), ("state", "left")))
        self.now = 100.0 + acceptance.REVIVE_S + 1
        self.store.db.execute(
            "CREATE TEMP TRIGGER kill_revive AFTER INSERT ON kv "
            "WHEN NEW.job='accept:12' AND NEW.k='revived' "
            "BEGIN SELECT RAISE(ABORT, 'killed mid-revive'); END")
        with self.assertRaises(Exception):
            st.revive(12, self.store.get_all("accept:12"))
        self.assertEqual(self.store.get_all("accept:12"), {"sends": "2", "left_at": "100.0", "state": "left"})
        self.store.db.execute("DROP TRIGGER kill_revive")
        revived = st.revive(12, self.store.get_all("accept:12"))
        self.assertEqual((revived["state"], revived["revived"], revived["sends"]), ("unsent", "1", "0"))


    def test_does_not_restart_or_accept_parent_while_gaps_of_title_issue_is_open_or_child_reopens_mid_run(self):
        open_issues, closed, logs = [{"number": 99, "title": "Gaps of #10: missing validation", "body": "Needs validation."}], [], []
        runs = {"r1": {"status": "done", "output": "checked\nACCEPTED: every ask met"}}

        def gh(args):
            if args[:2] == ["issue", "list"] and "--state" in args and args[args.index("--state") + 1] == "open":
                fields = args[args.index("--json") + 1].split(",")
                return json.dumps([{k: i[k] for k in fields if k in i} for i in open_issues])
            if args[:2] == ["issue", "list"]:
                return "[]"
            if args[:2] == ["issue", "close"]:
                closed.append(int(args[2]))
                return ""
            return json.dumps(dict(PARENT, number=10, state="OPEN", comments=[]))

        def account(cmd, args):
            if cmd == "send_message":
                return {"runId": "r1"}
            if cmd == "get_run":
                return runs[args["runId"]]
            return {}

        st = acceptance.Station(self.cfg, self.store, account, gh, lambda: self.now, lambda n, m: logs.append((n, m)))
        self.assertEqual(st.open_children(10), [{"number": 99, "title": "Gaps of #10: missing validation", "body": "Needs validation."}])
        self.assertEqual(st.open_children(1), [])

        kids = [job(11, "merged", 10, 70)]
        st.once(1, kids)
        self.assertEqual(self.store.get_all("accept:10"), {})

        open_issues.clear()
        st.once(1, kids)
        self.assertEqual(self.store.get_all("accept:10")["state"], "running")

        open_issues.append({"number": 12, "title": "Follow-up slice", "body": "**Part of**: #10\n"})
        st.once(2, kids)
        self.assertEqual(closed, [])
        self.assertEqual(self.store.get_all("accept:10")["state"], "gaps")

        open_issues[:] = [{"number": 99, "title": "Gaps of #10: missing validation", "body": "Needs validation."}]
        st.once(6, kids)
        self.assertEqual(self.store.get_all("accept:10")["state"], "gaps")

        open_issues.clear()
        st.once(11, kids)
        self.assertEqual(self.store.get_all("accept:10")["state"], "running")
        st.once(12, kids)
        self.assertEqual(closed, [10])
        self.assertEqual(self.store.get_all("accept:10")["state"], "accepted")

    def test_accept_rechecks_open_children_immediately_before_close(self):
        open_issues, closed, list_calls = [], [], []

        def gh(args):
            if args[:2] == ["issue", "list"] and "--state" in args and args[args.index("--state") + 1] == "open":
                list_calls.append(len(open_issues))
                if len(list_calls) == 2:
                    open_issues.append({"number": 99, "title": "Gaps of #10: created before close", "body": ""})
                fields = args[args.index("--json") + 1].split(",")
                return json.dumps([{k: i[k] for k in fields if k in i} for i in open_issues])
            if args[:2] == ["issue", "list"]:
                return "[]"
            if args[:2] == ["issue", "close"]:
                closed.append(int(args[2]))
                return ""
            return json.dumps(dict(PARENT, number=10, state="OPEN", comments=[]))

        def account(cmd, _args):
            if cmd == "send_message":
                return {"runId": "r1"}
            if cmd == "get_run":
                return {"status": "done", "output": "checked\nACCEPTED: every ask met"}
            return {}

        st = acceptance.Station(self.cfg, self.store, account, gh, lambda: self.now, lambda *a: None)
        kids = [job(11, "merged", 10, 70)]
        st.once(1, kids)
        self.assertEqual(list_calls, [0])
        self.assertEqual(self.store.get_all("accept:10")["state"], "running")
        st.once(2, kids)
        self.assertEqual(len(list_calls), 2)
        self.assertEqual(closed, [])
        self.assertEqual(self.store.get_all("accept:10")["state"], "gaps")

if __name__ == "__main__":
    unittest.main()
