import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snapshot
import states
import store


class StatesStore(unittest.TestCase):
    def test_lists_are_the_objects_of_states(self):
        self.assertIs(store.JOB_STATES, states.NAMES)
        self.assertIs(snapshot.RUNNING, states.RUNNING)
        self.assertIs(snapshot.END, states.END)
        self.assertIs(snapshot.WAIT_STATES, states.WAIT_STATES)

    def test_store_takes_every_state_and_refuses_unknown(self):
        with tempfile.TemporaryDirectory() as d:
            s = store.Store(os.path.join(d, "ledger.db"))
            try:
                for i, name in enumerate(states.NAMES):
                    s.put_job(str(i), name, {})
                with self.assertRaises(ValueError):
                    s.put_job("x", "nowhere", {})
            finally:
                s.close()


if __name__ == "__main__":
    unittest.main()
