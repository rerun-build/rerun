import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, ready


class ReplanCount(Base):
    def data(self):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])

    def returned_with(self, replans):
        self.tick()
        self.w.finish("b1", "BLOCKED: plan: wrong")
        self.tick()
        self.assertEqual(self.state(), "returned")
        job = self.d.store.get_job("5")
        job["replans"] = replans
        self.d.save(job)
        self.w.unlabelled.clear()

    def test_a_job_taken_again_keeps_its_replan_count(self):
        self.returned_with(1)
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertEqual(self.data()["replans"], 1)

    def test_a_job_that_waits_again_keeps_it_too(self):
        self.returned_with(2)
        self.w.issue(5)["body"] = ready("intro", "#7")
        self.w.open_numbers.add(7)
        self.tick()
        self.assertEqual(self.state(), "waiting")
        self.assertEqual(self.data()["replans"], 2)

    def test_a_job_never_replanned_has_no_count(self):
        self.returned_with(0)
        self.tick()
        self.assertNotIn("replans", self.data())


if __name__ == "__main__":
    unittest.main()
