import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import failures
import store as ledger_store
from test_dispatch import Base, ready


class Kinds(unittest.TestCase):
    def test_kinds_name_every_failure_move_and_nothing_else(self):
        k = failures.kinds
        self.assertEqual(k("building", "blocked", "blocked: no"), ["ended blocked"])
        self.assertEqual(k("reviewing", "fix_wait", "rejected: bad"), ["fix round"])
        self.assertEqual(k("proving", "fix_wait", "proof failed: x"), ["proof fail", "fix round"])
        self.assertEqual(k("proving", "rejected", "rejected: proof: x"), ["proof fail", "ended rejected"])
        self.assertEqual(k("building", "building", "sent again, asked again"), ["asked again"])
        self.assertEqual(k("checks", "merged", "merged"), [])
        self.assertEqual(k("reviewing", "checks", "accepted"), [])
        self.assertEqual(k("blocked", "returned", "returned: x"), ["ended returned"])
        self.assertEqual(k("waiting", "returned", "returned: issue closed or the factory label removed"), [])
        self.assertEqual(k("building", "failed", "failed: x"), ["ended failed"])

    def test_version_is_ten_hex_characters_and_none_without_briefs(self):
        import dispatch
        self.assertEqual(len(failures.version("building")), 10)
        self.assertEqual(failures.version("building"), failures.version("building"))
        self.assertNotEqual(failures.version("building"), failures.version("reviewing"))
        self.assertIsNone(failures.version("checks"))
        self.assertIn("returned", failures.SOURCES)
        self.assertTrue(dispatch)


class Ledger(Base):
    def failures(self):
        return self.w.rows("SELECT kind, job, station, coworker, model, tier, reason, plan_run, brief FROM failures ORDER BY id")

    def test_a_blocked_build_is_kept_with_its_station_coworker_reason_and_brief_version(self):
        self.tick()
        self.w.finish("b1", "tried\nBLOCKED: the issue names no file")
        self.tick(2)
        rows = self.failures()
        self.assertEqual([r[:4] for r in rows], [("ended blocked", "5", "build", "B1")])
        self.assertIn("the issue names no file", rows[0][6])
        self.assertEqual(rows[0][8], failures.version("building"))
        self.assertEqual(len(rows[0][8]), 10)
        self.assertIsNone(rows[0][4])

    def test_a_rejected_review_is_one_fix_round_of_the_review_station(self):
        self.to_review()
        self.w.finish("r1", "bad\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick(2)
        rows = self.failures()
        self.assertEqual([r[:4] for r in rows], [("fix round", "5", "review", "R1")])
        self.assertEqual(rows[0][8], failures.version("reviewing"))

    def test_a_clean_merge_writes_no_event(self):
        self.to_review()
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.tick(3)
        self.assertEqual(self.failures(), [])

    def test_the_plan_run_that_cut_the_job_is_kept(self):
        self.w.issues = [{"number": 5, "title": "Fix x", "body": ready("**Part of**: #9"), "comments": []}]
        self.d = self.new()
        fid = self.d.store.intent("plan:9", "", "plan", at="2020-01-01T00:00:00Z")
        self.d.store.fired(fid, "planrun1")
        self.tick()
        self.w.finish("b1", "BLOCKED: no")
        self.tick(2)
        self.assertEqual([r[7] for r in self.failures()], ["planrun1"])

    def test_a_new_resolver_problem_is_one_event(self):
        self.cfg["resolver"] = {"detect": True, "resolve": False}
        self.w.issues.append({"number": 6, "title": "bad", "body": ready().replace("**Files**", "Files"), "comments": []})
        self.tick(4)
        rows = [r for r in self.failures() if r[0] == "problem"]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0][1], rows[0][2]), ("6", "resolve"))
        self.assertTrue(rows[0][6].startswith("unreadable #6: "))

    def test_failures_after_an_id_returns_only_newer_rows(self):
        s = ledger_store.Store(os.path.join(self.dir.name, "x.db"))
        a = s.add_failure("ended blocked", 5, reason="x" * 400)
        b = s.add_failure("fix round", "6", station="review")
        rows = s.failures(after=a)
        self.assertEqual([r["id"] for r in rows], [b])
        self.assertEqual(len(s.failures()[0]["reason"]), 300)
        self.assertEqual(s.failures()[0]["job"], "5")
        s.close()


if __name__ == "__main__":
    unittest.main()
