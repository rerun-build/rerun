import os, tempfile, unittest
import store


class LeaseGrant(unittest.TestCase):
    def setUp(self):
        self.p = os.path.join(tempfile.mkdtemp(), "s.db")
        self.s = store.Store(self.p)

    def test_crash_after_fire_blocks_overlap(self):
        q = self.s.enqueue("j", "build", chunk="A")
        self.s.dequeue_to_intent(q, "j", "A", "build", lease_paths=["x.py"], lease_expires="2026-01-01T00:10:00Z")
        self.s.close()
        self.s = store.Store(self.p)
        self.assertEqual([l["paths"] for l in self.s.open_leases()], [["x.py"]])
        self.assertEqual(self.s.expire_leases("2026-01-01T01:00:00Z"), [])
        self.assertEqual(len(self.s.open_leases()), 1)
        self.s.abandon(self.s.pending()[0]["id"])
        self.assertEqual(len(self.s.expire_leases("2026-01-01T01:00:00Z")), 1)


if __name__ == "__main__":
    unittest.main()
