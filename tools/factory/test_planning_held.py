import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
import test_planning_start as T
from test_planning_pick import issue


class HeldFirst(unittest.TestCase):
    def test_a_child_the_checks_refused_is_planned_before_token_work(self):
        got = planning.unplanned([issue(1, ["P0", planning.TOKENS], "2026-11-01"), issue(2, ["P1"], "2026-11-02"),
                                  issue(3, ["P2"], "2026-11-03")], first={3})
        self.assertEqual([i["number"] for i in got], [3, 1, 2])

    def test_the_cut_shape_keeps_the_refused_children(self):
        r = T.Rig()
        r.store.set("plan:40", "state", "cut")
        r.station.shape(40, [41, 42, 43], {"42": ["no Run line"], "43": ["no Test file"]})
        self.assertEqual(json.loads(r.store.get_all("plan:40")["held"]), [42, 43])
        self.assertEqual(r.station.held_children(), {42, 43})

    def test_a_cut_from_before_this_change_names_its_refused_children_in_its_posted_shape(self):
        r = T.Rig()
        r.store.set("plan:1221", "state", "cut")
        r.store.set("plan:1221", "width", "## Cut shape\n\nNot labelled `factory`, refused by the checks: #1578, #1581")
        self.assertEqual(r.station.held_children(), {1578, 1581})

    def test_the_planner_sends_a_refused_child_first(self):
        saved = list(T.BACKLOG)
        self.addCleanup(T.BACKLOG.__setitem__, slice(None), saved)
        T.BACKLOG[:] = saved + [T.issue(42, "P2", "2026-11-11T00:00:00Z")]
        r = T.Rig()
        r.store.set("plan:40", "state", "cut")
        r.store.set("plan:40", "held", json.dumps([42]))
        r.station.once(1)
        self.assertEqual(r.numbers()[0], 42)


if __name__ == "__main__":
    unittest.main()
