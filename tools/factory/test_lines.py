import contextlib
import json
import os
import shutil
import sqlite3
import unittest
import unittest.mock

import dispatch as D
import lines as L
import store as S
from test_dispatch import HEAD, PR_LINE, Base, World, ready, wf


def issue(n, title="Other", deps="none"):
    return {"number": n, "title": title, "body": ready(deps=deps), "comments": []}


class Pair(Base):
    def setUp(self):
        super().setUp()
        self.p = World([issue(5)])
        self.p.ledger = L.ledger_path(self.cfg, "p/q")
        self.worlds = {"o/r": self.w, "p/q": self.p}
        self.answer = {"kept": True}
        self.w.report_answer = self.p.report_answer = self.answer

    def new(self):
        clock = lambda: self.w.clock
        return L.Lines(self.cfg, None, None, now=clock, make=lambda c: D.Dispatcher(
            c, self.worlds[c["repo"]].account, self.worlds[c["repo"]].gh, now=clock))

    def start(self, passed=True):
        self.d = self.new()
        if passed:
            self.d.kv.set("-", "ready:p/q", json.dumps({"passed": True}))

    def select(self, repo, by="rob"):
        self.answer["project"] = {"repo": repo, "by": by}

    def lines_said(self, text):
        return [x for x in self.out.getvalue().split("\n") if text in x]


