import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import store as ledger_store


class Threads(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state, parent, deps):
        body = "**Depends on**: %s\n" % deps
        if parent:
            body = "**Part of**: #%d\n" % parent + body
        self.st.put_job(str(n), state, {"issue": n, "title": "T", "body": body}, "r", at="2026-11-15T10:00:00Z")

    def test_threads_count_chain_and_blockers(self):
        self.put(11, "merged", 100, "none")
        self.put(12, "building", 100, "#11")
        self.put(13, "queued", 100, "#12")
        self.put(14, "blocked", 100, "#12")
        self.put(15, "waiting", 100, "#13, #14")
        self.put(21, "merged", 200, "none")
        self.put(41, "queued", 300, "none")
        self.put(31, "queued", None, "none")
        self.assertEqual(digest.threads(self.st), [
            {"parent": 100, "done": 1, "total": 5, "chain": 3, "blockedBy": [14]},
            {"parent": 300, "done": 0, "total": 1, "chain": 1, "blockedBy": []}])

    def test_a_dependency_cycle_does_not_loop(self):
        self.put(1, "queued", 7, "#2")
        self.put(2, "queued", 7, "#1")
        self.assertEqual(digest.threads(self.st)[0]["chain"], 2)

    def test_more_than_fifty_threads_keep_the_highest_parents(self):
        for p in range(1, 52):
            self.put(1000 + p, "queued", p, "none")
        out = digest.threads(self.st)
        self.assertEqual(len(out), 50)
        self.assertEqual(out[0]["parent"], 2)


if __name__ == "__main__":
    unittest.main()
