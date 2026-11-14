import unittest
import readyq


def item(chunk, job="j", **kw):
    return dict({"job": job, "chunk": chunk, "paths": [chunk + ".py"], "deps": [], "attempts": 0}, **kw)


class Eligible(unittest.TestCase):
    def test_two_chunks_and_one_stage_fill_3_slots_fourth_refused(self):
        st = {"busy": [("j", "A")], "stages": 1, "cfg": {"builder_capacity": 3, "per_job_cap": 2}}
        self.assertEqual(readyq.eligible(item("B"), st), (True, None))
        st["busy"].append(("k", "B"))
        self.assertEqual(readyq.eligible(item("C"), st), (False, "no free slot"))

    def test_deps_cap_lease_attempts_fire_cap(self):
        st = {"busy": [("j", "A"), ("j", "B")], "cfg": {"builder_capacity": 5, "per_job_cap": 2}}
        self.assertEqual(readyq.eligible(item("C"), st)[1], "job at its per-job cap")
        self.assertEqual(readyq.eligible(item("C", job="k", deps=["X"]), st)[1], "dependencies not merged")
        st["merged"] = {"X"}
        st["leases"] = [{"paths": ["C.py"]}]
        self.assertEqual(readyq.eligible(item("C", job="k", deps=["X"]), st)[1], "paths under an open lease")
        st["leases"] = []
        self.assertEqual(readyq.eligible(item("C", job="k", attempts=2), st)[1], "attempts used")
        st["fired"] = 20
        self.assertEqual(readyq.eligible(item("C", job="k"), st)[1], "job hit the fire cap")


if __name__ == "__main__":
    unittest.main()
