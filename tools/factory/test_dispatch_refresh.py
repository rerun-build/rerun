import contextlib, os, signal, sys, time, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, wf

OLD, NEW, TIP = "a" * 40, "b" * 40, "c" * 40
RUNS = ["api", "repos/o/r/actions/workflows/factory-tools.yml/runs?branch=dev&event=push&status=success&per_page=1"]
COMMITS = ["api", "repos/o/r/commits?sha=%s&path=tools/factory&per_page=1" % TIP]


class Refresh(Base):
    def setUp(self):
        super().setUp()
        self.w.dev_runs = [{"head_sha": TIP}]
        self.w.commits = [{"sha": NEW}]
        self.w.workflows[NEW] = [wf("Factory tools", "cancelled")]

    def env(self, **kw):
        env = {k: v for k, v in os.environ.items() if k not in ("FACTORY_CODE_SHA", "FACTORY_SKIP_SHA")}
        env.update(kw, FACTORY_DATA_DIR=self.dir.name)
        return unittest.mock.patch.dict(os.environ, env, clear=True)

    def asked(self):
        return [c for c in self.w.gh_calls if c[0] == "api" and ("/commits?" in c[1] or "/actions/workflows/" in c[1])]

    def written(self, name="refresh-to"):
        try:
            with open(os.path.join(self.dir.name, name), encoding="utf-8") as f:
                return f.read().strip()
        except FileNotFoundError:
            return None

    def fake_main(self):
        for name, fake in (("settings", lambda: self.cfg), ("make_account", lambda url, key: self.w.account),
                           ("make_gh", lambda tok: self.w.gh), ("read_secret", lambda path: "fake-key")):
            self.addCleanup(setattr, D, name, getattr(D, name))
            setattr(D, name, fake)

    def run_main(self, sleep, code=NEW, handlers=None, once=None, **extra):
        handlers = {} if handlers is None else handlers
        patches = [self.env(FACTORY_CODE_SHA=code, DISPATCH_ACCOUNT_URL="http://account.invalid", **extra),
                   unittest.mock.patch.object(signal, "signal", lambda s, h: handlers.__setitem__(s, h)),
                   unittest.mock.patch.object(time, "sleep", sleep), contextlib.redirect_stdout(self.out)]
        if once:
            patches.append(unittest.mock.patch.object(D.Dispatcher, "once", once))
        with contextlib.ExitStack() as stack:
            for p in patches:
                stack.enter_context(p)
            return D.main(["run"])

    def test_without_a_code_sha_github_is_not_asked_and_nothing_is_written(self):
        with self.env():
            self.tick(20)
        self.assertEqual(self.asked(), [])
        self.assertIsNone(self.written())
        self.assertIsNone(self.written("beat-ok"))
        self.assertIsNone(self.d.refresh_to)

    def test_the_target_is_the_tools_commit_behind_devs_newest_green_run_even_when_its_own_run_was_cancelled(self):
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(9)
            self.assertEqual(self.asked(), [])
            self.assertIsNone(self.d.refresh_to)
            self.tick()
        self.assertEqual(self.asked(), [RUNS, COMMITS])
        self.assertEqual(self.written(), NEW)
        self.assertEqual(self.d.refresh_to, NEW)
        self.assertIn("refresh to %s" % NEW[:7], self.out.getvalue())

    def test_the_mounted_code_marked_app_refreshes_to_the_target(self):
        with self.env(FACTORY_CODE_SHA="app"):
            self.tick(10)
        self.assertEqual(self.d.refresh_to, NEW)

    def test_the_running_or_the_skipped_commit_is_no_refresh_and_no_log_line(self):
        for env in ({"FACTORY_CODE_SHA": NEW}, {"FACTORY_CODE_SHA": OLD, "FACTORY_SKIP_SHA": NEW}):
            with self.subTest(env=env):
                self.close()
                with self.env(**env):
                    self.tick(10)
                self.assertIsNone(self.written())
                self.assertIsNone(self.d.refresh_to)
        self.assertNotIn("refresh check", self.out.getvalue())

    def test_no_green_run_or_no_tools_commit_is_logged_once_and_refreshes_nothing(self):
        self.w.dev_runs = []
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(30)
            self.assertIsNone(self.d.refresh_to)
            self.assertEqual(self.out.getvalue().count("refresh check: no green push run of factory-tools.yml on dev"), 1)
            self.w.dev_runs, self.w.commits = [{"head_sha": TIP}], []
            self.tick(30)
        self.assertEqual(self.out.getvalue().count("refresh check: no tools/factory commit behind %s" % TIP[:7]), 1)
        self.assertIsNone(self.d.refresh_to)
        self.assertIsNone(self.written())

    def test_check_errors_are_logged_once_per_text_and_the_beats_go_on(self):
        gh = self.w.gh

        def failing(args):
            if list(args) == RUNS:
                raise D.Error("gh api repos/o/r/actions failed: exit 1")
            return gh(args)
        self.w.gh = failing
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(30)
            self.assertEqual(self.d.beats, 30)
            self.assertIsNone(self.d.refresh_to)
            self.assertEqual(self.out.getvalue().count("refresh check: gh api repos/o/r/actions failed: exit 1"), 1)
            self.assertEqual(self.written("beat-ok"), "30")
            self.w.gh = gh
            self.w.dev_runs = [{}]
            self.close()
            self.tick(30)
        self.assertEqual(self.out.getvalue().count("refresh check: KeyError"), 1)
        self.assertIsNone(self.written())

    def test_an_id_that_is_not_a_commit_id_is_never_used(self):
        for runs, commits in (([{"head_sha": "x&path=y"}], [{"sha": NEW}]), ([{"head_sha": TIP}], [{"sha": "--upload-pack=x"}])):
            with self.subTest(runs=runs, commits=commits):
                self.close()
                self.w.dev_runs, self.w.commits = runs, commits
                with self.env(FACTORY_CODE_SHA=OLD):
                    self.tick(10)
                self.assertIsNone(self.written())
                self.assertIsNone(self.d.refresh_to)
        self.assertNotIn(["api", "repos/o/r/commits?sha=x&path=y&path=tools/factory&per_page=1"], self.w.gh_calls)
        self.assertIn("refresh check: ValueError", self.out.getvalue())

    def test_beat_ok_carries_the_beat_number_only_after_a_clean_beat(self):
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick()
            self.assertEqual(self.written("beat-ok"), "1")
            self.assertEqual(self.state(), "building")
            with unittest.mock.patch.object(D.Dispatcher, "step", side_effect=D.Error("boom")):
                self.tick(2)
            self.assertEqual(self.written("beat-ok"), "1")
            with unittest.mock.patch.object(D.Dispatcher, "intake", side_effect=ValueError("x")):
                self.tick()
            self.assertEqual(self.written("beat-ok"), "1")
            self.tick()
            self.assertEqual(self.written("beat-ok"), "5")
        self.assertTrue(os.path.exists(self.cfg["heartbeat_file"]))

    def test_beats_where_every_job_raises_write_the_heartbeat_but_never_beat_ok(self):
        with self.env(FACTORY_CODE_SHA=OLD), unittest.mock.patch.object(D.Dispatcher, "step", side_effect=D.Error("boom")):
            self.tick(5)
            self.assertEqual(self.d.beats, 5)
        with open(self.cfg["heartbeat_file"], encoding="utf-8") as f:
            self.assertIn("beat 5 ", f.read())
        self.assertIsNone(self.written("beat-ok"))

    def capped(self, slept, then=None):
        def sleep(s):
            slept.append(s)
            if then:
                then()
            if len(slept) > 2000:
                raise AssertionError("the run loop did not end")
        return sleep

    def test_a_dispatcher_that_starts_behind_the_target_asks_for_it_before_its_first_beat(self):
        self.fake_main()
        slept = []
        self.assertEqual(self.run_main(self.capped(slept), code=OLD), 75)
        self.assertEqual(slept, [])
        self.assertEqual(self.written(), NEW)
        self.assertFalse(os.path.exists(self.cfg["heartbeat_file"]))
        self.assertNotIn("dispatcher started", self.out.getvalue())
        self.assertEqual(self.asked(), [RUNS, COMMITS])

    def test_with_the_start_check_off_the_dispatcher_runs_its_beats_and_asks_only_at_beat_ten(self):
        self.fake_main()
        slept = []
        self.assertEqual(self.run_main(self.capped(slept), code=OLD, FACTORY_START_CHECK="0"), 75)
        self.assertEqual(slept, [1] * 270)
        self.assertEqual(self.asked(), [RUNS, COMMITS])
        self.assertEqual(self.written("beat-ok"), "10")
        self.assertIn("dispatcher started", self.out.getvalue())

    def test_run_exits_75_after_the_tenth_beat_when_the_target_appears_later(self):
        self.fake_main()
        self.w.dev_runs = []
        slept = []
        sleep = self.capped(slept, lambda: setattr(self.w, "dev_runs", [{"head_sha": TIP}]))
        self.assertEqual(self.run_main(sleep, code=OLD), 75)
        self.assertEqual(slept, [1] * 270)
        self.assertEqual(self.written(), NEW)
        self.assertEqual(self.out.getvalue().count("refresh to %s" % NEW[:7]), 1)
        self.assertEqual(self.written("beat-ok"), "10")

    def test_a_stop_signal_during_the_wait_ends_the_run_within_a_second(self):
        self.fake_main()
        handlers, slept = {}, []

        def sleep(s):
            slept.append(s)
            if len(slept) == 5:
                handlers[signal.SIGTERM](signal.SIGTERM, None)
        self.assertEqual(self.run_main(sleep, handlers=handlers), 0)
        self.assertEqual(slept, [1] * 5)
        self.assertEqual(self.written("beat-ok"), "1")

    def test_a_stop_signal_during_a_beat_ends_the_run_at_the_end_of_that_beat_without_waiting(self):
        self.fake_main()
        handlers, slept, beats = {}, [], []
        real = D.Dispatcher.once

        def once(d):
            real(d)
            beats.append(d.beats)
            handlers[signal.SIGTERM](signal.SIGTERM, None)
        self.assertEqual(self.run_main(slept.append, handlers=handlers, once=once), 0)
        self.assertEqual((beats, slept), ([1], []))


if __name__ == "__main__":
    unittest.main()
