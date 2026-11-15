import os, tempfile, unittest
import store


class Lease(unittest.TestCase):
    def setUp(self):
        self.s = store.Store(os.path.join(tempfile.mkdtemp(), "s.db"))

    def tearDown(self):
        self.s.close()

    def test_grant_and_open(self):
        a = self.s.grant_lease("j", "A", ["x.py"], "2026-01-01T00:10:00Z", attempt=1, at="2026-01-01T00:00:00Z")
        self.assertEqual([l["id"] for l in self.s.open_leases()], [a])
        self.assertEqual(self.s.open_leases()[0]["paths"], ["x.py"])
        self.s.close_lease(a, "result", at="2026-01-01T00:05:00Z")
        self.assertEqual(self.s.open_leases(), [])
        self.s.close_lease(a, "cancel")
        self.assertEqual(self.s.get_lease(a)["reason"], "result")

    def test_expiry_closes_lease(self):
        a = self.s.grant_lease("j", "A", ["x.py"], "2026-01-01T00:10:00Z")
        b = self.s.grant_lease("j", "B", ["y.py"], "2026-01-01T00:30:00Z")
        self.assertEqual([l["id"] for l in self.s.expire_leases("2026-01-01T00:20:00Z")], [a])
        self.assertEqual([l["id"] for l in self.s.open_leases()], [b])
        self.assertEqual(self.s.get_lease(a)["reason"], "expired")
        self.assertEqual(self.s.expire_leases("2026-01-01T00:20:00Z"), [])


if __name__ == "__main__":
    unittest.main()
