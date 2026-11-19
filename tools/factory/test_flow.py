import os, sys, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutshape
import flow
import store
import test_dispatch

TODAY = store.now()[:10]
DONE_AT = TODAY + "T00:00:00Z"


class Flow(unittest.TestCase):
    def test_types_and_features_of_a_mixed_ledger(self):
        jobs = [
            {"issue": 5, "state": "building", "worker": "coder", "body": "**Part of**: #9"},
            {"issue": 6, "state": "review_wait", "body": "**Part of**: #9"},
            {"issue": 7, "state": "merged", "updated_at": DONE_AT, "body": "**Part of**: #9"},
            {"issue": 8, "state": "waiting", "worker": "researcher"},
        ]
        self.assertEqual(flow.beat_text(jobs, {}, TODAY),
                         "by type: coder ready 0 running 1 waiting 0, reviewer ready 1 running 0 waiting 0, "
                         "researcher ready 0 running 0 waiting 1, designer ready 0 running 0 waiting 0, security ready 0 running 0 waiting 0, data ready 0 running 0 waiting 0, contracts ready 0 running 0 waiting 0 "
                         "| features: #9 1/3 convergence waiting")

    def test_convergence_passed_and_due(self):
        jobs = [{"issue": n, "state": "merged", "updated_at": DONE_AT, "body": "**Part of**: #9"} for n in (1, 2, 3)]
        self.assertTrue(flow.beat_text(jobs, {9: "accepted"}, TODAY).endswith("features: #9 3/3 convergence passed"))
        self.assertTrue(flow.beat_text(jobs, {}, TODAY).endswith("features: #9 3/3 convergence due"))

    def test_no_jobs(self):
        empty_types = ("by type: coder ready 0 running 0 waiting 0, reviewer ready 0 running 0 waiting 0, "
                       "researcher ready 0 running 0 waiting 0, designer ready 0 running 0 waiting 0, security ready 0 running 0 waiting 0, data ready 0 running 0 waiting 0, contracts ready 0 running 0 waiting 0")
        self.assertEqual(flow.beat_text([], {}, TODAY), empty_types + " | features: none")
        self.assertEqual(flow.by_type([]), {t: {"ready": 0, "running": 0, "waiting": 0}
                                            for t in ("coder", "reviewer", "researcher", "designer", "security", "data", "contracts")})
        self.assertEqual(flow.by_feature([], {}, TODAY), [])

    def test_an_odd_record_counts_without_an_error(self):
        jobs = [{"issue": "plan:3", "state": "queued", "body": None, "worker": "x"}]
        self.assertEqual(flow.by_type(jobs)["coder"], {"ready": 1, "running": 0, "waiting": 0})
        self.assertEqual(flow.by_feature(jobs, {}, TODAY), [])

    def test_bodies_are_parsed_once_and_ten_features_show(self):
        jobs = [{"issue": 1000 + i, "state": "queued", "body": "**Part of**: #%d" % (100 + i)} for i in range(50)]
        with unittest.mock.patch.object(cutshape, "parse", wraps=cutshape.parse) as parse:
            flow.by_feature(jobs, {}, TODAY)
            flow.by_feature(jobs, {}, TODAY)
        self.assertEqual(parse.call_count, 50)
        self.assertTrue(flow.beat_text(jobs, {}, TODAY).endswith("#109 0/1 convergence waiting, +40 more"))


class Beat(test_dispatch.Base):
    def test_the_beat_line_carries_the_new_segments_in_the_middle(self):
        self.tick()
        parts = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip().split(" | ")
        self.assertEqual(len(parts), 7)
        self.assertTrue(parts[3].startswith("by type: coder "))
        self.assertEqual(parts[4], "features: none")

    def test_counting_that_raises_writes_unreadable_and_the_beat_goes_on(self):
        self.tick()
        self.d.store.put_job("6", "waiting", {"issue": 6, "body": 5, "relabelled": True})
        self.tick()
        parts = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip().split(" | ")
        self.assertTrue(parts[0].endswith("beat 2"))
        self.assertEqual(parts[3], "by type: unreadable")
        self.assertEqual(parts[4], "features: unreadable")
        self.assertIn("heartbeat counts: AttributeError", self.out.getvalue())
