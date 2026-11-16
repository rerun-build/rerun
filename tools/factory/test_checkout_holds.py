import os, subprocess, sys, tempfile, types, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
import holds
import resolver
from test_dispatch import World, ready, PR_LINE
import test_factory as T

F = T.F
HERE = os.path.dirname(os.path.abspath(__file__))
TRACE = ("wt new said:\nTraceback (most recent call last):\n  File \"/data/tools/factory-abc/clones.py\", line 9, in new\n"
         "RuntimeError: git checkout: fatal\nBLOCKED: wt new failed in /data/work/wt/rerun/5-1")


def issue(n):
    return {"number": n, "title": "Fix %d" % n, "body": ready(), "comments": []}


class Holds(unittest.TestCase):
    def make(self, issues):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.w = World(issues)
        cfg = {"repo": "o/r", "label": "factory", "max_jobs": 8, "checks_timeout_s": 3600, "auto_plan_marker": True,
               "ledger_file": os.path.join(tmp.name, "ledger.db"), "json_state_file": os.path.join(tmp.name, "dispatch.json"),
               "heartbeat_file": os.path.join(tmp.name, "heartbeat"),
               "builders": [{"id": b, "name": b.upper()} for b in ("b1", "b2", "b3")],
               "reviewers": [{"id": r, "name": r.upper()} for r in ("r1", "r2")]}
        self.w.ledger = cfg["ledger_file"]
        self.d = D.Dispatcher(cfg, self.w.account, self.w.gh, now=lambda: self.w.clock)
        self.addCleanup(self.d.close)

    def job(self, n):
        return self.d.store.get_job(str(n))

    def hold(self):
        h = holds.active(self.d.store, self.w.clock)
        return h and h["kind"]

    def test_a_disk_refusal_holds_new_builds_and_puts_the_job_back(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "TRANSIENT: disk: /data/work has 20 GB free, floor is 30 GB\nBLOCKED: wt new refused for disk")
        self.d.once()
        self.assertEqual(self.job(5)["state"], "queued")
        self.assertEqual(self.hold(), "disk")

    def test_a_memory_or_load_refusal_holds_as_load(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "TRANSIENT: memory: 2.0 GB available, floor is 4 GB\nBLOCKED: no room")
        self.d.once()
        self.assertEqual(self.job(5)["state"], "queued")
        self.assertEqual(self.hold(), "load")

    def test_any_transient_line_of_a_tool_sends_the_job_again_later(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "TRANSIENT: cannot clone o/r: GitHub 502\nBLOCKED: GitHub is down")
        self.d.once()
        j = self.job(5)
        self.assertEqual(j["state"], "queued")
        self.assertGreater(j["not_before"], self.w.clock)

    def test_a_tool_traceback_becomes_a_checkout_failed_problem_with_its_last_lines(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", TRACE)
        self.d.once()
        j = self.job(5)
        self.assertIn("clones.py", j["checkout_failed"])
        self.assertIn("/data/work/wt/rerun/5-1", j["checkout_failed"])
        found = self.d.resolver.watch.find([j], {}, None, "", self.w.clock, [], "", False)
        self.assertIn("checkout failed #5", found)
        self.assertIn("checkout failed", resolver.KINDS)

    def test_three_checkout_failures_in_a_row_hold_all_builds(self):
        self.make([issue(5), issue(6), issue(7)])
        self.d.once()
        for b in ("b1", "b2"):
            self.w.finish(b, TRACE)
        self.d.once()
        self.assertNotEqual(self.hold(), "checkout")
        self.w.finish("b3", TRACE)
        self.d.once()
        self.assertEqual(self.hold(), "checkout")
        self.assertIn("checkout", holds.KINDS)

    def test_a_pull_request_resets_the_row(self):
        self.make([issue(5), issue(6), issue(7)])
        self.d.once()
        self.w.finish("b1", TRACE)
        self.w.finish("b2", PR_LINE)
        self.d.once()
        self.w.finish("b3", TRACE)
        self.d.once()
        self.assertEqual(self.d.store.get_all("-").get("checkout_failed_row"), "1")
        self.assertNotEqual(self.hold(), "checkout")


class ProofStaysOn(unittest.TestCase):
    def test_the_dispatcher_refuses_to_start_with_proof_off(self):
        import io, json
        with open(os.path.join(HERE, "dispatch.json")) as f:
            cfg = json.load(f)
        self.assertTrue(cfg.get("proof"))
        err = io.StringIO()
        with mock.patch.object(D, "settings", lambda: dict(cfg, proof=False)), mock.patch.dict(os.environ, {"DISPATCH_ACCOUNT_URL": "http://x"}), \
                mock.patch.object(D.sys, "stderr", err), mock.patch.object(D, "make_account", side_effect=AssertionError("started")):
            self.assertEqual(D.main(["once"]), 1)
        self.assertIn("proof is off", err.getvalue())


class Room(T.FactoryCase):
    def room(self, free_gb=100, mem_kb=None, load=0.0):
        with mock.patch.object(F.shutil, "disk_usage", lambda p: types.SimpleNamespace(free=free_gb * 2**30)), \
                mock.patch.object(F, "avail_mem_gb", lambda: None if mem_kb is None else mem_kb / 1048576), \
                mock.patch.object(F.os, "getloadavg", lambda: (load, load, load)), mock.patch.object(F.os, "cpu_count", lambda: 4), \
                mock.patch.object(F, "LOAD_PER_CPU", 3.0):
            return self.call(lambda _: F.room_check(), [])

    def test_one_disk_floor_of_30_gb_and_its_half(self):
        self.assertEqual(F.MIN_FREE_GB, 30)
        self.assertEqual(self.room(31)[0], 0)
        code, out = self.room(29)
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: disk: ", out)
        self.assertNotIn("half", out)
        self.assertIn("under half the floor", self.room(14)[1])
        self.assertNotIn("half", self.room(16)[1])

    def test_memory_and_load_are_transient(self):
        code, out = self.room(mem_kb=1048576)
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: memory: ", out)
        self.assertEqual(self.room(load=11.0)[0], 0)
        code, out = self.room(load=13.0)
        self.assertEqual(code, 3, out)
        self.assertIn("TRANSIENT: load: 13.0 on 4 cores, ceiling is 12.0", out)

    def test_the_du_cap_is_gone(self):
        self.assertFalse(hasattr(F, "MAX_WORK_GB"))

    def test_no_tool_prunes_the_pnpm_store(self):
        r = subprocess.run(["git", "grep", "-n", "store prune", "--", "tools/factory/*.py", "tools/factory/bin", "tools/factory/*.sh", ":!tools/factory/test_*"],
                           cwd=os.path.join(HERE, "..", ".."), capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), "")
