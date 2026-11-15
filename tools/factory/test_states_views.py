import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import states
import store
import timeline
import waits

D = "2026-11-13T"


class StatesViews(unittest.TestCase):
    def test_lists_are_the_objects_of_states(self):
        self.assertIs(waits._QUEUE_STATES, states.QUEUE)
        self.assertIs(timeline.END, states.END)
        self.assertIs(timeline.CRIT, states.PROBLEM)

    def test_waits_reason_follows_the_table(self):
        self.assertEqual(waits.reason({"state": "waiting"}, 1000), "dependency")
        for s in states.QUEUE:
            self.assertEqual(waits.reason({"state": s}, 1000), "no free worker of its type", s)
        for s in states.NAMES:
            if s != "waiting" and s not in states.QUEUE:
                self.assertIsNone(waits.reason({"state": s}, 1000), s)

    def test_status_line_names_the_run_for_every_running_state(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.db")
            st = store.Store(path)
            try:
                st.intent("171", "", "build", coworker="W1", at=D + "18:00:00Z")
                for s in states.RUNNING:
                    st.put_job("171", s, {"copy": 2}, at=D + "18:00:00Z")
                    rows = timeline.read_rows(path)
                    lines = timeline.status_lines(rows, timeline.parse(D + "18:10:00Z"))
                    self.assertEqual(len(lines), 1, s)
                    self.assertTrue(lines[0].endswith("run on W1, copy 2"), (s, lines[0]))
            finally:
                st.close()


if __name__ == "__main__":
    unittest.main()
