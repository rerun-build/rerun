import os, re, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store as S


class TestStoreEvents(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.p = os.path.join(self.d.name, "ledger.db")
        self.s = S.Store(self.p)

    def tearDown(self):
        self.s.close()
        self.d.cleanup()

    def test_an_event_keeps_key_from_to_and_when_in_order(self):
        self.assertEqual(self.s.events(), [])
        self.s.add_event("copies.code", 6, 4, at="2026-11-15T10:00:00Z")
        self.s.add_event("wip.building", None, 8, at="2026-11-15T10:05:00Z")
        self.assertEqual(self.s.events(), [
            {"at": "2026-11-15T10:00:00Z", "key": "copies.code", "from": 6, "to": 4},
            {"at": "2026-11-15T10:05:00Z", "key": "wip.building", "from": None, "to": 8},
        ])

    def test_events_survive_a_reopen_and_the_time_defaults_to_now(self):
        self.s.add_event("copies.code", 6, 4)
        self.s.close()
        self.s = S.Store(self.p)
        got = self.s.events()
        self.assertEqual(len(got), 1)
        self.assertRegex(got[0]["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual((got[0]["key"], got[0]["from"], got[0]["to"]), ("copies.code", 6, 4))


if __name__ == "__main__":
    unittest.main()
