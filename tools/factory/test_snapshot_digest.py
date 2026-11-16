import json, os, re, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import snapshot
import store as ledger_store

CONTRACT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "packages", "contracts", "src", "factory-snapshot.ts")
NOW = 1794000000.0
CFG = {"repo": "o/r", "builders": [{"id": "b1", "name": "CODE", "runs": 2}], "reviewers": [{"id": "r1", "name": "LINUS"}]}


class SnapshotDigest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def put(self, n, state):
        self.st.put_job(str(n), state, {"issue": n, "title": "T%d" % n, "body": "**Depends on**: none\n"}, None)

    def test_the_snapshot_carries_the_digest_of_its_store(self):
        self.put(1, "queued")
        self.put(2, "merged")
        snap = snapshot.build_snapshot(self.st, CFG, NOW, None, beat=1)
        self.assertEqual(snap["digest"], digest.build(self.st, CFG, NOW))
        self.assertEqual(set(snap["digest"]), {"stations", "threads", "anomalies", "measures", "planners"})

    def test_an_empty_store_digest_is_valid_and_serialisable(self):
        d = snapshot.build_snapshot(self.st, CFG, NOW, None, beat=1)["digest"]
        json.dumps(d)
        self.assertEqual(len(d["stations"]), 4)
        self.assertEqual(d["threads"], [])
        self.assertEqual(d["anomalies"], [])
        self.assertTrue(all(v == 0 for v in d["measures"]["blocks"].values()))

    def test_digest_keys_match_the_contract(self):
        text = open(CONTRACT).read()
        start = text.index("export const factoryDigestSchema")
        block = text[start:text.index("export const factorySnapshotSchema")]
        d = digest.build(self.st, CFG, NOW)
        for key in list(d) + list(d["stations"][0]):
            self.assertTrue(re.search(r"\b%s\b" % key, block), key)
