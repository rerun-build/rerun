import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits
import store as ledger_store

NOW = limits.ts("2026-11-15T12:00:00Z")
BODY = "**Depends on**: none\n"


def zero(name, service=None):
    return {"station": name, "queue": 0, "oldestWaitS": 0, "serviceS": service, "inUse": 0}


class Stations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, hhmmss):
        self.st.put_job(str(n), state, {"issue": n, "title": "T", "body": BODY}, "r", at="2026-11-15T%sZ" % hhmmss)

    def test_stations_measure_queue_wait_service_and_use(self):
        self.put(1, "queued", "11:30:00")
        self.put(2, "queued", "11:50:00")
        self.put(3, "queued", "11:00:00")
        self.put(3, "building", "11:55:00")
        self.put(4, "queued", "10:00:00")
        self.put(4, "building", "10:30:00")
        self.put(4, "review_wait", "10:50:00")
        self.put(5, "queued", "11:00:00")
        self.put(5, "building", "11:00:00")
        self.put(5, "review_wait", "11:10:00")
        self.put(6, "queued", "08:00:00")
        self.put(6, "building", "08:00:00")
        self.put(6, "review_wait", "08:30:00")
        self.assertEqual(digest.stations(self.st, NOW), [
            {"station": "build", "queue": 2, "oldestWaitS": 1800, "serviceS": 900.0, "inUse": 1},
            {"station": "review", "queue": 3, "oldestWaitS": 12600, "serviceS": None, "inUse": 0},
            zero("fix"),
            zero("proof"),
        ])

    def test_an_empty_store_gives_four_stations_with_zeros(self):
        self.assertEqual(digest.stations(self.st, NOW), [zero("build"), zero("review"), zero("fix"), zero("proof")])

    def test_a_job_with_one_transition_waits_from_its_updated_at(self):
        self.put(9, "queued", "11:00:00")
        self.assertEqual(digest.stations(self.st, NOW)[0]["oldestWaitS"], 3600)


if __name__ == "__main__":
    unittest.main()
