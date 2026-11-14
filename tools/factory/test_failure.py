import os, tempfile, unittest

import limits, store


class Failure(unittest.TestCase):
    def test_retry_then_escalate_count_survives_restart(self):
        p = os.path.join(tempfile.mkdtemp(), "s.db")
        s = store.Store(p)
        self.assertEqual(limits.failure(s.attempts("j", "A"), {"retries": 1})[0], "RETRY")
        s.bump_attempt("j", "A")
        s.close()
        s = store.Store(p)
        act, why = limits.failure(s.attempts("j", "A"), {"retries": 1}, "boom")
        self.assertEqual(act, "NEEDS_BOSS")
        self.assertIn("boom", why)
        self.assertEqual(limits.failure(1, {"retries": 2})[0], "RETRY")
        self.assertEqual(limits.failure(1, {})[0], "NEEDS_BOSS")
