import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import digest
import holds
import test_dispatch_report as R


class Status(unittest.TestCase):
    make, once, reports = R.Report.make, R.Report.once, R.Report.reports

    def capture(self):
        got = []
        real = digest.post
        digest.post = lambda gh, store, repo, d, now: got.append(d) or True
        self.addCleanup(setattr, digest, "post", real)
        return got

    def test_the_posted_digest_names_an_active_hold(self):
        self.make()
        got = self.capture()
        holds.arm(self.d.store, "plan week", self.t + 3600)
        self.once()
        posted = [d for d in got if d is not None]
        self.assertTrue(posted)
        self.assertEqual(posted[-1]["holds"][0]["kind"], "plan week")

    def test_the_posted_digest_lists_unfinished_plans_and_free_planners(self):
        self.make()
        got = self.capture()
        self.d.store.set("plan:12", "state", "reviewing")
        for k, v in (("agent", "p1"), ("copy", "1"), ("run", "r1"), ("started", "2026-11-19T00:00:00Z")):
            self.d.store.set("plan:12", k, v)
        self.d.store.set("plan:13", "state", "blocked")
        self.once()
        last = [d for d in got if d is not None][-1]
        self.assertEqual(last["plans"], {"12": "reviewing"})
        self.assertIn("planner_free", last)
        self.assertEqual(last["holds"], [])

    def planner(self):
        self.d.cfg["types"] = {"planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 2}]}}
        self.d.station = D.planning.Station(self.d.cfg, self.d.store, self.d.account, self.d.gh, self.d.now)
        for k, v in (("state", "reviewing"), ("agent", "p1"), ("copy", "1"), ("run", "r1"), ("started", "2026-11-19T00:00:00Z")):
            self.d.store.set("plan:12", k, v)

    def last(self, got):
        return [d for d in got if d is not None][-1]

    def test_free_planners_are_counted_as_if_no_hold_were_on(self):
        self.make()
        self.planner()
        holds.arm(self.d.store, "plan week", self.t + 3600)
        self.d.cfg["held"] = True
        last = self.d.status({"digest": {}, "holds": [{"kind": "plan week"}]})
        self.assertEqual((last["planner_free"], last["planner_room"]), (1, 1))
        self.assertEqual(last["holds"][0]["kind"], "plan week")

    def test_the_digest_names_who_holds_each_planner_copy(self):
        self.make()
        self.planner()
        for k, v in (("state", "running"), ("agent", "p1"), ("copy", "2"), ("started", "2026-11-18T17:00:00Z")):
            self.d.store.set("recheck:40", k, v)
        self.d.names = D.pools.names(self.d.cfg)
        out = self.d.status({"digest": {}, "holds": []})
        self.assertEqual(out["planner_free"], 0)
        self.assertEqual({h["by"] for h in out["planner_holders"]}, {"Boss"})
        self.assertEqual([(h["job"], h["state"], h["since"]) for h in out["planner_holders"]],
                         [("plan:12", "reviewing", "2026-11-19T00:00:00Z"), ("recheck:40", "running", "2026-11-18T17:00:00Z")])

    def test_the_digest_shows_planner_copies_as_the_controls_set_them(self):
        self.make()
        self.planner()
        self.d.cfg["types"]["planner"]["coworkers"][0]["runs"] = 0
        out = self.d.status({"digest": {}, "holds": []})
        self.assertEqual((out["planner_copies"], out["planner_free"]), ({"Boss": 0}, 0))

    def test_a_broken_plan_record_still_posts_the_digest(self):
        self.make()
        self.capture()
        self.d.store.set("plan:12", "state", "reviewing")
        out = self.d.status({"digest": {"k": 1}, "holds": []})
        self.assertEqual((out["k"], out["holds"], out["planner_error"]), (1, [], "KeyError"))

    def test_the_digest_goes_out_when_the_app_report_fails(self):
        self.make(fail=RuntimeError("down"))
        got = self.capture()
        self.once()
        posted = [d for d in got if d is not None]
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0]["report_error"], "RuntimeError")
        self.assertIn("stations", posted[0])

    def test_an_unreadable_hold_does_not_stop_the_report(self):
        self.make()
        got = self.capture()
        real = D.holds.active
        calls = []

        def active(store, now):
            calls.append(now)
            if len(calls) > 1:
                raise RuntimeError("db")
            return None
        D.holds.active = active
        self.addCleanup(setattr, D.holds, "active", real)
        self.once()
        self.assertTrue([d for d in got if d is not None])

    def test_a_failing_report_still_posts_its_error(self):
        self.make()
        got = self.capture()
        real = D.snapshot.build_snapshot

        def broken(*a, **k):
            raise KeyError("x")
        D.snapshot.build_snapshot = broken
        self.addCleanup(setattr, D.snapshot, "build_snapshot", real)
        holds.arm(self.d.store, "update", self.t + 600)
        self.once()
        posted = [d for d in got if d is not None]
        self.assertEqual(posted[-1]["report_error"], "KeyError")
        self.assertEqual(posted[-1]["holds"][0]["kind"], "update")
        self.assertIn("planner_free", posted[-1])

    def test_the_app_snapshot_digest_is_left_alone(self):
        self.make()
        self.capture()
        holds.arm(self.d.store, "plan week", self.t + 3600)
        self.once()
        snap = self.reports()[-1][1]["snapshot"]
        self.assertNotIn("plans", snap.get("digest") or {})
        self.assertNotIn("holds", snap.get("digest") or {})


if __name__ == "__main__":
    unittest.main()
