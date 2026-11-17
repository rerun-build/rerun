import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import renewal
import snapshot
import store as ledger_store
from test_dispatch_renewal import Renewal, issue

NOW = 1794000000.0
LATER = "2026-12-01T10:00:00.000Z"
EARLIER = "2026-11-01T10:00:00.000Z"
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}
SIGN_IN = {"minutesLeft": 412.6, "renewalDue": False}


def week(used, resets):
    return {"kind": "weekly", "label": None, "usedPercent": used, "resetsAt": resets}


def answer(windows, sign_in=SIGN_IN):
    return {"connections": [{"id": "c0", "isDefault": False, "planLimits": {"windows": [week(99, LATER)]}, "signIn": None},
                            {"id": "c1", "isDefault": True, "planLimits": {"windows": windows}, "signIn": sign_in}]}


class Plan(unittest.TestCase):
    def test_reads_the_weekly_window_and_the_sign_in_of_the_default_connection(self):
        got = renewal.plan(answer([{"kind": "session", "usedPercent": 7, "resetsAt": LATER}, week(56, LATER)]), NOW)
        self.assertEqual(got, {"weekUsedPercent": 56, "weekResetsAt": "2026-12-01T10:00:00Z", "signInMinutes": 412})

    def test_a_weekly_window_that_has_reset_counts_as_unused(self):
        self.assertEqual(renewal.plan(answer([week(88, EARLIER)]), NOW), {"weekUsedPercent": 0, "weekResetsAt": None, "signInMinutes": 412})

    def test_no_weekly_window_keeps_the_sign_in(self):
        got = renewal.plan(answer([{"kind": "session", "usedPercent": 7, "resetsAt": LATER}]), NOW)
        self.assertEqual(got, {"weekUsedPercent": None, "weekResetsAt": None, "signInMinutes": 412})

    def test_an_answer_with_nothing_to_read_gives_none(self):
        for bad in (None, "x", {"connections": []}, {"connections": [{"id": "c0", "isDefault": False, "planLimits": {"windows": [week(9, LATER)]}}]},
                    answer([], sign_in=None), {"connections": [{"id": "c1", "isDefault": True, "planLimits": None, "signIn": None}]}):
            self.assertIsNone(renewal.plan(bad, NOW), bad)

    def test_the_snapshot_carries_the_plan_only_when_there_is_one(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(st.db.close)
        plan = {"weekUsedPercent": 56, "weekResetsAt": "2026-12-01T10:00:00Z", "signInMinutes": 412}
        self.assertEqual(snapshot.build_snapshot(st, CFG, NOW, None, plan=plan)["plan"], plan)
        self.assertNotIn("plan", snapshot.build_snapshot(st, CFG, NOW, None))


class Beat(unittest.TestCase):
    beat, state = Renewal.beat, Renewal.state

    def make(self, issues):
        Renewal.make(self, issues)
        self.reports, inner = [], self.d.account

        def account(tool, args, timeout=30):
            if tool == "factory_report":
                self.reports.append(args["snapshot"])
                return {}
            got = inner(tool, args)
            if tool == "list_ai_connections":
                got["connections"][0]["planLimits"] = {"windows": [week(41, "2099-01-01T00:00:00.000Z")]}
            return got

        self.d.account = account

    def test_a_beat_hands_the_plan_to_the_snapshot(self):
        self.make([issue(5)])
        self.beat()
        self.assertEqual(self.reports[-1]["plan"], {"weekUsedPercent": 41, "weekResetsAt": "2099-01-01T00:00:00Z", "signInMinutes": 120})

    def test_a_beat_whose_connections_cannot_be_read_hands_no_plan_and_goes_on(self):
        self.make([issue(5)])
        self.w.broken = True
        self.beat()
        self.assertNotIn("plan", self.reports[-1])
        self.assertEqual(self.state(5), "building")


if __name__ == "__main__":
    unittest.main()
