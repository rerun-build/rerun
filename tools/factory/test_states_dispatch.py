import ast, os, re, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import states
import test_dispatch as TD


def step_tree():
    with open(D.__file__, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Dispatcher":
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name == "step":
                    return item
    raise AssertionError("no Dispatcher.step")


class StatesDispatch(unittest.TestCase):
    def test_lists_are_the_objects_of_states(self):
        self.assertIs(D.RUNNING, states.RUNNING)
        self.assertIs(D.END, states.END)
        self.assertIs(D.WAIT_STATES, states.WAIT_STATES)
        self.assertIs(D.BACK, states.BACK)
        self.assertIs(D.GOALS, states.GOALS)

    def test_step_compares_with_no_literal_tuple(self):
        tuples = [n for n in ast.walk(step_tree()) if isinstance(n, ast.Compare)
                  and any(isinstance(c, ast.Tuple) for c in n.comparators)]
        self.assertEqual(tuples, [])

    def test_goals_and_back_cover_every_running_state(self):
        self.assertEqual(sorted(D.GOALS), sorted(states.RUNNING))
        self.assertEqual(sorted(D.BACK), sorted(states.RUNNING))
        self.assertEqual(D.GOALS["reviewing"], [{"prefix": "VERDICT: ", "rest": "sentence"}])
        self.assertEqual(D.BACK["fixing"], "fix_wait")


class Beat(TD.Base):
    def test_heartbeat_line_counts_every_stage_of_the_table(self):
        self.tick()
        line = open(self.cfg["heartbeat_file"], encoding="utf-8").read().strip()
        counted = line.split(" | ")[1]
        names = [part.rsplit(" ", 1)[0] for part in counted.split(", ")]
        self.assertEqual(names, list(states.STAGES))


if __name__ == "__main__":
    unittest.main()
