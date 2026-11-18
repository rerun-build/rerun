import contextlib, io, os, sys, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import holds
import pools
from test_dispatch import World, ready

HERE = os.path.dirname(os.path.abspath(__file__))


def issue(n):
    return {"number": n, "title": "Fix %d" % n, "body": ready(), "comments": []}


class Drain(unittest.TestCase):
    def make(self, issues):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        env = mock.patch.dict(os.environ, {"FACTORY_DATA_DIR": self.dir})
        env.start()
        self.addCleanup(env.stop)
        self.w = World(issues)
        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "checks_timeout_s": 3600, "auto_plan_marker": True,
               "ledger_file": os.path.join(self.dir, "ledger.db"), "json_state_file": os.path.join(self.dir, "dispatch.json"),
               "heartbeat_file": os.path.join(self.dir, "heartbeat"),
               "builders": [{"id": b, "name": b.upper()} for b in ("b1", "b2")],
               "reviewers": [{"id": r, "name": r.upper()} for r in ("r1", "r2")]}
        self.w.ledger = cfg["ledger_file"]
        self.d = D.Dispatcher(cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        self.addCleanup(self.d.close)

    def mark(self, age=0):
        path = os.path.join(self.dir, "drain")
        open(path, "w").close()
        os.utime(path, (self.w.clock - age, self.w.clock - age))

    def left(self):
        with open(os.path.join(self.dir, "drain-left")) as f:
            return f.read().strip()

    def beat(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.d.once()
        return out.getvalue()

    def state(self, n):
        return self.d.store.get_job(str(n))["state"]

    def test_the_update_mark_holds_new_sends_and_reports_the_runs_left(self):
        self.make([issue(5)])
        self.beat()
        self.assertEqual(self.state(5), "building")
        self.w.issues.append(issue(6))
        self.mark()
        text = self.beat() + self.beat()
        self.assertEqual(text.count("update asked"), 1)
        self.assertEqual(holds.active(self.d.store, self.w.clock)["kind"], "update")
        self.assertEqual(self.state(6), "queued")
        self.assertEqual(self.left(), "1")
        self.assertEqual(pools.free_copies(self.d.cfg, "reviewer", []), [])

    def test_a_fire_left_open_for_a_run_that_ended_is_not_counted_as_running(self):
        self.make([])
        fid = self.d.store.intent("77", "", "build", coworker="B1", at=D.iso(self.w.clock - 600))
        self.d.store.fired(fid, "gone-run")
        self.mark()
        self.beat()
        self.assertEqual(self.left(), "0")

    def test_a_send_in_its_first_minutes_is_still_counted(self):
        self.make([])
        self.d.store.intent("78", "", "build", coworker="B1", at=D.iso(self.w.clock - 60))
        self.mark()
        self.beat()
        self.assertEqual(self.left(), "1")

    def test_without_the_mark_nothing_is_held_and_sending_goes_on(self):
        self.make([issue(5)])
        self.mark()
        self.beat()
        self.assertEqual(self.state(5), "queued")
        self.assertEqual(self.left(), "0")
        os.remove(os.path.join(self.dir, "drain"))
        self.w.clock += 120
        self.beat()
        self.assertIsNone(holds.active(self.d.store, self.w.clock))
        self.assertEqual(self.state(5), "building")
        self.assertTrue(pools.free_copies(self.d.cfg, "reviewer", []))

    def test_a_mark_older_than_its_limit_is_ignored_and_said_once(self):
        self.make([issue(5)])
        self.mark(age=D.DRAIN_MAX_S + 60)
        text = self.beat() + self.beat()
        self.assertEqual(text.count("update mark is over"), 1)
        self.assertEqual(self.state(5), "building")
        self.assertFalse(os.path.exists(os.path.join(self.dir, "drain-left")))


class UpdateScript(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "..", "..", "deploy", "vps", "update.sh"), encoding="utf-8", newline="") as f:
            self.text = f.read()

    def test_the_script_marks_the_drain_waits_before_the_restart_and_always_removes_the_mark(self):
        t = self.text
        self.assertNotIn("\r", t)
        self.assertLess(t.index("trap undrain EXIT"), t.index("touch /state/drain"))
        self.assertLess(t.index("touch /state/drain"), t.index("docker compose pull"))
        self.assertLess(t.rindex("wait_drained"), t.index("docker compose up -d"))
        self.assertIn("rm -f /state/drain /state/drain-left", t)
        self.assertIn("trap 'exit 130' INT TERM HUP", t)


if __name__ == "__main__":
    unittest.main()
