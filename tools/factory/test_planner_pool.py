import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import pools
import snapshot
import store as ledger_store
from test_dispatch_types import run

BOSS = "39311ebf-8324-42a4-8ab4-770acd1653f2"
SHAPER = "1b325848-c3fd-4e6f-9ad7-43f3adac08b6"
IKE = "50bd7e97-bd0b-4236-be49-25fbe3f8c71f"
NOW = 1794000000.0


def cw(ids):
    return [{"id": i, "name": i.upper(), "runs": 1} for i in ids]


class PlannerPool(unittest.TestCase):
    def test_the_shipped_settings_carry_the_three_planners_and_no_job_limit(self):
        planner = D.settings()["types"]["planner"]
        self.assertEqual([(c["id"], c["name"], c["runs"]) for c in planner["coworkers"]],
                         [(BOSS, "Boss", 2), (SHAPER, "Scope Shaper", 3), (IKE, "IKE", 3)])
        self.assertNotIn("max_jobs", planner)
        self.assertIsNone(pools.max_jobs({"types": {"planner": planner}}, "planner"))

    def test_the_other_pools_of_the_shipped_settings_are_unchanged(self):
        types = D.settings()["types"]
        self.assertEqual(list(types), ["coder", "reviewer", "researcher", "designer", "planner", "acceptor", "resolver"])
        self.assertEqual(types["coder"]["max_jobs"], 16)

    def test_the_dispatcher_never_sends_work_to_the_planner_pool(self):
        sent = run({"types": {"coder": {"max_jobs": 8, "coworkers": cw(["b1"])}, "reviewer": {"coworkers": cw(["r1"])},
                              "planner": {"coworkers": cw(["p1", "p2"])}}})
        self.assertEqual(sent, ["b1", "r1"])

    def test_the_snapshot_pools_do_not_list_the_planner_pool(self):
        with tempfile.TemporaryDirectory() as d:
            st = ledger_store.Store(os.path.join(d, "l.db"))
            try:
                cfg = {"repo": "o/r", "types": {"coder": {"max_jobs": 8, "coworkers": cw(["b1"])},
                                                "planner": {"coworkers": cw(["p1"])}}}
                snap = snapshot.build_snapshot(st, cfg, NOW, None)
            finally:
                st.db.close()
        self.assertEqual([p["type"] for p in snap["pools"]], ["coder"])


if __name__ == "__main__":
    unittest.main()
