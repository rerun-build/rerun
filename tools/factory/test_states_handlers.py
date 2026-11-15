import ast, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import snapshot
import states
import store
import timeline
import waits
from test_states_dispatch import step_tree


def compared_states():
    found = set()
    for node in ast.walk(step_tree()):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name) and node.left.id == "st"
                and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq)
                and isinstance(node.comparators[0], ast.Constant)):
            found.add(node.comparators[0].value)
    return found


class StatesHandlers(unittest.TestCase):
    def test_every_step_state_has_a_branch(self):
        wanted = {s for s in states.NAMES if states.TABLE[s]["handler"] == "step"}
        self.assertEqual(sorted(wanted - compared_states()), [])
        self.assertEqual([s for s in states.NAMES if states.TABLE[s]["handler"] == "intake"], ["waiting"])

    def test_the_proof_states_are_known_everywhere(self):
        for s in ("proof_wait", "proving"):
            for where in (D.RUNNING + D.WAIT_STATES, snapshot.RUNNING + snapshot.WAIT_STATES, store.JOB_STATES, states.STAGES):
                self.assertIn(s, where)
        self.assertIn("proving", D.RUNNING)
        self.assertIn("proving", snapshot.RUNNING)
        self.assertIn("proof_wait", D.WAIT_STATES)
        self.assertIn("proof_wait", snapshot.WAIT_STATES)
        self.assertEqual(waits.reason({"state": "proof_wait"}, 1), "no free worker of its type")
        self.assertIs(timeline.END, states.END)


if __name__ == "__main__":
    unittest.main()
