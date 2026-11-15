import contextlib, io, json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import launch as L

OLD, NEW = "a" * 40, "b" * 40


class Proc:
    def __init__(self, world, rc, beats=0, hang=False, heart=False, obeys=True):
        self.w, self.rc, self.hang, self.heart, self.obeys = world, rc, hang, heart, obeys
        self.beats = list(range(1, beats + 1)) if isinstance(beats, int) else list(beats)
        self.terminated = self.killed = False

    def poll(self):
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
        self.factory = os.path.join(self.src, "tools", "factory")
        os.makedirs(self.state)
        self.clock, self.compile_rc, self.fail = 1000.0, 0, set()
        self.procs, self.spawned, self.git_calls, self.slept, self.known = [], [], [], [], set()
        self.l = L.Launcher(state=self.state, app=self.app, repo="o/r", run=self.run, spawn=self.spawn,
                            clock=lambda: self.clock, sleep=self.sleep, env={"KEEP": "1"})

    def sleep(self, s):
        self.slept.append(s)
        self.clock += s

    def spawn(self, argv, env):
        self.spawned.append((argv, env))
        return self.procs.pop(0)

    def beat(self, n, name="beat-ok"):
        p = os.path.join(self.state, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write("%d\n" % n)
        os.utime(p, (self.clock, self.clock))

    def run(self, argv, **kw):
        self.git_calls.append(list(argv))
        rc = 0
        if argv[0] == "git" and (argv[3] if argv[1] == "-C" else argv[1]) in self.fail:
            return subprocess.CompletedProcess(argv, 1, "", "fatal: boom\n")
        if argv[:2] == ["git", "clone"]:
            os.makedirs(os.path.join(argv[-1], ".git"))
        elif argv[3:4] == ["fetch"]:
            self.known.add(argv[-1])
        elif argv[3:4] == ["checkout"]:
            rc = 0 if argv[-1] in self.known else 128
            if not rc:
                os.makedirs(os.path.join(self.factory, "sub"), exist_ok=True)
                for name in ("dispatch.py", os.path.join("sub", "x.py"), "dispatch.json"):
                    with open(os.path.join(self.factory, name), "w", encoding="utf-8") as f:
                        f.write(argv[-1])
        elif argv[:4] == ["python3", "-I", "-m", "py_compile"]:
            rc = self.compile_rc
        return subprocess.CompletedProcess(argv, rc, "", "fatal: boom\n")

    def cloned(self, *shas):
        os.makedirs(os.path.join(self.src, ".git"))
        self.known |= set(shas)

    def refresh_to(self, text):
        with open(os.path.join(self.state, "refresh-to"), "w", encoding="utf-8") as f:
            f.write(text)

    def record(self):
        with open(os.path.join(self.state, "launch.json"), encoding="utf-8") as f:
            return json.load(f)

    def save(self, rec):
        with open(os.path.join(self.state, "launch.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f)


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

    def checkout(self, sha):
        return ["git", "-C", self.w.src, "checkout", "-q", "--detach", sha]

    def test_with_no_record_the_mounted_code_runs_marked_app(self):
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[0]
        self.assertEqual(argv, ["python3", "-u", os.path.join(self.w.app, "dispatch.py"), "run"])
        self.assertEqual(env["FACTORY_CODE_SHA"], "app")
        self.assertEqual(env["KEEP"], "1")
        self.assertNotIn("FACTORY_SKIP_SHA", env)
        self.assertEqual(self.w.git_calls, [])

    def test_exit_75_clones_sparse_fetches_compiles_and_the_next_start_runs_the_trial(self):
        self.w.refresh_to(NEW + "\n")
        self.step(Proc(self.w, 75))
        src = self.w.src
        self.assertEqual(self.w.git_calls[:4], [
            ["git", "clone", "--filter=blob:none", "--no-checkout", "--sparse", "https://github.com/o/r.git", src],
            ["git", "-C", src, "sparse-checkout", "set", "--no-cone", "/tools/factory/"],
            ["git", "-C", src, "fetch", "-q", "--depth", "1", "origin", NEW],
            self.checkout(NEW)])
        compiled = self.w.git_calls[4]
        self.assertEqual(compiled[:4], ["python3", "-I", "-m", "py_compile"])
        self.assertEqual(sorted(compiled[4:]), sorted([os.path.join(self.w.factory, "dispatch.py"), os.path.join(self.w.factory, "sub", "x.py")]))
        self.assertEqual(len(self.w.git_calls), 5)
        self.assertEqual(self.w.record(), {"good": None, "trial": NEW, "skip": None})
        self.assertFalse(os.path.exists(os.path.join(self.w.state, "refresh-to")))
        self.assertIn("trial %s" % NEW[:7], self.out.getvalue())
        self.assertNotIn(5, self.w.slept)
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[1]
        self.assertEqual(argv, ["python3", "-u", os.path.join(self.w.factory, "dispatch.py"), "run"])
        self.assertEqual(env["FACTORY_CODE_SHA"], NEW)
        self.assertEqual(self.w.git_calls[-1], self.checkout(NEW))

    def test_a_trial_is_good_after_three_consecutive_clean_beats_written_after_its_start(self):
        self.w.cloned(OLD, NEW)
        self.w.save({"good": OLD, "trial": NEW})
        self.w.beat(7)
        self.w.clock = 2000.0
        self.step(Proc(self.w, 1, beats=3))
        self.assertEqual(self.w.record(), {"good": NEW, "trial": None, "skip": None})
        self.assertIn("%s is good after 3 clean beats" % NEW[:7], self.out.getvalue())
        self.assertNotIn("rolled back", self.out.getvalue())
        self.assertEqual(self.w.slept[-1], 5)

    def test_stale_or_broken_runs_of_clean_beats_do_not_make_a_trial_good(self):
        self.w.cloned(OLD, NEW)
        self.w.save({"good": OLD, "trial": NEW})
        for t, n in ((1000.0, 5), (1002.0, 6), (1004.0, 7)):
            self.w.clock = t
            self.w.beat(n)
        self.w.clock = 2000.0
        self.step(Proc(self.w, 1, beats=[8, 9, 11, 12]))
        self.assertEqual(self.w.record(), {"good": OLD, "trial": None, "skip": NEW})
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())
        self.assertNotIn(5, self.w.slept)

    def test_a_trial_that_exits_before_three_clean_beats_rolls_back_to_good_without_a_fetch(self):
        self.w.cloned(OLD, NEW)
        self.w.save({"good": OLD, "trial": NEW})
        self.step(Proc(self.w, 1, beats=2))
        self.assertEqual(self.w.record(), {"good": OLD, "trial": None, "skip": NEW})
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())
        self.w.git_calls.clear()
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.git_calls, [self.checkout(OLD)])
        argv, env = self.w.spawned[1]
        self.assertEqual(argv[2], os.path.join(self.w.factory, "dispatch.py"))
        self.assertEqual((env["FACTORY_CODE_SHA"], env["FACTORY_SKIP_SHA"]), (OLD, NEW))

    def test_a_rolled_back_trial_with_no_good_falls_back_to_the_mounted_code(self):
        self.w.cloned(NEW)
        self.w.save({"good": None, "trial": NEW})
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.record(), {"good": None, "trial": None, "skip": NEW})
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[1]
        self.assertEqual(argv[2], os.path.join(self.w.app, "dispatch.py"))
        self.assertEqual((env["FACTORY_CODE_SHA"], env["FACTORY_SKIP_SHA"]), ("app", NEW))

    def test_a_trial_that_beats_but_never_has_a_clean_beat_is_stopped_after_five_minutes_and_rolled_back(self):
        self.w.cloned(OLD, NEW)
        self.w.save({"good": OLD, "trial": NEW})
        p = Proc(self.w, 0, beats=1, heart=True, hang=True)
        start = self.w.clock
        self.step(p)
        self.assertTrue(p.terminated)
        self.assertFalse(p.killed)
        self.assertGreaterEqual(self.w.clock - start, L.TRIAL_S)
        self.assertLess(self.w.clock - start, L.TRIAL_S + 10)
        self.assertEqual(L.TRIAL_S, 300)
        self.assertEqual(self.w.record(), {"good": OLD, "trial": None, "skip": NEW})
        self.assertIn("rolled back %s" % NEW[:7], self.out.getvalue())

    def test_a_trial_that_ignores_the_stop_is_killed_after_the_grace_and_rolled_back(self):
        self.w.cloned(NEW)
        self.w.save({"good": None, "trial": NEW})
        p = Proc(self.w, 0, hang=True, obeys=False)
        start = self.w.clock
        self.step(p)
        self.assertTrue(p.terminated and p.killed)
        self.assertGreaterEqual(self.w.clock - start, L.TRIAL_S + L.STOP_S)
        self.assertEqual(self.w.record(), {"good": None, "trial": None, "skip": NEW})

    def test_a_target_that_does_not_compile_keeps_the_current_code_and_is_skipped(self):
        self.w.cloned(OLD)
        self.w.save({"good": OLD, "trial": None})
        self.w.compile_rc = 1
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.record(), {"good": OLD, "trial": None, "skip": NEW})
        self.assertIn("refresh to %s failed" % NEW[:7], self.out.getvalue())
        self.assertIn("keeping %s" % OLD[:7], self.out.getvalue())
        self.step(Proc(self.w, 1))
        argv, env = self.w.spawned[1]
        self.assertEqual(self.w.git_calls[-1], self.checkout(OLD))
        self.assertEqual((env["FACTORY_CODE_SHA"], env["FACTORY_SKIP_SHA"]), (OLD, NEW))

    def test_a_half_made_clone_is_removed_and_a_failed_fetch_is_tried_again_not_skipped(self):
        self.w.fail = {"sparse-checkout"}
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertFalse(os.path.exists(self.w.src))
        self.assertIn("trying again at the next check", self.out.getvalue())
        self.w.fail = {"fetch"}
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertEqual([c[:2] for c in self.w.git_calls].count(["git", "clone"]), 2)
        self.assertTrue(os.path.isdir(os.path.join(self.w.src, ".git")))
        self.assertEqual(self.w.l.record(), {"good": None, "trial": None, "skip": None})
        self.w.fail = set()
        self.w.refresh_to(NEW)
        self.step(Proc(self.w, 75))
        self.assertEqual(self.w.record(), {"good": None, "trial": NEW, "skip": None})
        self.assertNotIn("FACTORY_SKIP_SHA", self.w.spawned[-1][1])

    def test_a_trial_that_can_no_longer_be_checked_out_is_dropped_without_a_skip(self):
        self.w.cloned(OLD)
        self.w.save({"good": OLD, "trial": NEW})
        self.step(Proc(self.w, 1))
        self.assertEqual(self.w.record(), {"good": OLD, "trial": None, "skip": None})
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
        for need in ("../../tools/factory:/app:ro", "factory-dispatcher-data:/state", "FACTORY_DATA_DIR: /state", "read_only: true",
                     "cap_drop:\n      - ALL", "no-new-privileges:true", "mem_limit: 256m", "cpus: 0.5", "- /tmp"):
            self.assertIn(need, c)


if __name__ == "__main__":
    unittest.main()
