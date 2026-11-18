import contextlib, datetime, io, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import holds
from test_dispatch import World, ready, PR_LINE


def issue(n):
    return {"number": n, "title": "Fix %d" % n, "body": ready(), "comments": []}


class Account(World):
    sign_in = {"minutesLeft": 120, "renewalDue": True}
    broken = False

    def account(self, tool, args):
        if tool == "list_ai_connections":
            if self.broken:
                raise KeyError("list_ai_connections")
            return {"connections": [{"id": "c1", "provider": "claude", "isDefault": True,
                                 "signIn": self.sign_in}]}
        return super().account(tool, args)


class Renewal(unittest.TestCase):
    def make(self, issues):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.w = Account(issues)
        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "checks_timeout_s": 3600, "auto_plan_marker": True,
               "poll_s": 30, "clocks": {"run_limit_s": 2700},
               "ledger_file": os.path.join(tmp.name, "ledger.db"),
               "json_state_file": os.path.join(tmp.name, "dispatch.json"),
               "heartbeat_file": os.path.join(tmp.name, "heartbeat"),
               "builders": [{"id": b, "name": b.upper()} for b in ("b1", "b2")],
               "reviewers": [{"id": r, "name": r.upper()} for r in ("r1", "r2")]}
        self.w.ledger = cfg["ledger_file"]
        self.d = D.Dispatcher(cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        self.addCleanup(self.d.close)
        self.out = io.StringIO()

    def beat(self):
        with contextlib.redirect_stdout(self.out):
            self.d.once()

    def state(self, n):
        return self.d.store.get_job(str(n))["state"]

    def hold(self):
        return holds.active(self.d.store, self.w.clock)

    def test_a_sign_in_about_to_run_out_holds_new_sends_only_while_a_run_is_out(self):
        self.make([issue(5)])
        self.beat()
        self.assertEqual((self.state(5), len(self.w.sends)), ("building", 1))
        self.assertIsNone(self.hold())
        self.w.issues.append(issue(6))
        self.w.sign_in = {"minutesLeft": 50, "renewalDue": True}
        self.w.clock += 30
        self.w.finish("b1", PR_LINE)
        self.beat()
        self.assertEqual(self.state(5), "review_wait")
        self.assertEqual(self.state(6), "queued")
        self.assertEqual(len(self.w.sends), 1)
        self.assertEqual(self.hold()["kind"], "sign-in renewal")
        self.assertEqual(self.out.getvalue().count("sign-in has 50 min left"), 1)
        self.w.clock += 30
        self.beat()
        self.assertIsNone(self.hold())
        self.assertEqual(len(self.w.sends), 3)
        self.assertEqual(self.state(6), "building")

    def test_an_idle_line_sends_although_the_sign_in_is_about_to_run_out(self):
        for left in (40, 0):
            self.make([issue(5)])
            self.w.sign_in = {"minutesLeft": left, "renewalDue": True}
            self.beat()
            self.assertEqual((self.state(5), len(self.w.sends)), ("building", 1))
            self.assertIsNone(self.hold())

    def test_the_ledger_is_written_only_when_the_hold_changes(self):
        self.make([])
        key = "hold:sign-in renewal"
        writes = []
        real = self.d.store.set
        self.d.store.set = lambda job, k, v: (writes.append(k), real(job, k, v))[1]
        self.w.sign_in = {"minutesLeft": 300, "renewalDue": False}
        for _ in range(5):
            self.beat()
        self.assertNotIn(key, self.d.store.get_all("-"))
        self.assertEqual(writes.count(key), 0)
        self.w.issues.append(issue(5))
        self.beat()
        self.assertEqual(self.state(5), "building")
        self.w.sign_in = {"minutesLeft": 40, "renewalDue": True}
        self.w.clock += 30
        self.beat()
        self.assertEqual(self.hold()["kind"], "sign-in renewal")
        self.assertEqual(writes.count(key), 1)
        self.w.sign_in = {"minutesLeft": 300, "renewalDue": False}
        self.w.clock += 30
        self.beat()
        self.assertEqual(writes.count(key), 2)
        self.assertEqual(json.loads(self.d.store.get_all("-")[key])["until"], 0)
        for _ in range(3):
            self.w.clock += 30
            self.beat()
        self.assertEqual(writes.count(key), 2)

    def test_a_failed_read_leaves_the_hold_as_it_is(self):
        self.make([issue(5)])
        self.beat()
        self.assertEqual(self.state(5), "building")
        self.w.sign_in = {"minutesLeft": 50}
        self.beat()
        t0 = self.w.clock
        self.assertEqual(self.hold()["until"], t0 + 60)
        self.w.broken = True
        for _ in range(3):
            self.beat()
        self.assertEqual(self.hold()["until"], t0 + 60)
        self.assertEqual(self.out.getvalue().count("sign-in time not readable"), 1)
        self.assertNotIn("KeyError", self.out.getvalue())
        self.w.broken = False
        self.w.clock += 10
        self.beat()
        self.assertEqual(self.hold()["until"], t0 + 70)
        self.w.broken = True
        self.beat()
        self.assertEqual(self.out.getvalue().count("sign-in time not readable"), 2)


class PlanWeek(unittest.TestCase):
    beat, state, hold = Renewal.beat, Renewal.state, Renewal.hold

    def make(self, used, days_left=None):
        Renewal.make(self, [issue(5)])
        resets = "2099-01-01T00:00:00.000Z" if days_left is None else datetime.datetime.fromtimestamp(self.w.clock + days_left * 86400, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        self.w.sign_in = {"minutesLeft": 400, "renewalDue": False}
        self.d.cfg["plan_week_hold_percent"] = 95
        inner = self.d.account

        def account(tool, args, timeout=30):
            got = inner(tool, args)
            if tool == "list_ai_connections":
                got["connections"][0]["planLimits"] = {"windows": [{"kind": "weekly", "label": None, "usedPercent": used, "resetsAt": resets}]}
            return got

        self.d.account = account

    def test_a_plan_week_at_the_hold_mark_stops_new_sends_and_says_so_once(self):
        self.make(96)
        self.beat()
        self.w.clock += 30
        self.beat()
        self.assertEqual(len(self.w.sends), 0)
        self.assertEqual(self.hold()["kind"], "plan week")
        self.assertEqual(self.out.getvalue().count("plan week is 96 % used"), 1)

    def test_a_plan_week_under_the_hold_mark_sends(self):
        self.make(94)
        self.beat()
        self.assertEqual((self.state(5), len(self.w.sends)), ("building", 1))
        self.assertIsNone(self.hold())

    def ahead(self, used, days_left, slots=15):
        self.make(used, days_left)
        self.d.cfg["slots"] = slots
        self.beat()
        return self.d.slot_quotas()

    def test_ahead_of_the_week_the_line_runs_on_fewer_slots_and_says_so_once(self):
        self.ahead(68, 7 * 0.694)
        self.assertEqual(self.d.pace_slots(15), 6)
        self.w.clock += 30
        self.beat()
        self.assertEqual(self.out.getvalue().count("pacing the plan week"), 1)
        self.assertIsNone(self.hold())

    def test_on_pace_the_line_keeps_every_slot(self):
        self.ahead(30, 3.5)
        self.assertEqual(self.d.pace_slots(15), 15)
        self.assertNotIn("pacing the plan week", self.out.getvalue())

    def test_pacing_never_takes_the_last_slot(self):
        self.ahead(94, 6.9)
        self.assertEqual(self.d.pace_slots(15), 1)

    def test_an_unreadable_reading_lifts_the_pacing(self):
        self.ahead(68, 7 * 0.694)
        self.assertLess(self.d.pace, 1)
        self.w.broken = True
        self.w.clock += 30
        self.beat()
        self.assertEqual(self.d.pace_slots(15), 15)

    def test_without_slots_set_nothing_is_paced_or_logged(self):
        self.ahead(68, 7 * 0.694, slots=0)
        self.assertIsNone(self.d.slot_quotas())
        self.assertNotIn("pacing the plan week", self.out.getvalue())


if __name__ == "__main__":
    unittest.main()
