import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E, runner_loop as R
from test_ready_start import Eng, T0


class Bad(Eng):
    def cancel(self, agent, rid):
        raise E.EngineError("down")


class LeaseSweep(unittest.TestCase):
    def go(self, eng):
        self.d = tempfile.TemporaryDirectory()
        cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "t.json"),
               "store_file": os.path.join(self.d.name, "l.db"),
               "triggers": [{"stage": "build", "coworker": "CODE", "agent": "ag1", "slug": "factory-build"}]}
        self.eng, self.now = eng, T0
        eng.now = T0
        self.r = R.build(cfg, eng, clock=lambda: self.now)
        self.r.st.add_ready("j", "A", paths=["a.py"])
        self.r.tick()
        l = self.r.st.open_leases()
        self.now += 5000
        self.r.sweep_leases()
        return l[0]["id"] if l else None

    def tearDown(self):
        self.r.st.close()
        self.d.cleanup()

    def test_cancel_error_keeps_lease_open(self):
        self.go(Bad())
        self.assertEqual(len(self.r.st.open_leases()), 1)

    def test_cancel_ok_closes_lease(self):
        self.go(Eng())
        self.assertEqual(self.r.st.open_leases(), [])
        self.assertEqual(self.eng.cancelled, ["run1"])

    def test_a_run_already_done_closes_as_done_not_cancelled(self):
        self.d = tempfile.TemporaryDirectory()
        cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "t.json"),
               "store_file": os.path.join(self.d.name, "l.db"),
               "triggers": [{"stage": "build", "coworker": "CODE", "agent": "ag1", "slug": "factory-build"}]}
        self.eng = Eng()
        self.eng.now = T0
        self.now = T0
        self.r = R.build(cfg, self.eng, clock=lambda: self.now)
        self.r.st.add_ready("j", "A", paths=["a.py"])
        self.r.tick()
        rid = self.r.st.running()[0]["run_id"]
        self.eng.runs[rid]["status"] = "done"
        self.now += 5000
        self.r.sweep_leases()
        row = self.r.st.db.execute("SELECT status FROM fires WHERE run_id=?", (rid,)).fetchone()
        self.assertEqual(row[0], "done")
        self.assertEqual(self.eng.cancelled, [])
        self.assertEqual(self.r.st.open_leases(), [])

    def test_requeue_of_a_chunk_reads_no_saved_payload(self):
        self.d = tempfile.TemporaryDirectory()
        cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "t.json"),
               "store_file": os.path.join(self.d.name, "l.db"),
               "triggers": [{"stage": "build", "coworker": "CODE", "agent": "ag1", "slug": "factory-build"}]}
        self.eng = Eng()
        self.eng.now = T0
        self.r = R.build(cfg, self.eng, clock=lambda: T0)
        self.r.st.add_ready("j", "A", paths=["a.py"])
        self.r.tick()
        f = self.r.st.running()[0]

        def boom(*a, **k):
            raise AssertionError("get_all called")

        self.r.st.get_all = boom
        self.r.requeue(f)
        self.assertEqual(self.r.st.attempts("j", "A"), 1)


if __name__ == "__main__":
    unittest.main()