class Two(Pair):
    def test_the_default_project_is_the_home_and_an_app_without_an_answer_changes_nothing(self):
        self.start()
        self.tick(3)
        self.assertEqual(self.d.active, "o/r")
        self.assertEqual(self.state(), "building")
        self.assertEqual(self.p.sends, [])
        self.assertEqual(self.w.reports[-1]["home"], "o/r")
        self.assertEqual(self.w.reports[-1]["finishing"], [])

    def test_the_ledger_of_today_is_carried_over_as_the_home_ledger(self):
        d = D.Dispatcher(self.cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        with contextlib.redirect_stdout(self.out):
            d.once()
        d.store.set("plan:12", "state", "planning")
        d.store.set("-", "hold:sign-in renewal", json.dumps({"until": 5}))
        d.store.add_failure("problem", "5", station="resolve", reason="x")
        d.close()
        db = sqlite3.connect(self.cfg["ledger_file"])
        db.execute("DELETE FROM kv WHERE k='project_of'")
        db.commit()
        dump = lambda: {t: db.execute("SELECT * FROM %s ORDER BY 1, 2" % t).fetchall() for t in ("jobs", "fires", "transitions", "failures", "kv")}
        before = dump()
        self.assertEqual([r[0] for r in before["jobs"]], ["5"])
        self.start(passed=False)
        after = dump()
        self.assertEqual(self.w.rows("SELECT v FROM kv WHERE job='-' AND k='project_of'"), [("o/r",)])
        after["kv"] = [r for r in after["kv"] if r[1] != "project_of"]
        self.assertEqual(after, before)
        db.close()
        self.w.finish("b1", PR_LINE)
        self.tick(2)
        self.assertEqual(self.state(), "reviewing")

    def test_a_ledger_with_rows_and_no_project_is_refused_for_another_project(self):
        d = D.Dispatcher(self.cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        with contextlib.redirect_stdout(self.out):
            d.once()
        d.close()
        shutil.copy(self.cfg["ledger_file"], self.p.ledger)
        db = sqlite3.connect(self.p.ledger)
        db.execute("DELETE FROM kv WHERE k='project_of'")
        db.commit()
        db.close()
        self.start()
        self.select("p/q")
        self.tick(4)
        self.assertEqual(self.d.active, "o/r")
        self.assertEqual(len(self.lines_said("holds rows and names no project")), 1)
        self.assertEqual(self.p.sends, [])

    def test_a_ledger_of_one_project_is_refused_for_another(self):
        path = os.path.join(self.dir.name, "x.db")
        s = S.Store(path)
        s.claim("a/b", "o/r")
        s.claim("a/b", "o/r")
        with self.assertRaises(S.Refused):
            s.claim("p/q", "o/r")
        s.close()
        with self.assertRaises(S.Refused):
            D.Dispatcher(dict(self.cfg, repo="p/q", home="o/r", ledger_file=path), self.w.account, self.w.gh)
        S.Store(path).close()

    def test_equal_issue_numbers_of_two_projects_do_not_collide(self):
        self.start()
        self.to_review()
        self.select("p/q")
        self.tick(2)
        self.assertEqual(self.d.active, "p/q")
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual(self.p.rows("SELECT job, state FROM jobs"), [("5", "building")])
        self.assertEqual(self.w.rows("SELECT json_extract(data, '$.title') FROM jobs WHERE job='5'"), [("Fix x",)])
        self.assertEqual(self.p.rows("SELECT json_extract(data, '$.title'), json_extract(data, '$.repo') FROM jobs WHERE job='5'"), [("Other", "p/q")])
        self.assertEqual(self.p.rows("SELECT v FROM kv WHERE job='-' AND k='project_of'"), [("p/q",)])
        self.assertEqual(self.p.sends[0][0], "b1")

    def test_a_switch_with_jobs_in_every_state_ends_each_or_keeps_it_moving_and_none_twice(self):
        self.w.issues += [issue(6, "Six"), issue(7, "Seven", deps="#6")]
        self.w.open_numbers.add(6)
        self.start()
        self.to_review()
        self.assertEqual([r[0] for r in self.w.rows("SELECT state FROM jobs ORDER BY job")], ["reviewing", "building", "waiting"])
        self.select("p/q")
        self.tick()
        self.w.issues.append(issue(8, "Eight"))
        self.tick()
        self.assertEqual(self.p.reports[-1]["repo"], "p/q")
        self.assertEqual(self.p.reports[-1]["finishing"], [{"repo": "o/r", "jobs": 2}])
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.w.finish("b2", "tried\nBLOCKED: the issue names no file")
        self.tick(2)
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick(4)
        self.assertEqual(self.w.rows("SELECT job, state FROM jobs ORDER BY job"), [("5", "merged"), ("6", "blocked"), ("7", "waiting")])
        self.assertEqual(len(self.w.merges), 1)
        self.assertEqual(self.w.cancels + self.p.cancels, [])
        firsts = [(a, m.split("\n")[0]) for a, m, _ in self.w.sends + self.p.sends]
        self.assertEqual(len(firsts), len(set(firsts)))
        self.assertFalse([m for _, m, _ in self.w.sends if "#7" in m.split("\n")[0] or "#8" in m.split("\n")[0]])
        self.assertEqual(self.p.reports[-1]["finishing"], [])
        self.assertEqual(self.p.rows("SELECT state FROM jobs WHERE job='5'"), [("building",)])
        self.select("o/r")
        self.tick(3)
        self.assertEqual(self.d.active, "o/r")
        self.assertIn("8", self.job_ids())

    def test_two_lines_never_use_the_same_coworker_at_once(self):
        self.start()
        self.tick()
        self.select("p/q")
        self.tick(2)
        self.assertEqual((self.w.sends[0][0], self.p.sends[0][0]), ("b1", "b2"))

    def test_the_app_away_keeps_the_last_project_also_after_a_restart(self):
        self.start()
        self.select("p/q")
        self.tick(2)
        self.w.report_answer = self.p.report_answer = None
        self.tick(3)
        self.assertEqual(self.d.active, "p/q")
        self.tick(2, fresh=True)
        self.assertEqual(self.d.active, "p/q")
        self.assertTrue(self.d.lines["p/q"].taking)
        self.assertFalse(self.d.lines["o/r"].taking)

    def test_a_malformed_answer_changes_nothing_and_is_one_problem_line(self):
        self.start()
        for bad in ("x", {"repo": "../x"}, {"repo": 7}, ["p/q"], {"name": "p/q"}):
            self.answer["project"] = bad
            self.tick(3)
            self.assertEqual(self.d.active, "o/r")
        self.assertEqual(len(self.lines_said("project answer not understood: the factory stays on o/r")), 1)
        self.assertEqual(self.p.sends, [])
        self.assertEqual(self.w.rows("SELECT COUNT(*) FROM events WHERE key='project'"), [(0,)])

    def test_a_project_whose_readiness_did_not_pass_here_is_refused_whatever_the_app_says(self):
        self.start(passed=False)
        self.select("p/q")
        self.tick(4)
        self.assertEqual(self.d.active, "o/r")
        self.assertEqual(len(self.lines_said("project p/q not taken: its readiness is not recorded as passed here")), 1)
        self.d.kv.set("-", "ready:p/q", json.dumps({"passed": False}))
        self.tick(2)
        self.assertEqual(self.d.active, "o/r")
        self.assertEqual(self.p.sends, [])

    def test_every_switch_is_one_line_in_the_ledger_with_who_and_when(self):
        self.start()
        self.select("p/q", by="rob@example.com")
        self.tick(3)
        self.select("o/r", by="rob@example.com")
        self.tick(3)
        rows = self.w.rows("SELECT old, new FROM events WHERE key='project' ORDER BY id")
        self.assertEqual([json.loads(r[0]) for r in rows], ["o/r", "p/q"])
        first = json.loads(json.loads(rows[0][1]))
        self.assertEqual((first["repo"], first["from"], first["by"]), ("p/q", "o/r", "rob@example.com"))
        self.assertRegex(first["at"], r"^\d{4}-\d\d-\d\dT")
        self.assertEqual(self.w.reports[-1]["switch"]["repo"], "o/r")
        self.assertEqual(len(self.lines_said("#project o/r -> p/q by rob@example.com; finishing")), 1)

    def test_the_dispatcher_started_by_main_is_the_lines_with_main_s_own_module(self):
        seen = []
        real = L.Lines
        for name, fake in (("settings", lambda: dict(self.cfg, proof=True)), ("make_account", lambda url, key: self.w.account),
                           ("make_gh", lambda tok: self.w.gh), ("read_secret", lambda path: "fake-key")):
            self.addCleanup(setattr, D, name, getattr(D, name))
            setattr(D, name, fake)
        self.addCleanup(setattr, L, "Lines", real)
        L.Lines = lambda *a, **k: seen.append(k) or real(*a, **k)
        with unittest.mock.patch.dict(os.environ, {"DISPATCH_ACCOUNT_URL": "http://account.invalid"}), contextlib.redirect_stdout(self.out):
            self.assertEqual(D.main(["once"]), 0)
        self.assertIs(seen[0]["mod"], D)
        self.assertEqual(self.state(), "building")


if __name__ == "__main__":
    unittest.main()
