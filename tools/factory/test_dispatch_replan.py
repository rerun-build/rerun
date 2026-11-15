import json, os, sys, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base


class Replan(Base):
    def setUp(self):
        super().setUp()
        self.cfg["types"] = {
            "coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
            "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]},
            "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}, {"id": "p2", "name": "IKE", "runs": 1}]},
        }

    def data(self):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])

    def planner_sends(self, agent=None):
        return [s for s in self.w.sends if s[0] in (("p1", "p2") if agent is None else (agent,))]

    def block(self, text="BLOCKED: plan: a file outside its paths"):
        self.tick()
        self.w.finish("b1", text)
        self.tick()

    def test_a_plan_return_goes_to_the_first_planner_with_the_reason(self):
        self.block()
        self.assertEqual(self.state(), "returned")
        sent = self.planner_sends()
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], "p1")
        for part in ("a file outside its paths", "Re-plan 1 of 2", "**Corrections**", "--add-label factory --remove-label factory-blocked"):
            self.assertIn(part, sent[0][1])
        self.assertEqual(self.data()["replans"], 1)

    def test_an_ordinary_block_is_not_replanned(self):
        self.block("BLOCKED: cannot write the file")
        self.assertEqual(self.state(), "blocked")
        self.assertEqual(self.planner_sends(), [])

    def test_at_most_two_replans_then_it_stays_returned(self):
        self.block()
        self.w.unlabelled.clear()
        self.block()
        self.w.unlabelled.clear()
        self.block()
        self.assertEqual(self.state(), "returned")
        self.assertEqual(len(self.planner_sends("p1")), 2)
        self.assertEqual(self.planner_sends("p2"), [])
        self.assertEqual(self.data()["replans"], 2)
        self.tick(3)
        self.assertEqual(len(self.planner_sends()), 2)

    def test_a_send_that_raised_is_not_counted_and_is_tried_again(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: plan: a file outside its paths")
        self.w.cut_off_next_send = False
        original = self.w.account

        def cut(tool, args):
            if tool == "send_message" and args["agentId"] == "p1" and not getattr(self, "cut_done", False):
                self.cut_done = True
                self.w.cut_off_next_send = True
            return original(tool, args)

        self.w.account = cut
        self.d = None
        self.tick(fresh=True)
        self.assertNotIn("replans", self.data())
        self.tick()
        self.assertEqual(self.data()["replans"], 1)
        self.assertEqual(len(self.planner_sends()), 2)

    def test_a_re_plan_never_goes_to_a_planner_without_issue_access(self):
        self.tick()
        self.w.finish("b1", "BLOCKED: plan: a file outside its paths")
        with unittest.mock.patch.object(D.Dispatcher, "running", return_value=[("p1", 1)]):
            self.tick(2)
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.planner_sends(), [])
        self.assertNotIn("replans", self.data())
        self.tick()
        self.assertEqual([s[0] for s in self.planner_sends()], ["p1"])
        self.assertEqual(self.data()["replans"], 1)


if __name__ == "__main__":
    unittest.main()
