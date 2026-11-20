import json
import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, HEAD, World, ready, wf

ACCEPTOR = {"coworkers": [{"id": "a1", "name": "BARBARA", "runs": 1}]}
TYPES = {"coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}, {"id": "b2", "name": "B2", "runs": 1}]},
         "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}, {"id": "r2", "name": "R2", "runs": 1}]}}


def parent():
    return {"number": 9, "title": "Factory page", "body": "Ask one.\nAsk two.\n", "comments": ["## Plan\nstep one"]}


def child():
    return {"number": 5, "title": "Fix x", "body": ready("**Part of**: #9\n"), "comments": []}


def gap():
    return {"number": 30, "title": "Gap: menu", "body": "**Part of**: #9\n**Repairs**: #5\nThe menu is missing.\n", "comments": []}


class Acceptance(Base):
    def setUp(self):
        super().setUp()
        self.w = World(issues=[parent(), child()])
        self.w.ledger = self.cfg["ledger_file"]
        self.w.unlabelled.add(9)
        self.cfg["types"] = dict(TYPES, acceptor=ACCEPTOR)

    def sent_to(self, agent):
        return [s for s in self.w.sends if s[0] == agent]

    def kv(self, job, k):
        rows = self.w.rows("SELECT v FROM kv WHERE job=? AND k=?", job, k)
        return rows[0][0] if rows else None

    def merge_child(self):
        self.to_checks()
        self.tick()
        self.w.workflows[HEAD] = [wf("ci", "success"), wf("docs", "skipped", wid=2), wf("ci", "cancelled")]
        self.tick(3)
        self.assertEqual(self.state(), "merged")

    def tick_until(self, cond, limit=12):
        for _ in range(limit):
            if cond():
                return
            self.tick()
        self.fail("condition not met within %d beats" % limit)

    def test_nothing_is_sent_while_a_child_is_at_work(self):
        self.tick(12)
        self.assertNotEqual(self.state(), "merged")
        self.assertEqual(self.sent_to("a1"), [])

    def test_children_closed_outside_the_ledger_are_listed_in_the_brief(self):
        gh = self.w.gh
        closed = [{"number": 4, "title": "Old part", "body": "Part of #9 (phase A)."},
                  {"number": 3, "title": "Other", "body": "Part of #90"},
                  {"number": 5, "title": "Fix x", "body": "**Part of**: #9"}]

        def closed_list(args):
            a = list(args)
            if a[:2] == ["issue", "list"] and "--state" in a and a[a.index("--state") + 1] == "closed":
                return json.dumps(closed)
            return gh(a)

        self.w.gh = closed_list
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        brief = self.sent_to("a1")[0][1]
        self.assertIn("Closed outside the factory's ledger (read each issue and its pull request yourself):", brief)
        self.assertIn("- #4 Old part", brief)
        self.assertNotIn("#3 Other", brief)
        self.assertEqual(brief.count("#5 Fix x"), 1)
        self.assertEqual(brief.count("- #5 Fix x (merged, pull request #42)"), 1)

    def test_the_acceptor_never_judges_a_feature_it_built(self):
        b1 = {"id": "b1", "name": "B1", "runs": 1}
        self.cfg["types"]["coder"] = {"max_jobs": 8, "coworkers": [b1]}
        self.cfg["types"]["acceptor"] = {"coworkers": [b1]}
        self.merge_child()
        self.tick(12)
        self.assertEqual([s for s in self.sent_to("b1") if "One acceptance" in s[1]], [])
        self.assertEqual(self.kv("accept:9", "state"), "no_acceptor")
        self.cfg["types"]["acceptor"] = {"coworkers": [b1] + ACCEPTOR["coworkers"]}
        self.tick(12)
        acceptance_sends = [s[0] for s in self.w.sends if "One acceptance" in s[1]]
        self.assertEqual(acceptance_sends, ["a1"])

    def test_a_parent_with_an_open_child_on_github_is_not_sent(self):
        self.w.open_children = [{"number": 30, "body": "**Part of**: #9\n"}]
        self.merge_child()
        self.tick(12)
        self.assertEqual(self.sent_to("a1"), [])
        self.assertIsNone(self.kv("accept:9", "state"))

    def test_a_closed_parent_is_not_sent(self):
        self.w.issue(9)["state"] = "CLOSED"
        self.merge_child()
        self.tick(12)
        self.assertEqual(self.sent_to("a1"), [])
        self.assertEqual(self.kv("accept:9", "state"), "closed")

    def test_no_acceptor_type_in_the_settings_sends_nothing(self):
        del self.cfg["types"]["acceptor"]
        self.merge_child()
        self.tick(12)
        self.assertEqual(self.sent_to("a1"), [])
        self.assertEqual(self.w.rows("SELECT job FROM kv WHERE job LIKE 'accept:%'"), [])
        self.assertEqual([c for c in self.w.gh_calls if c[:3] == ["issue", "view", "9"] and "title,body,comments,state" in c], [])

    def test_the_parent_goes_to_the_acceptor_once_with_its_text_plan_and_children(self):
        self.merge_child()
        self.tick(12)
        sends = self.sent_to("a1")
        self.assertEqual(len(sends), 1)
        for text in ("Factory page", "Ask one.\nAsk two.", "## Plan\nstep one", "- #5 Fix x (merged, pull request #42)"):
            self.assertIn(text, sends[0][1])
        self.assertEqual(self.w.rows("SELECT job, stage, coworker FROM fires WHERE job='accept:9'"), [("accept:9", "accept", "BARBARA")])

    def test_accepted_closes_the_parent_with_her_line(self):
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        self.w.finish("a1", "checked\nACCEPTED: every ask holds on dev")
        self.tick()
        self.assertEqual(self.w.closed, [(9, "Accepted by BARBARA.\nACCEPTED: every ask holds on dev")])
        self.assertEqual(self.kv("accept:9", "state"), "accepted")
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 1)
        self.assertEqual(len(self.w.closed), 1)

    def test_gaps_are_commented_and_each_is_an_escaped_defect_of_the_job_it_names(self):
        self.w.issues.append(gap())
        self.w.unlabelled.add(30)
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        self.w.open_children = [{"number": 30, "body": "**Part of**: #9\n"}]
        self.w.finish("a1", "looked\nGAPS: #30")
        self.tick()
        self.assertIn("GAPS: #30", self.w.issue(9)["comments"][-1])
        self.assertEqual(self.w.closed, [])
        self.assertEqual(self.kv("accept:9", "state"), "gaps")
        self.assertEqual(self.w.rows("SELECT k FROM kv WHERE job='escaped'"), [("5|gap #30",)])
        self.assertEqual(self.w.rows("SELECT kind, job, reason FROM failures WHERE kind='escaped'"), [("escaped", "5", "gap #30")])
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 1)

    def test_an_open_gap_issue_holds_the_parent_when_github_search_finds_nothing(self):
        self.w.search_finds = False
        self.w.issues.append(gap())
        self.w.unlabelled.add(30)
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        self.w.open_children = [{"number": 30, "body": "**Part of**: #9\n"}]
        self.w.finish("a1", "looked\nGAPS: #30")
        self.tick()
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 1)
        self.assertEqual(self.w.rows("SELECT k FROM kv WHERE job='escaped'"), [("5|gap #30",)])

    def test_a_full_open_issue_list_holds_the_parent(self):
        self.w.open_children = [{"number": 1000 + k, "body": "**Part of**: #90\n"} for k in range(1000)]
        self.merge_child()
        self.tick(12)
        self.assertEqual(self.sent_to("a1"), [])


    def test_an_open_gaps_of_title_issue_without_part_of_holds_the_parent(self):
        self.w.open_children = [{"number": 30, "title": "Gaps of #9: missing menu", "body": "The menu is missing.\n"}]
        self.merge_child()
        self.tick(12)
        self.assertEqual(self.sent_to("a1"), [])
        self.assertIsNone(self.kv("accept:9", "state"))

    def test_a_gap_or_child_opened_before_close_aborts_the_closure(self):
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        gh = self.d.acceptance.gh
        injected = []

        def racing_gh(args):
            a = list(args)
            if a[:2] == ["issue", "list"] and "--state" in a and a[a.index("--state") + 1] == "open" and "number,title,body" in a and not injected:
                injected.append(True)
                self.w.open_children = [{"number": 30, "title": "Gaps of #9: missing menu", "body": "No Part of line.\n"}]
            return gh(a)
        self.d.acceptance.gh = racing_gh
        self.w.finish("a1", "checked\nACCEPTED: every ask holds on dev")
        self.tick()
        self.assertEqual(self.w.closed, [])
        self.assertEqual(self.kv("accept:9", "state"), "gaps")
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 1)
        self.w.open_children = []
        self.tick_until(lambda: len(self.sent_to("a1")) == 2)
        self.w.finish("a1", "checked\nACCEPTED: every ask holds on dev")
        self.tick()
        self.assertEqual(self.w.closed, [(9, "Accepted by BARBARA.\nACCEPTED: every ask holds on dev")])
        self.assertEqual(self.kv("accept:9", "state"), "accepted")

    def test_the_brief_asks_for_one_issue_per_parent_listing_every_gap(self):
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        brief = self.sent_to("a1")[0][1]
        self.assertIn("one issue for this parent", brief)
        self.assertIn("lists every gap", brief)
        self.assertIn("what is asked, what is there and how you saw it", brief)
        self.assertIn("its own `**Repairs**: #<child>` line", brief)
        self.assertIn("`**Part of**: #9`", brief)
        self.assertIn("`Gaps of #9: Factory page`", brief)
        self.assertNotIn("one issue per gap", brief)

    def test_one_gap_issue_with_two_repairs_lines_escapes_both_children(self):
        self.merge_child()
        db = sqlite3.connect(self.cfg["ledger_file"])
        cols = [r[1] for r in db.execute("PRAGMA table_info(jobs)")]
        sel = ", ".join("'6'" if c == "job" else c for c in cols)
        db.execute("INSERT INTO jobs (%s) SELECT %s FROM jobs WHERE job='5'" % (", ".join(cols), sel))
        db.commit()
        db.close()
        self.w.issues.append(dict(gap(), body="**Part of**: #9\n**Repairs**: #5\n**Repairs**: #6\nTwo gaps.\n"))
        self.w.unlabelled.add(30)
        self.tick_until(lambda: self.sent_to("a1"))
        self.w.open_children = [{"number": 30, "body": "**Part of**: #9\n"}]
        self.w.finish("a1", "looked\nGAPS: #30")
        self.tick()
        self.assertEqual(sorted(self.w.rows("SELECT k FROM kv WHERE job='escaped'")), [("5|gap #30",), ("6|gap #30",)])

    def test_a_run_without_a_final_line_is_asked_once_more_then_left(self):
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        self.w.finish("a1", "I looked and stopped.")
        self.tick_until(lambda: len(self.sent_to("a1")) == 2)
        self.w.finish("a1", "still nothing")
        self.tick()
        self.assertEqual(self.kv("accept:9", "state"), "left")
        self.assertEqual(self.w.closed, [])
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 2)

    def leave(self):
        self.merge_child()
        self.tick_until(lambda: self.sent_to("a1"))
        self.w.finish("a1", "I looked and stopped.")
        self.tick_until(lambda: len(self.sent_to("a1")) == 2)
        self.w.finish("a1", "still nothing")
        self.tick()
        self.assertEqual(self.kv("accept:9", "state"), "left")

    def test_a_left_parent_gets_one_fresh_round_after_a_wait_then_stays_left(self):
        self.leave()
        self.w.clock += 7 * 3600
        self.tick_until(lambda: len(self.sent_to("a1")) == 3)
        self.assertEqual(self.kv("accept:9", "revived"), "1")
        self.w.finish("a1", "nothing again")
        self.tick_until(lambda: len(self.sent_to("a1")) == 4)
        self.w.finish("a1", "and nothing")
        self.tick()
        self.assertEqual(self.kv("accept:9", "state"), "left")
        self.w.clock += 30 * 3600
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 4)

    def test_the_fresh_round_waits_its_six_hours(self):
        self.leave()
        self.w.clock += 5 * 3600
        self.tick(12)
        self.assertEqual(len(self.sent_to("a1")), 2)
        self.w.clock += 3600 + 1
        self.tick_until(lambda: len(self.sent_to("a1")) == 3)

    def test_a_left_parent_that_got_its_answer_in_the_fresh_round_is_accepted(self):
        self.leave()
        self.w.clock += 7 * 3600
        self.tick_until(lambda: len(self.sent_to("a1")) == 3)
        self.w.finish("a1", "checked\nACCEPTED: every ask is met")
        self.tick()
        self.assertEqual(self.kv("accept:9", "state"), "accepted")

    def test_a_record_left_before_the_wait_was_kept_is_revived_at_once(self):
        self.leave()
        self.d.store.db.execute("DELETE FROM kv WHERE job='accept:9' AND k='left_at'")
        self.tick_until(lambda: len(self.sent_to("a1")) == 3)


if __name__ == "__main__":
    unittest.main()
