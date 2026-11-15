import contextlib, os, signal, sys, time, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, wf

OLD, NEW = "a" * 40, "b" * 40
ASK = ["api", "repos/o/r/commits?sha=dev&path=tools/factory&per_page=1"]


class Refresh(Base):
    def setUp(self):
        super().setUp()
        self.w.commits = [{"sha": NEW}]
        self.w.workflows[NEW] = [wf("Factory tools", "success")]

    def env(self, **kw):
        env = {k: v for k, v in os.environ.items() if k not in ("FACTORY_CODE_SHA", "FACTORY_SKIP_SHA")}
        env.update(kw, FACTORY_DATA_DIR=self.dir.name)
        return unittest.mock.patch.dict(os.environ, env, clear=True)

    def asked(self):
        return [c for c in self.w.gh_calls if c == ASK]

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

    def test_without_a_code_sha_github_is_not_asked_and_nothing_is_written(self):
        with self.env():
            self.tick(20)
        self.assertEqual(self.asked(), [])
        self.assertIsNone(self.written())
        self.assertIsNone(self.written("beat-ok"))
        self.assertIsNone(self.d.refresh_to)

    def test_a_newer_green_commit_is_written_on_the_tenth_beat_and_logged(self):
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(9)
            self.assertEqual(self.asked(), [])
            self.assertIsNone(self.d.refresh_to)
            self.tick()
        self.assertEqual(self.asked(), [ASK])
        self.assertEqual(self.written(), NEW)
        self.assertEqual(self.d.refresh_to, NEW)
        self.assertIn("refresh to %s" % NEW[:7], self.out.getvalue())

    def test_the_mounted_code_marked_app_refreshes_to_the_newest_green_commit(self):
        with self.env(FACTORY_CODE_SHA="app"):
            self.tick(10)
        self.assertEqual(self.d.refresh_to, NEW)

    def test_same_skipped_unfinished_cancelled_failed_other_or_no_runs_do_nothing(self):
        cases = [({"FACTORY_CODE_SHA": NEW}, [wf("Factory tools", "success")]),
                 ({"FACTORY_CODE_SHA": OLD, "FACTORY_SKIP_SHA": NEW}, [wf("Factory tools", "success")]),
                 ({"FACTORY_CODE_SHA": OLD}, [wf("Factory tools", None, status="in_progress")]),
                 ({"FACTORY_CODE_SHA": OLD}, [wf("Factory tools", "cancelled")]),
                 ({"FACTORY_CODE_SHA": OLD}, [wf("Factory tools", "failure")]),
                 ({"FACTORY_CODE_SHA": OLD}, [wf("CI", "success")]),
                 ({"FACTORY_CODE_SHA": OLD}, [])]
        for env, runs in cases:
            with self.subTest(env=env, runs=runs):
                self.close()
                self.w.workflows[NEW] = runs
                with self.env(**env):
                    self.tick(10)
                self.assertIsNone(self.written())
                self.assertIsNone(self.d.refresh_to)
        self.close()
        self.w.commits = []
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(10)
        self.assertIsNone(self.d.refresh_to)

    def test_check_errors_are_logged_once_per_text_and_the_beats_go_on(self):
        gh = self.w.gh

        def failing(args):
            if list(args) == ASK:
                raise D.Error("gh api repos/o/r/commits failed: exit 1")
            return gh(args)
        self.w.gh = failing
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(30)
            self.assertEqual(self.d.beats, 30)
            self.assertIsNone(self.d.refresh_to)
            self.assertEqual(self.out.getvalue().count("refresh check: gh api repos/o/r/commits failed: exit 1"), 1)
            self.assertEqual(self.written("beat-ok"), "30")
            self.w.gh = gh
            self.w.commits = [{}]
            self.close()
            self.tick(30)
        self.assertEqual(self.out.getvalue().count("refresh check: KeyError"), 1)
        self.assertIsNone(self.written())

    def test_a_newest_commit_id_that_is_not_a_commit_id_is_never_written(self):
        self.w.commits = [{"sha": "--upload-pack=x"}]
        with self.env(FACTORY_CODE_SHA=OLD):
            self.tick(10)
        self.assertIsNone(self.written())
        self.assertIsNone(self.d.refresh_to)
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
        self.assertIn("beat 5 ", open(self.cfg["heartbeat_file"], encoding="utf-8").read())
        self.assertIsNone(self.written("beat-ok"))

    def test_run_exits_75_after_the_beat_that_asked_for_a_refresh(self):
        self.fake_main()
        slept = []
        with self.env(FACTORY_CODE_SHA=OLD, DISPATCH_ACCOUNT_URL="http://account.invalid"), \
                unittest.mock.patch.object(signal, "signal"), \
                unittest.mock.patch.object(time, "sleep", slept.append), contextlib.redirect_stdout(self.out):
            self.assertEqual(D.main(["run"]), 75)
        self.assertEqual(slept, [30] * 9)
        self.assertEqual(self.written(), NEW)
        self.assertEqual(self.out.getvalue().count("refresh to %s" % NEW[:7]), 1)

    def test_run_stops_at_the_end_of_a_beat_after_a_stop_signal(self):
        self.fake_main()
        handlers = {}
        beats = []

        def sleep(s):
            beats.append(s)
            handlers[signal.SIGTERM](signal.SIGTERM, None)
        with self.env(FACTORY_CODE_SHA=OLD, DISPATCH_ACCOUNT_URL="http://account.invalid"), \
                unittest.mock.patch.object(signal, "signal", lambda s, h: handlers.__setitem__(s, h)), \
                unittest.mock.patch.object(time, "sleep", sleep), contextlib.redirect_stdout(self.out):
            self.assertEqual(D.main(["run"]), 0)
        self.assertEqual(beats, [30])
        self.assertEqual(self.written("beat-ok"), "1")


if __name__ == "__main__":
    unittest.main()
