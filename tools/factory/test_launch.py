import contextlib, io, json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import launch as L

OLD, NEW, NEWER = "a" * 40, "b" * 40, "c" * 40


def rec(good=None, trial=None, skip=None, timeout=None):
    return {"good": good, "trial": trial, "skip": skip, "timeout": timeout}


class Proc:
    def __init__(self, world, rc, beats=0, hang=False, heart=False, obeys=True, stop_at=None):
        self.w, self.rc, self.hang, self.heart, self.obeys, self.stop_at = world, rc, hang, heart, obeys, stop_at
        self.beats = list(range(1, beats + 1)) if isinstance(beats, int) else list(beats)
        self.terminated = self.killed = False
        self.polls = 0

    def poll(self):
        self.polls += 1
        if self.polls == self.stop_at:
            self.w.l.stop_soon()
        if self.killed:
            return -9
        if self.terminated and self.obeys:
            return 0
        if self.beats:
            n = self.beats.pop(0)
            self.w.beat(n, "heartbeat" if self.heart else "beat-ok")
            if self.heart and self.hang:
                self.beats.append(n + 1)
            return None
        return None if self.hang else self.rc

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self):
        return -9 if self.killed else self.rc


class World:
    def __init__(self, d):
        self.state, self.app = os.path.join(d, "state"), os.path.join(d, "app")
        self.src = os.path.join(self.state, "src")
        self.tmp = self.src + ".tmp"
        self.factory = os.path.join(self.src, "tools", "factory")
        os.makedirs(self.state)
        self.clock, self.compile_rc, self.fail, self.empty = 1000.0, 0, set(), set()
        self.procs, self.spawned, self.git_calls, self.slept, self.known = [], [], [], [], set()
        self.make = None
        self.l = L.Launcher(state=self.state, app=self.app, repo="o/r", run=self.run, spawn=self.spawn,
                            clock=lambda: self.clock, sleep=self.sleep, env={"KEEP": "1"})

    def sleep(self, s):
        self.slept.append(s)
        self.clock += s

    def spawn(self, argv, env):
        self.spawned.append((argv, env))
        return self.make(env) if self.make else self.procs.pop(0)

    def beat(self, n, name="beat-ok"):
        p = os.path.join(self.state, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write("%d\n" % n)
        os.utime(p, (self.clock, self.clock))

    def write(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    def run(self, argv, **kw):
        self.git_calls.append(list(argv))
        if argv[0] == "git" and (argv[3] if argv[1] == "-C" else argv[1]) in self.fail:
            return subprocess.CompletedProcess(argv, 1, "", "fatal: boom\n")
        rc = 0
        if argv[:2] == ["git", "clone"]:
            os.makedirs(os.path.join(argv[-1], ".git"))
        elif argv[3:5] == ["sparse-checkout", "set"]:
            self.write(os.path.join(argv[2], ".git", "sparse"), "/tools/factory/")
        elif argv[3:4] == ["fetch"]:
            self.known.add(argv[-1])
        elif argv[3:4] == ["checkout"]:
            rc = 0 if argv[-1] in self.known else 128
            top = argv[2]
            if not rc:
                self.write(os.path.join(top, "README.md"), argv[-1])
                if os.path.exists(os.path.join(top, ".git", "sparse")) and argv[-1] not in self.empty:
                    for name in ("dispatch.py", os.path.join("sub", "x.py"), "dispatch.json"):
                        self.write(os.path.join(top, "tools", "factory", name), argv[-1])
        elif argv[:4] == ["python3", "-I", "-m", "py_compile"]:
            rc = self.compile_rc
        return subprocess.CompletedProcess(argv, rc, "", "fatal: boom\n")

    def cloned(self, *shas, sparse=True):
        os.makedirs(os.path.join(self.src, ".git"))
        if sparse:
            self.write(os.path.join(self.src, ".git", "sparse"), "/tools/factory/")
        self.known |= set(shas)

    def refresh_to(self, text):
        self.write(os.path.join(self.state, "refresh-to"), text)

    def record(self):
        with open(os.path.join(self.state, "launch.json"), encoding="utf-8") as f:
            return json.load(f)

    def save(self, r):
        self.write(os.path.join(self.state, "launch.json"), json.dumps(r))


class Launch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.w = World(self.tmp.name)
        self.out = io.StringIO()

    def step(self, *procs):
        self.w.procs.extend(procs)
        with contextlib.redirect_stdout(self.out):
            self.w.l.step()

    def git(self, *args, top=None):
        return ["git", "-C", top or self.w.src] + list(args)

    def sparse(self, top=None):
        return self.git("sparse-checkout", "set", "--no-cone", "/tools/factory/", top=top)

    def checkout(self, sha):
        return self.git("checkout", "-q", "--detach", sha)

    def test_with_no_record_the_mounted_code_runs_marked_app(self):
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[0]
        self.assertEqual(argv, ["python3", "-u", os.path.join(self.w.app, "dispatch.py"), "run"])
        self.assertEqual(env["FACTORY_CODE_SHA"], "app")
        self.assertEqual(env["KEEP"], "1")
        self.assertEqual(env["FACTORY_START_CHECK"], "1")
        self.assertNotIn("FACTORY_SKIP_SHA", env)
        self.assertEqual(self.w.git_calls, [])

    def test_exit_75_clones_into_a_side_folder_fetches_compiles_and_the_next_start_runs_the_trial(self):
        self.w.refresh_to(NEW + "\n")
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.git_calls[:5], [
            ["git", "clone", "--filter=blob:none", "--no-checkout", "--sparse", "https://github.com/o/r.git", self.w.tmp],
            self.sparse(self.w.tmp), self.sparse(), self.git("fetch", "-q", "--depth", "1", "origin", NEW), self.checkout(NEW)])
        compiled = self.w.git_calls[5]
        self.assertEqual(compiled[:4], ["python3", "-I", "-m", "py_compile"])
        self.assertEqual(sorted(compiled[4:]), sorted([os.path.join(self.w.factory, "dispatch.py"), os.path.join(self.w.factory, "sub", "x.py")]))
        self.assertEqual(len(self.w.git_calls), 6)
        self.assertFalse(os.path.exists(self.w.tmp))
        self.assertEqual(self.w.record(), rec(trial=NEW))
        self.assertFalse(os.path.exists(os.path.join(self.w.state, "refresh-to")))
        self.assertIn("trial %s" % NEW[:7], self.out.getvalue())
        self.assertNotIn(5, self.w.slept)
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[1]
        self.assertEqual(argv, ["python3", "-u", os.path.join(self.w.factory, "dispatch.py"), "run"])
        self.assertEqual(env["FACTORY_CODE_SHA"], NEW)
        self.assertEqual(self.w.git_calls[-2:], [self.sparse(), self.checkout(NEW)])

    def test_a_clone_left_without_its_sparse_setting_is_repaired_before_the_checkout(self):
        self.w.cloned(OLD, sparse=False)
        self.w.save(rec(good=OLD))
        self.step(Proc(self.w, 1))
        script = self.w.spawned[0][0][2]
        self.assertEqual(script, os.path.join(self.w.factory, "dispatch.py"))
        self.assertTrue(os.path.isfile(script))
        self.assertEqual(self.w.git_calls, [self.sparse(), self.checkout(OLD)])

    def test_a_folder_left_by_a_killed_clone_is_replaced_by_a_fresh_clone(self):
        os.makedirs(os.path.join(self.w.tmp, ".git"))
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertFalse(os.path.exists(self.w.tmp))
        self.assertTrue(os.path.isfile(os.path.join(self.w.factory, "dispatch.py")))
        self.assertEqual(self.w.record(), rec(trial=NEW))

    def test_a_commit_without_the_dispatcher_falls_back_to_the_mounted_code_and_is_never_skipped(self):
        self.w.cloned(OLD)
        self.w.empty = {OLD, NEW}
        self.w.save(rec(good=OLD))
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.spawned[0][0][2], os.path.join(self.w.app, "dispatch.py"))
        self.assertIn("cannot check out good %s" % OLD[:7], self.out.getvalue())
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertIn("refresh to %s failed" % NEW[:7], self.out.getvalue())
        self.assertEqual(self.w.record(), rec(good=OLD))
        self.assertFalse(any(c[:4] == ["python3", "-I", "-m", "py_compile"] for c in self.w.git_calls))

    def test_a_trial_is_good_after_three_consecutive_clean_beats_written_after_its_start(self):
        self.w.cloned(OLD, NEW)
        self.w.save(rec(good=OLD, trial=NEW))
        self.w.beat(7)
        self.w.clock = 2000.0
        self.step(Proc(self.w, 1, beats=3))
        self.assertEqual(self.w.record(), rec(good=NEW))
        self.assertIn("%s is good after 3 clean beats" % NEW[:7], self.out.getvalue())
        self.assertNotIn("rolled back", self.out.getvalue())
        self.assertEqual(self.w.slept[-1], 5)

    def test_stale_or_broken_runs_of_clean_beats_do_not_make_a_trial_good(self):
        self.w.cloned(OLD, NEW)
        self.w.save(rec(good=OLD, trial=NEW))
        for t, n in ((1000.0, 5), (1002.0, 6), (1004.0, 7)):
            self.w.clock = t
            self.w.beat(n)
        self.w.clock = 2000.0
        self.step(Proc(self.w, 1, beats=[8, 9, 11, 12]))
        self.assertEqual(self.w.record(), rec(good=OLD, skip=NEW))
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())
        self.assertNotIn(5, self.w.slept)

    def test_a_trial_that_crashes_before_three_clean_beats_is_skipped_at_once_and_good_returns_without_a_fetch(self):
        self.w.cloned(OLD, NEW)
        self.w.save(rec(good=OLD, trial=NEW))
        self.step(Proc(self.w, 1, beats=2))
        self.assertEqual(self.w.record(), rec(good=OLD, skip=NEW))
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())
        self.w.git_calls.clear()
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.git_calls, [self.sparse(), self.checkout(OLD)])
        argv, env = self.w.spawned[1]
        self.assertEqual(argv[2], os.path.join(self.w.factory, "dispatch.py"))
        self.assertEqual((env["FACTORY_CODE_SHA"], env["FACTORY_SKIP_SHA"]), (OLD, NEW))

    def test_a_rolled_back_trial_with_no_good_falls_back_to_the_mounted_code(self):
        self.w.cloned(NEW)
        self.w.save(rec(trial=NEW))
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.record(), rec(skip=NEW))
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[1]
        self.assertEqual(argv[2], os.path.join(self.w.app, "dispatch.py"))
        self.assertEqual((env["FACTORY_CODE_SHA"], env["FACTORY_SKIP_SHA"]), ("app", NEW))

    def test_the_trial_window_fits_three_beats_of_the_health_checks_120_s_with_margin(self):
        self.assertGreaterEqual(L.TRIAL_S, 3 * 120 + 60)

    def test_a_trial_that_beats_but_never_cleanly_times_out_gets_one_more_trial_then_is_skipped(self):
        self.w.cloned(OLD, NEW)
        self.w.save(rec(good=OLD, trial=NEW))
        p = Proc(self.w, 0, beats=1, heart=True, hang=True)
        start = self.w.clock
        self.step(p)
        self.assertTrue(p.terminated)
        self.assertFalse(p.killed)
        self.assertGreaterEqual(self.w.clock - start, L.TRIAL_S)
        self.assertLess(self.w.clock - start, L.TRIAL_S + 10)
        self.assertEqual(self.w.record(), rec(good=OLD, timeout={"sha": NEW, "tries": 1}))
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())
        self.step(Proc(self.w, 1))
        self.assertNotIn("FACTORY_SKIP_SHA", self.w.spawned[1][1])
        self.w.save(dict(self.w.record(), trial=NEW))
        self.step(Proc(self.w, 0, beats=1, heart=True, hang=True))
        self.assertEqual(self.w.record(), rec(good=OLD, skip=NEW))

    def test_a_trial_that_ignores_the_stop_is_killed_after_the_grace_and_rolled_back(self):
        self.w.cloned(NEW)
        self.w.save(rec(trial=NEW))
        p = Proc(self.w, 0, hang=True, obeys=False)
        start = self.w.clock
        self.step(p)
        self.assertTrue(p.terminated and p.killed)
        self.assertGreaterEqual(self.w.clock - start, L.TRIAL_S + L.STOP_S)
        self.assertEqual(self.w.record(), rec(timeout={"sha": NEW, "tries": 1}))

    def test_a_stop_signal_is_passed_to_the_dispatcher_and_ends_the_loop_without_a_rollback(self):
        self.w.cloned(OLD, NEW)
        self.w.save(rec(good=OLD, trial=NEW))
        first, second = Proc(self.w, 1), Proc(self.w, 0, hang=True, stop_at=3)
        self.w.procs.extend([first, second])
        with contextlib.redirect_stdout(self.out):
            self.w.l.loop()
        self.assertTrue(second.terminated)
        self.assertFalse(second.killed)
        self.assertEqual(self.w.procs, [])
        self.assertEqual(self.w.record(), rec(good=OLD, skip=NEW))
        self.assertIn("stop asked", self.out.getvalue())
        self.assertNotIn(5, self.w.slept[1:])
        self.w.save(rec(good=OLD, trial=NEW))
        third = Proc(self.w, 0, hang=True, stop_at=2)
        self.w.l.stopping = False
        self.step(third)
        self.assertTrue(third.terminated)
        self.assertEqual(self.w.record(), rec(good=OLD, trial=NEW))

    def test_a_trial_that_exits_75_moves_to_the_newer_commit_and_a_failed_switch_rolls_it_back(self):
        self.w.cloned(OLD, NEW)
        self.w.save(rec(good=OLD, trial=NEW))
        self.w.refresh_to(NEWER)
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.record(), rec(good=OLD, trial=NEWER))
        self.assertNotIn("rolled back", self.out.getvalue())
        self.w.save(rec(good=OLD, trial=NEW))
        self.w.fail = {"fetch"}
        self.w.refresh_to(NEWER)
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.record(), rec(good=OLD, skip=NEW))
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.spawned[-1][1]["FACTORY_CODE_SHA"], OLD)
        self.assertEqual(self.w.spawned[-1][1]["FACTORY_START_CHECK"], "0")

    def test_a_switch_that_keeps_failing_lets_the_next_dispatcher_run_its_beats_with_the_start_check_off(self):
        self.w.cloned(OLD)
        self.w.save(rec(good=OLD))
        self.w.fail = {"fetch"}
        checks = []

        def make(env):
            checks.append(env.get("FACTORY_START_CHECK", "1"))
            if len(checks) > 10:
                raise AssertionError("no dispatcher was started with the start check off")
            if checks[-1] != "0":
                self.w.refresh_to(NEWER)
                return Proc(self.w, 75)
            return Proc(self.w, 0, beats=3, hang=True, stop_at=4)
        self.w.make = make
        with contextlib.redirect_stdout(self.out):
            self.w.l.loop()
        self.assertEqual(checks, ["1", "0"])
        self.assertEqual(self.w.l.clean_beat(0), 3)
        self.assertEqual(self.w.record(), rec(good=OLD))

    def test_a_second_failed_switch_in_a_row_removes_the_clone_and_the_next_switch_clones_afresh(self):
        self.w.cloned(OLD)
        self.w.save(rec(good=OLD))
        self.w.fail = {"fetch"}
        self.w.refresh_to(NEWER)
        self.step(Proc(self.w, 75))
        self.assertTrue(os.path.isdir(os.path.join(self.w.src, ".git")))
        self.w.refresh_to(NEWER)
        self.step(Proc(self.w, 75))
        self.assertFalse(os.path.exists(self.w.src))
        self.assertIn("the clone was removed", self.out.getvalue())
        self.assertEqual(self.w.l.record(), rec(good=OLD))
        self.w.fail = set()
        self.w.refresh_to(NEWER)
        self.step(Proc(self.w, 75))
        self.assertEqual([c[:2] for c in self.w.git_calls].count(["git", "clone"]), 1)
        self.assertEqual(self.w.record(), rec(good=OLD, trial=NEWER))

    def test_a_folder_without_git_where_the_clone_goes_is_removed_before_the_rename(self):
        self.w.write(os.path.join(self.w.src, "junk.txt"), "x")
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.record(), rec(trial=NEW))
        self.assertFalse(os.path.exists(os.path.join(self.w.src, "junk.txt")))
        self.assertTrue(os.path.isfile(os.path.join(self.w.factory, "dispatch.py")))

    def test_a_target_that_does_not_compile_keeps_the_current_code_and_is_skipped(self):
        self.w.cloned(OLD)
        self.w.save(rec(good=OLD))
        self.w.compile_rc = 1
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.record(), rec(good=OLD, skip=NEW))
        self.assertIn("refresh to %s failed" % NEW[:7], self.out.getvalue())
        self.assertIn("keeping %s" % OLD[:7], self.out.getvalue())
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[1]
        self.assertEqual(self.w.git_calls[-1], self.checkout(OLD))
        self.assertEqual((env["FACTORY_CODE_SHA"], env["FACTORY_SKIP_SHA"]), (OLD, NEW))

    def test_a_half_made_clone_is_never_used_and_a_failed_switch_is_tried_again_not_skipped(self):
        self.w.fail = {"sparse-checkout"}
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertFalse(os.path.exists(self.w.src))
        self.assertIn("trying again at the next check", self.out.getvalue())
        self.assertEqual(self.w.l.record(), rec())
        self.w.fail = set()
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertEqual([c[:2] for c in self.w.git_calls].count(["git", "clone"]), 2)
        self.assertEqual(self.w.record(), rec(trial=NEW))
        self.assertNotIn("FACTORY_SKIP_SHA", self.w.spawned[-1][1])

    def test_a_trial_that_can_no_longer_be_checked_out_is_dropped_without_a_skip(self):
        self.w.cloned(OLD)
        self.w.save(rec(good=OLD, trial=NEW))
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.record(), rec(good=OLD))
        self.assertIn("cannot check out trial %s" % NEW[:7], self.out.getvalue())
        self.assertEqual(self.w.spawned[0][1]["FACTORY_CODE_SHA"], OLD)

    def test_a_refresh_target_that_is_not_a_commit_id_never_reaches_git(self):
        for text in ("--upload-pack=touch x", "", NEW[:39], NEW.upper(), None):
            if text is not None:
                self.w.refresh_to(text)
            self.assertEqual(os.path.exists(os.path.join(self.w.state, "refresh-to")), text is not None)
            self.step(Proc(self.w, 75))
        self.assertEqual(self.w.git_calls, [])
        self.assertEqual([e["FACTORY_CODE_SHA"] for _, e in self.w.spawned], ["app"] * 5)
        self.assertEqual(self.out.getvalue().count("keeping app"), 5)

    def test_crashes_on_settled_code_back_off_from_5_doubling_to_60_and_reset_after_a_long_run(self):
        for _ in range(6):
            self.step(Proc(self.w, 1))
        self.assertEqual(self.w.slept, [5, 10, 20, 40, 60, 60])
        self.step(Proc(self.w, 1, beats=40))
        self.assertEqual(self.w.slept[-1], 5)
        self.assertIn("exited 1", self.out.getvalue())


class Compose(unittest.TestCase):
    def test_the_dispatcher_container_starts_the_launcher_and_keeps_its_hardening(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "..", "..", "deploy", "vps", "factory-dispatcher.yml"), encoding="utf-8") as f:
            c = f.read()
        self.assertIn('command: ["python3", "-u", "/app/launch.py"]', c)
        for need in ("../../tools/factory:/app:ro", "factory-dispatcher-data:/state", "FACTORY_DATA_DIR: /state",
                     'FACTORY_DISPATCHER: "1"', "read_only: true",
                     "cap_drop:\n      - ALL", "no-new-privileges:true", "mem_limit: 512m", "cpus: 0.5", "- /tmp",
                     "stop_grace_period: 150s"):
            self.assertIn(need, c)


if __name__ == "__main__":
    unittest.main()
