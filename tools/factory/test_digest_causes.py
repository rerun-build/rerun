import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store

NOW = limits.ts("2026-11-16T12:00:00Z")
BODY = "**Depends on**: none\n"
RECENT = "2026-11-15T10:00:00Z"
OLD = "2026-11-08T10:00:00Z"


class Causes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def job(self, n, at):
        self.st.put_job(str(n), "merged", {"issue": n, "title": "T", "body": BODY}, "r", at=at)

    def test_an_empty_ledger_has_no_groups_and_no_changes(self):
        self.assertEqual(digest.causes(self.st, NOW), {"groups": [], "changes": []})

    def test_groups_of_the_last_seven_days_with_their_count_rate_and_state(self):
        for n in range(1, 11):
            self.job(n, "2026-11-14T%02d:00:00Z" % n)
        for n in (1, 2, 3):
            self.st.add_failure("fix round", str(n), station="review", at=RECENT)
        self.st.add_failure("ended blocked", "4", station="build", at=RECENT)
        self.st.add_failure("ended blocked", "5", station="build", at=OLD)
        out = digest.causes(self.st, NOW)
        self.assertEqual(out["groups"], [
            {"group": "fix round @ review", "events": 3, "rate": 6.0, "state": "open"},
            {"group": "ended blocked @ build", "events": 1, "rate": 4.0, "state": "open"},
        ])

    def test_a_group_with_a_change_being_measured_is_changed_and_a_kept_one_is_kept(self):
        self.st.add_failure("ended blocked", "6", station="build", at=RECENT)
        self.st.add_failure("fix round", "7", station="review", at=RECENT)
        self.st.add_failure("rework", "8", station="proof", at=RECENT)
        self.st.add_change(201, "ended blocked @ build", "prompt", 4.0)
        kept = self.st.add_change(202, "fix round @ review", "tool", 6.0)
        self.st.set_change(kept, verdict="kept", after=2.0)
        reverted = self.st.add_change(203, "rework @ proof", "tool", 3.0)
        self.st.set_change(reverted, verdict="revert", revert=1, after=5.0)
        out = digest.causes(self.st, NOW)
        self.assertEqual([(g["group"], g["state"]) for g in out["groups"]], [
            ("ended blocked @ build", "changed"),
            ("fix round @ review", "kept"),
            ("rework @ proof", "open"),
        ])
        self.assertEqual(out["changes"], [
            {"issue": 201, "group": "ended blocked @ build", "kind": "prompt", "before": 4.0, "after": None,
             "verdict": None, "revert": None},
            {"issue": 202, "group": "fix round @ review", "kind": "tool", "before": 6.0, "after": 2.0,
             "verdict": "kept", "revert": None},
            {"issue": 203, "group": "rework @ proof", "kind": "tool", "before": 3.0, "after": 5.0,
             "verdict": "revert", "revert": 1},
        ])

    def test_at_most_twenty_groups_and_the_twenty_latest_changes(self):
        for i in range(25):
            for _ in range(i + 1):
                self.st.add_failure("k%02d" % i, "1", station="s", at=RECENT)
            self.st.add_change(300 + i, "k%02d @ s" % i, "prompt", 1.0)
        out = digest.causes(self.st, NOW)
        self.assertEqual([g["group"] for g in out["groups"]], ["k%02d @ s" % i for i in range(24, 4, -1)])
        self.assertEqual(out["groups"][0]["events"], 25)
        self.assertEqual(len(out["changes"]), 20)
        self.assertEqual([c["issue"] for c in out["changes"]], list(range(305, 325)))


if __name__ == "__main__":
    unittest.main()
