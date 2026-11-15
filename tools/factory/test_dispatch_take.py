import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base

NEW = "This job was taken before and returned"


class Take(Base):
    def data(self):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])

    def take_again(self):
        self.w.finish("b1", "BLOCKED: cannot")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.w.unlabelled.clear()
        self.tick()

    def test_the_first_take_has_no_take_and_no_new_worktree_line(self):
        self.tick()
        self.assertNotIn("take", self.data())
        self.assertNotIn(NEW, self.w.sends[0][1])

    def test_a_job_taken_again_counts_the_take_and_names_a_new_worktree(self):
        self.tick()
        self.take_again()
        self.assertEqual(self.data()["take"], 2)
        self.assertIn(NEW, self.w.sends[-1][1])
        self.assertIn("/data/tools/bin/wt new rerun 5 a2", self.w.sends[-1][1])

    def test_a_third_take_is_a3(self):
        self.tick()
        self.take_again()
        self.take_again()
        self.assertEqual(self.data()["take"], 3)
        self.assertIn("/data/tools/bin/wt new rerun 5 a3", self.w.sends[-1][1])


if __name__ == "__main__":
    unittest.main()
