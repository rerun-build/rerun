import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base


def job_issue(n):
    return {
        "number": n,
        "title": "t%d" % n,
        "body": "**Depends on**: none\n**Worker**: coder\n**Files**\n- `a/b%d.py`\n- `a/test_b%d.py`\n**Test file**: `a/test_b%d.py`\n" % (n, n, n),
        "comments": [],
    }


class Outage(Base):
    def setUp(self):
        super().setUp()
        self.w.issues = [job_issue(5), job_issue(6)]

    def test_a_pass_where_every_job_fails_counts_for_no_job(self):
        self.tick()
        self.assertEqual((self.state(5), self.state(6)), ("building", "building"))
        self.w.runs.clear()
        self.tick(20)
        self.w.clock += D.FAIL_AFTER_S
        self.tick(5)
        for n in ("5", "6"):
            j = self.d.store.get_job(n)
            self.assertEqual(j["state"], "building")
            self.assertEqual(j.get("errors", 0), 0)
            self.assertNotIn("failing_since", j)
            self.assertNotIn("last_error", j)
        self.assertIn("pass outage: 2 jobs failed, counters kept", self.out.getvalue())

    def test_one_failing_job_among_clean_ones_still_ends_after_20(self):
        self.tick()
        rid5 = next(r for r, a in self.w.order if a == self.d.store.get_job("5")["agent"])
        del self.w.runs[rid5]
        self.tick(19)
        self.w.clock += D.FAIL_AFTER_S
        self.tick()
        j5 = self.d.store.get_job("5")
        j6 = self.d.store.get_job("6")
        self.assertEqual(j5["state"], "failed")
        self.assertEqual(j5["reason"], "20 passes in a row failed in state building: KeyError")
        self.assertEqual(j6["state"], "building")

    def test_outage_pass_preserves_prior_failure_counters(self):
        self.tick()
        rid5 = next(r for r, a in self.w.order if a == self.d.store.get_job("5")["agent"])
        rid6 = next(r for r, a in self.w.order if a == self.d.store.get_job("6")["agent"])
        saved6 = self.w.runs.pop(rid6)
        self.w.runs[rid6] = saved6
        del self.w.runs[rid5]
        t_first = self.w.clock
        self.tick(3)
        j5_before = self.d.store.get_job("5")
        self.assertEqual((j5_before["errors"], j5_before["failing_since"], j5_before["last_error"]), (3, t_first, "KeyError"))
        self.w.clock += 60
        del self.w.runs[rid6]
        self.tick(2)
        j5_after = self.d.store.get_job("5")
        j6_after = self.d.store.get_job("6")
        self.assertEqual((j5_after["errors"], j5_after["failing_since"], j5_after["last_error"]), (3, t_first, "KeyError"))
        self.assertEqual(j6_after.get("errors", 0), 0)
        self.assertNotIn("failing_since", j6_after)
        self.assertNotIn("last_error", j6_after)


if __name__ == "__main__":
    unittest.main()
