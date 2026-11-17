import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import store as ledger_store
from test_dispatch import Base
from test_classify_beat import LONG

NOW = 1794000000.0
MIDNIGHT = NOW - NOW % 86400
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}
ZERO = {"P0": 0, "P1": 0, "P2": 0, "P3": 0, "none": 0}


class Issues(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def test_an_empty_ledger_counts_zero(self):
        self.assertEqual(digest.build(self.st, CFG, NOW)["issues"],
                         {"open": ZERO, "classifiedToday": 0, "joinedToday": 0})

    def test_an_unreadable_count_is_zero(self):
        self.st.set("-", "issues_open", "not json")
        self.assertEqual(digest.issues(self.st, NOW)["open"], ZERO)

    def test_today_counts_only_since_midnight_utc(self):
        self.st.set("classify:1", "at", int(MIDNIGHT - 5))
        self.st.set("classify:2", "at", int(MIDNIGHT + 5))
        self.st.set("classify:2", "joined", int(MIDNIGHT + 5))
        self.st.set("classify:3", "at", int(NOW))
        self.st.set("-", "issues_open", '{"P0": 1, "P1": 2, "P2": 0, "P3": 0, "none": 1}')
        got = digest.issues(self.st, NOW)
        self.assertEqual(got["classifiedToday"], 2)
        self.assertEqual(got["joinedToday"], 1)
        self.assertEqual(got["open"], {"P0": 1, "P1": 2, "P2": 0, "P3": 0, "none": 1})


class Beat(Base):
    def setUp(self):
        super().setUp()
        self.cfg["classify"] = {"on": True}
        self.w.issues = []

    def seed(self, n, title, labels=()):
        self.w.problems.append({"number": n, "title": title, "body": LONG, "comments": [],
                                "labels": list(labels), "state": "OPEN"})

    def test_the_beat_keeps_the_open_count_by_priority(self):
        self.seed(50, "Zeta thing", labels=["P0"])
        self.seed(51, "Eta thing", labels=["P1", "bug"])
        self.seed(52, "Theta thing", labels=["P1"])
        self.seed(53, "Iota thing", labels=["factory"])
        self.tick()
        self.assertEqual(self.d.store.get_all("-")["issues_open"],
                         '{"P0": 1, "P1": 2, "P2": 0, "P3": 0, "none": 1}')


if __name__ == "__main__":
    unittest.main()
