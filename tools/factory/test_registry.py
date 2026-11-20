import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
import registry
import states
from store import Store

NOW = "2026-11-19T12:00:00Z"


class Base(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.s = Store(os.path.join(d, "f.db"))
        self.addCleanup(self.s.close)

    def kv(self, job, **kw):
        for k, v in kw.items():
            self.s.set(job, k, v)

    def row(self, n):
        return {r["issue"]: r for r in registry.rows(registry.read(self.s), NOW)}.get(str(n))


class Steps(unittest.TestCase):
    def test_every_station_state_has_exactly_one_step(self):
        for station, table in registry.STEPS.items():
            for state, step in table.items():
                self.assertIn(step, registry.STEP_NAMES, (station, state))
        self.assertEqual(set(registry.STEPS["job"]), set(states.NAMES))
        plan = set(planning.LIVE) | set(planning.ENDED) | {"planned", "replan", "revise", "repair", "resend", "asked", "unsent"}
        self.assertEqual(set(registry.STEPS["plan"]), plan)
        self.assertEqual(set(registry.STEPS["recheck"]), {"sending", "running", "fresh", "corrected", "blocked"})
        self.assertEqual(set(registry.STEPS["accept"]),
                         {"running", "unsent", "no_acceptor", "gaps", "accepted", "closed", "left"})
        self.assertEqual(set(registry.STEPS["instr"]), {"review", "unsent", "unreadable", "refused", "rejected", "applied"})


class Moves(Base):
    def test_a_state_change_stamps_when_it_moved_and_from_what(self):
        self.s.set("plan:5", "state", "planning")
        self.s.db.execute("UPDATE moves SET at='2026-11-19T10:00:00Z' WHERE job='plan:5'")
        self.s.set("plan:5", "state", "planning")
        self.assertEqual(self.s.moved("plan:5"), {"state": "planning", "prev": None, "at": "2026-11-19T10:00:00Z"})
        self.s.set("plan:5", "state", "cutting")
        m = self.s.moved("plan:5")
        self.assertEqual((m["state"], m["prev"]), ("cutting", "planning"))
        self.assertNotEqual(m["at"], "2026-11-19T10:00:00Z")

    def test_forget_drops_the_stamp(self):
        self.s.set("plan:5", "state", "planning")
        self.s.forget("plan:5")
        self.assertIsNone(self.s.moved("plan:5"))

    def test_other_keys_leave_the_record_unchanged(self):
        self.s.set("plan:5", "agent", "a")
        self.assertIsNone(self.s.moved("plan:5"))
        self.assertEqual(self.s.get_all("plan:5"), {"agent": "a"})


class Rows(Base):
    def job(self, n, state, at="2026-11-19T11:00:00Z", **data):
        self.s.put_job(str(n), state, dict(data, issue=n), at=at)

    def test_a_running_build_is_taken_since_its_last_real_move(self):
        self.job(7, "queued", at="2026-11-19T09:00:00Z")
        self.job(7, "building", at="2026-11-19T10:00:00Z", agent="b1")
        self.job(7, "building", at="2026-11-19T11:30:00Z", agent="b1")
        r = self.row(7)
        self.assertEqual((r["step"], r["handover"]["status"], r["handover"]["since"]),
                         ("building", "taken", "2026-11-19T10:00:00Z"))
        self.assertEqual((r["handover"]["from"], r["handover"]["to"]), ("queued", "building"))

    def test_a_review_sending_it_back_is_back_with_why(self):
        self.job(8, "reviewing")
        self.job(8, "fix_wait", wait_reason="two findings")
        r = self.row(8)
        self.assertEqual((r["step"], r["handover"]["status"], r["handover"]["why"]), ("fixing", "back", "two findings"))

    def test_a_run_dropped_to_its_wait_is_a_retry(self):
        self.job(9, "building")
        self.job(9, "queued")
        self.assertEqual(self.row(9)["handover"]["status"], "retry")

    def test_a_running_build_whose_newest_fire_is_lost_is_lost(self):
        self.job(10, "building")
        f = self.s.intent("10", "", "build")
        self.s.abandon(f)
        self.assertEqual(self.row(10)["handover"]["status"], "lost")

    def test_a_live_build_beats_the_parents_plan_and_acceptance(self):
        self.kv("plan:11", state="cut")
        self.kv("accept:11", state="running", agent="a", started=1763550000)
        self.job(11, "checks")
        r = self.row(11)
        self.assertEqual((r["step"], r["station"], r["handover"]["status"]), ("checks", "job", "sent"))

    def test_acceptance_beats_a_cut_plan_and_an_epoch_start_reads_as_iso(self):
        self.kv("plan:12", state="cut")
        self.kv("accept:12", state="running", agent="a", started=1763546400)
        self.s.db.execute("DELETE FROM moves WHERE job='accept:12'")
        r = self.row(12)
        self.assertEqual((r["step"], r["handover"]["status"], r["handover"]["since"]),
                         ("acceptance", "taken", "2025-11-19T10:00:00Z"))

    def test_a_running_recheck_shows_over_its_waiting_build(self):
        self.job(40, "waiting")
        self.kv("recheck:40", state="running", agent="p1")
        r = self.row(40)
        self.assertEqual((r["station"], r["handover"]["status"]), ("recheck", "taken"))

    def test_a_classify_run_is_timed_from_its_send(self):
        f = self.s.intent("classify:18", "", "classify", at="2026-11-19T11:55:00Z")
        self.kv("classify:18", run="r", fire=f, at=1700000000)
        self.assertEqual(self.row(18)["handover"]["since"], "2026-11-19T11:55:00Z")

    def test_an_applied_instruction_is_done(self):
        self.kv("instr:19", state="applied")
        self.assertEqual(self.row(19)["step"], "done")

    def test_plan_records_map_to_planning_steps(self):
        cases = {"cutting": ("cutting", "taken"), "reviewing": ("plan-review", "taken"), "revise": ("plan-review", "back"),
                 "asked": ("planning", "with-owner"), "lost": ("problem", "lost"), "cut": ("children", None),
                 "planned": ("planning", "sent")}
        for i, (state, want) in enumerate(cases.items()):
            self.kv("plan:%d" % (100 + i), state=state, why="w")
            r = self.row(100 + i)
            self.assertEqual((r["step"], (r["handover"] or {}).get("status")), want, state)

    def test_acceptance_asked_again_is_a_retry_and_left_is_refused(self):
        self.kv("accept:13", state="unsent", sends="0")
        self.kv("accept:14", state="unsent", sends="2")
        self.kv("accept:17", state="left", sends="3")
        self.assertEqual([self.row(n)["handover"]["status"] for n in (13, 14, 17)], ["sent", "retry", "refused"])

    def test_a_live_classify_run_is_intake_and_a_finished_one_is_not_listed(self):
        self.kv("classify:15", run="r1", issue="{}")
        self.kv("classify:16", run="", issue="{}")
        self.assertEqual(self.row(15)["step"], "intake")
        self.assertIsNone(self.row(16))

    def test_accepted_parent_wins_over_older_returned_job_and_fresh_started_beats_stale_move(self):
        self.job(10, "returned", at="2026-11-19T08:00:00Z")
        self.kv("accept:10", state="accepted")
        self.assertEqual(self.row(10)["step"], "done")
        self.job(101, "returned", at="2026-11-19T08:00:00Z")
        self.kv("accept:101", state="gaps", why="gap #102")
        self.assertEqual(self.row(101)["step"], "problem")
        self.kv("plan:20", state="planning", agent="p1", started="2026-11-19T11:59:50Z")
        self.s.db.execute("UPDATE moves SET at='2026-11-19T10:00:00Z' WHERE job='plan:20'")
        r = self.row(20)
        self.assertEqual(r["handover"]["since"], "2026-11-19T11:59:50Z")
        self.assertFalse(registry.stuck(r, NOW, {}))

    def test_planning_beats_idle_accept_gaps_and_left(self):
        self.kv("accept:21", state="gaps", why="gap #22")
        self.kv("plan:21", state="planning", agent="p1", started="2026-11-19T11:55:00Z")
        self.assertEqual((self.row(21)["station"], self.row(21)["step"]), ("plan", "planning"))
        self.kv("accept:23", state="left", sends="3")
        self.kv("plan:23", state="planning", agent="p1", started="2026-11-19T11:55:00Z")
        self.assertEqual((self.row(23)["station"], self.row(23)["step"]), ("plan", "planning"))
        self.kv("plan:24", state="cut")
        self.kv("accept:24", state="gaps", why="gap #25")
        self.assertEqual((self.row(24)["station"], self.row(24)["step"], self.row(24)["handover"]["status"]),
                         ("accept", "acceptance", "back"))

    def test_import_json_round_trips_moves(self):
        f = os.path.join(os.path.dirname(self.s.path), "state.json")
        self.s.db.execute("INSERT INTO kv VALUES('plan:30','state','planned')")
        with open(f, "w") as fh:
            json.dump({"jobs": {}, "kv": {"accept:31": {"state": "gaps", "why": "gap #32"}},
                       "moves": {"accept:31": {"state": "gaps", "prev": "running", "at": "2026-11-19T09:30:00Z"}}}, fh)
        self.s.import_json(f)
        self.assertEqual(self.s.moved("accept:31"),
                         {"state": "gaps", "prev": "running", "at": "2026-11-19T09:30:00Z"})
        self.assertEqual(self.s.moved("plan:30")["state"], "planned")
        self.assertEqual(self.row(31)["handover"]["since"], "2026-11-19T09:30:00Z")


class Summary(Base):
    def test_counts_steps_and_lists_stuck_handovers(self):
        rows = [
            {"issue": "1", "step": "building", "station": "job", "handover": {"status": "taken", "since": "2026-11-19T11:50:00Z", "by": "b"}},
            {"issue": "2", "step": "building", "station": "job", "handover": {"status": "taken", "since": "2026-11-19T01:00:00Z", "by": "b"}},
            {"issue": "3", "step": "queued", "station": "job", "handover": {"status": "sent", "since": "2026-11-18T01:00:00Z"}},
            {"issue": "4", "step": "problem", "station": "plan", "handover": {"status": "lost", "since": NOW}},
            {"issue": "5", "step": "merged", "station": "job", "handover": None},
        ]
        rows.append({"issue": "6", "step": "review", "station": "job", "state": "review_wait",
                     "handover": {"status": "sent", "since": "2026-11-18T02:00:00Z"}})
        rows[2]["state"] = "queued"
        out = registry.summary(rows, NOW, {})
        self.assertEqual(out["steps"], {"building": 2, "queued": 1, "problem": 1, "merged": 1, "review": 1})
        self.assertEqual([s["issue"] for s in out["stuck"]], ["4", "2", "6"])
        self.assertEqual([t["issue"] for t in out["taken"]], ["1"])

    def test_the_taken_limit_follows_the_run_limit(self):
        rows = [{"issue": "1", "step": "building", "station": "job", "handover": {"status": "taken", "since": "2026-11-19T11:30:00Z"}}]
        self.assertEqual(registry.summary(rows, NOW, {"clocks": {"run_limit_s": 1200}})["stuck"][0]["issue"], "1")
        self.assertEqual(registry.summary(rows, NOW, {})["stuck"], [])

    def test_the_lists_are_capped(self):
        rows = [{"issue": str(i), "step": "queued", "station": "job", "handover": {"status": "refused", "since": NOW}}
                for i in range(registry.CAP + 5)]
        out = registry.summary(rows, NOW, {})
        self.assertEqual((len(out["stuck"]), out["stuck_more"]), (registry.CAP, 5))


if __name__ == "__main__":
    unittest.main()
