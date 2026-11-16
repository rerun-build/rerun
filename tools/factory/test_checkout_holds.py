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


LOAD = "TRANSIENT: load: 13.0 on 4 cores, ceiling is 12.0\nBLOCKED: no room"


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
        found = self.d.resolver.watch.find([j], {}, {5}, "", self.w.clock, [], "", False)
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

    def test_a_failing_test_traceback_from_a_job_folder_is_not_a_checkout_fault(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "Traceback (most recent call last):\n  File \"/data/work/wt/rerun/5-1/tools/factory/test_x.py\", line 3, in test_y\n"
                            "AssertionError: 1 != 2\nBLOCKED: tests fail")
        self.d.once()
        self.assertNotIn("checkout_failed", self.job(5))
        self.assertIn(self.d.store.get_all("-").get("checkout_failed_row") or "0", ("0",))

    def test_the_row_starts_again_once_the_hold_is_armed(self):
        self.make([issue(5), issue(6), issue(7)])
        self.d.once()
        for b in ("b1", "b2", "b3"):
            self.w.finish(b, TRACE)
        self.d.once()
        self.assertEqual(self.hold(), "checkout")
        self.assertEqual(self.d.store.get_all("-").get("checkout_failed_row"), "0")

    def test_a_job_that_ends_later_drops_its_checkout_failure(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", TRACE.replace("BLOCKED:", "TRANSIENT: cannot clone o/r: GitHub 502\nBLOCKED:"))
        self.d.once()
        self.assertEqual(self.job(5)["state"], "queued")
        self.assertIn("clones.py", self.job(5)["checkout_failed"])
        self.w.clock += 61
        self.d.once()
        self.w.finish(self.job(5)["agent"], "BLOCKED: plan: the plan names a file that is gone")
        self.d.once()
        self.assertEqual(self.job(5)["state"], "returned")
        self.assertNotIn("checkout_failed", self.job(5))

    def test_transient_inside_a_line_is_not_a_transient_refusal(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "the test printed TRANSIENT: fake on purpose\nBLOCKED: tests fail")
        self.d.once()
        self.assertEqual(self.job(5)["state"], "blocked")

    def test_a_room_line_quoted_inside_other_output_arms_no_hold(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "the log quoted TRANSIENT: load: 13.0 on 4 cores, ceiling is 12.0\nBLOCKED: tests fail")
        self.d.once()
        self.assertIsNone(self.hold())
        self.assertEqual(self.job(5)["state"], "blocked")

    def test_room_refusals_never_end_the_job(self):
        self.make([issue(5)])
        self.d.once()
        for i in range(5):
            self.assertEqual(self.job(5)["state"], "building", i)
            self.w.finish(self.job(5)["agent"], LOAD)
            self.d.once()
            self.assertEqual(self.job(5)["state"], "queued", i)
            self.w.clock += 61 * 60
            self.d.once()

    def test_a_room_line_the_builder_quotes_in_its_blocked_line_holds_and_never_ends_the_job(self):
        self.make([issue(5)])
        self.d.once()
        for i in range(5):
            self.assertEqual(self.job(5)["state"], "building", i)
            self.w.finish(self.job(5)["agent"], "BLOCKED: wt new said TRANSIENT: load: 13.0 on 4 cores, ceiling is 12.0")
            self.d.once()
            self.assertEqual(self.job(5)["state"], "queued", i)
            self.assertEqual(self.hold(), "load", i)
            self.w.clock += 61 * 60
            self.d.once()

    def test_another_refusal_the_builder_quotes_in_its_blocked_line_is_a_counted_second_try(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "BLOCKED: wt new said TRANSIENT: cannot clone o/r: GitHub 502")
        self.d.once()
        self.assertEqual(self.job(5)["state"], "queued")
        self.assertIsNone(self.hold())
        self.assertEqual(self.d.store.retries("5", "transient"), 1)

    def round(self, n=5):
        self.w.finish(self.job(n)["agent"], LOAD)
        self.d.once()
        left = holds.active(self.d.store, self.w.clock)["until"] - self.w.clock
        self.w.clock += left + 1
        self.d.once()
        return left

    def test_refusals_in_one_beat_are_one_round_and_one_build_tests_the_room_before_the_rest(self):
        self.make([issue(5), issue(6), issue(7)])
        self.d.once()
        for b in ("b1", "b2", "b3"):
            self.w.finish(b, LOAD)
        self.d.once()
        self.assertEqual(self.d.store.get_all("-").get("room_row"), "1")
        self.assertEqual(holds.active(self.d.store, self.w.clock)["until"] - self.w.clock, 5 * 60)
        self.w.clock += 5 * 60 + 1
        self.d.once()
        self.assertEqual(sorted(self.job(n)["state"] for n in (5, 6, 7)), ["building", "queued", "queued"])
        self.assertEqual(self.hold(), "load")
        self.w.clock += D.ROOM_PROBE_S + 1
        self.d.once()
        self.assertEqual(sorted(self.job(n)["state"] for n in (5, 6, 7)), ["building", "building", "building"])

    def test_each_round_without_room_doubles_the_hold_up_to_an_hour(self):
        self.make([issue(5)])
        self.d.once()
        self.assertEqual([self.round() for _ in range(6)], [300, 600, 1200, 2400, 3600, 3600])

    def test_three_rounds_without_room_are_one_problem_and_a_pull_request_ends_it(self):
        self.make([issue(5)])
        self.d.once()
        self.round()
        self.round()
        self.assertIsNone(self.d.no_room())
        self.round()
        line = self.d.no_room()
        self.assertIn("3 rounds", line)
        self.assertIn("load: 13.0 on 4 cores", line)
        found = self.d.resolver.watch.find([], {}, None, "", self.w.clock, [], "", False, line)
        self.assertEqual(found.get("no room"), line)
        self.assertIn("no room", resolver.KINDS)
        self.w.finish(self.job(5)["agent"], PR_LINE)
        self.d.once()
        self.assertIsNone(self.d.no_room())
        self.assertEqual(self.d.store.get_all("-").get("room_row"), "0")

    def test_a_round_long_after_the_last_starts_the_row_again(self):
        self.make([issue(5)])
        self.d.once()
        self.round()
        self.round()
        self.w.clock += 3 * 3600
        self.assertEqual(self.round(), 300)

    def test_a_checkout_failure_of_an_ended_job_is_a_problem_only_while_its_issue_is_open(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", TRACE)
        self.d.once()
        j = self.job(5)
        self.assertEqual(j["state"], "blocked")
        find = self.d.resolver.watch.find
        self.assertIn("checkout failed #5", find([j], {}, {5}, "", self.w.clock, [], "", False))
        self.assertNotIn("checkout failed #5", find([j], {}, {6}, "", self.w.clock, [], "", False))

    def test_a_checkout_failure_of_a_job_returned_to_the_planner_follows_the_same_rule(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", TRACE.replace("BLOCKED: wt new failed", "BLOCKED: plan: wt new failed"))
        self.d.once()
        j = self.job(5)
        self.assertEqual(j["state"], "returned")
        find = self.d.resolver.watch.find
        self.assertIn("checkout failed #5", find([j], {}, {5}, "", self.w.clock, [], "", False))
        self.assertNotIn("checkout failed #5", find([j], {}, {6}, "", self.w.clock, [], "", False))
        self.assertNotIn("checkout failed #5", find([j], {}, None, "", self.w.clock, [], "", False))

    def test_a_pull_request_of_a_build_sent_before_the_hold_does_not_end_the_round(self):
        self.make([issue(5), issue(6), issue(7)])
        self.d.once()
        self.w.finish("b1", LOAD)
        self.w.finish("b2", LOAD)
        self.w.finish("b3", PR_LINE)
        self.d.once()
        self.assertEqual(self.d.store.get_all("-").get("room_row"), "1")
        self.w.clock += 5 * 60 + 1
        self.d.once()
        self.assertEqual(sorted(self.job(n)["state"] for n in (5, 6)), ["building", "queued"])

    def test_a_room_line_quoted_far_into_a_long_blocked_line_still_holds(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "BLOCKED: " + "the tool would not open the folder for this job and I tried it again; " * 4
                      + "wt new said TRANSIENT: load: 13.0 on 4 cores, ceiling is 12.0")
        self.d.once()
        self.assertEqual(self.job(5)["state"], "queued")
        self.assertEqual(self.hold(), "load")

    def test_a_resolver_run_that_ended_with_a_line_takes_the_checkout_failure_off_the_job(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", TRACE)
        self.d.once()
        self.d.resolver.handled(self.d, "checkout failed #5")
        self.assertNotIn("checkout_failed", self.job(5))
        self.d.resolver.handled(self.d, "ended #5")
        self.d.resolver.handled(self.d, "idle line")

    def test_a_test_traceback_followed_by_a_line_that_names_the_tools_is_not_a_checkout_fault(self):
        self.make([issue(5)])
        self.d.once()
        self.w.finish("b1", "Traceback (most recent call last):\n  File \"/data/work/wt/rerun/5-1/x.py\", line 3, in t\nAssertionError: 1 != 2\n"
                            "I then read /data/tools/factory/factory.py to see why\nBLOCKED: tests fail")
        self.d.once()
        self.assertNotIn("checkout_failed", self.job(5))


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
