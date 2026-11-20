import os, sys, tempfile, unittest
from types import SimpleNamespace as NS
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_loop as R
import ghclient as GH
import store as S
from test_ready_start import Eng

T0 = 1_800_000_000.0
WAKES = ["wake-jez", "wake-margaret", "wake-changelog", "wake-dana", "wake-issue-triage"]


class FakeRepo:
    def __init__(self):
        self.fail = False
        self.since = []

    def branch_sha(self, b):
        if self.fail:
            raise GH.GhError("GET /git/ref/heads/%s failed: HTTP 502" % b, 502)
        return b + "-sha"

    def checks(self, sha):
        return [{"name": "ci", "status": "completed", "conclusion": "failure" if sha == "dev-sha" else "success"}]

    def merged_prs(self, base, since):
        self.since.append(since)
        if base == "main":
            return [{"number": 44, "base": "main", "sha": "m44", "files": ["c.py"]}]
        return [{"number": 40, "base": "dev", "sha": "m40", "files": ["tools/factory/wake.py"]}]

    def issues_since(self, since):
        return [{"number": 50}]


class RepoWake(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        path = os.path.join(self.d.name, "l.db")
        self.store = S.Store(path)
        self.fake = FakeRepo()
        self.now = T0
        self.cfg = {"triggers": [], "store_file": path}
        self.r = R.Runner(None, self.store, self.cfg, {}, clock=lambda: self.now, repo=self.fake)

    def tearDown(self):
        self.store.close()
        self.d.cleanup()

    def look(self, at):
        self.now = at
        self.r.see_repo()

    def queued(self):
        return [q["stage"] for q in self.store.queued(R.iso(self.now + 1))]

    def cursor(self):
        return self.store.get_all("-").get("repo_since")

    def test_first_look_sets_the_cursor_and_wakes_nobody(self):
        self.look(T0)
        self.assertEqual(self.queued(), [])
        self.assertEqual(self.fake.since, [])
        self.assertEqual(self.cursor(), R.iso(T0))

    def test_second_look_queues_one_stage_per_wake(self):
        self.look(T0)
        self.look(T0 + 30)
        self.assertEqual(self.queued(), WAKES)
        self.assertEqual(self.fake.since, [R.iso(T0)] * 2)
        self.assertEqual(self.cursor(), R.iso(T0 + 30))
        self.assertEqual(self.store.queued(R.iso(self.now + 1))[0]["job"], "wake:ci-red:dev:dev-sha")

    def test_same_events_later_queue_nothing_more(self):
        for i in range(3):
            self.look(T0 + 30 * i)
        self.assertEqual(len(self.queued()), 5)

    def test_later_looks_read_back_five_minutes(self):
        for t in (T0, T0 + 600, T0 + 1200):
            self.look(t)
        self.assertEqual(self.fake.since, [R.iso(T0)] * 2 + [R.iso(T0 + 300)] * 2)

    def test_long_gap_reads_back_six_hours_at_most(self):
        self.look(T0)
        self.look(T0 + 7 * 3600)
        self.assertEqual(self.fake.since, [R.iso(T0 + 3600)] * 2)

    def test_read_failure_keeps_the_cursor(self):
        self.look(T0)
        self.fake.fail = True
        self.look(T0 + 30)
        self.assertEqual(self.queued(), [])
        self.assertEqual(self.cursor(), R.iso(T0))

    def test_stop_while_queueing_leaves_no_half_claimed_wake(self):
        self.look(T0)
        real = self.store.enqueue
        calls = []

        def boom(*a, **k):
            calls.append(a)
            if len(calls) == 3:
                raise RuntimeError("killed")
            return real(*a, **k)

        self.store.enqueue = boom
        with self.assertRaises(RuntimeError):
            self.look(T0 + 30)
        self.assertEqual(self.queued(), [])
        self.assertEqual(self.cursor(), R.iso(T0))
        self.store.enqueue = real
        self.look(T0 + 60)
        self.assertEqual(self.queued(), WAKES)

    def test_tick_looks_at_the_repository(self):
        self.now = T0
        self.r.tick()
        self.now = T0 + 30
        self.r.tick()
        self.assertEqual(self.fake.since, [R.iso(T0)] * 2)

    def test_no_repo_means_no_reads(self):
        r = R.Runner(None, self.store, self.cfg, {}, clock=lambda: self.now)
        r.see_repo()
        self.assertEqual(self.store.get_all("-"), {})


class BuildWiring(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.gh = NS(open_pr=lambda *a: None, get=lambda p: None, pr_by_head=lambda b: None)
        self.cfg = {"poll_s": 30, "run_limit_s": 600, "stall_s": 0, "token_file": os.path.join(self.d.name, "t.json"),
                    "store_file": os.path.join(self.d.name, "l.db"), "triggers": []}
        self.r = None

    def tearDown(self):
        if self.r:
            self.r.st.close()
        self.d.cleanup()

    def test_build_hands_the_client_over_when_repo_events_is_on(self):
        self.r = R.build(self.cfg | {"repo_events": True}, Eng(), clock=lambda: T0, gh=self.gh)
        self.assertIs(self.r.repo, self.gh)

    def test_build_reads_nothing_without_repo_events(self):
        self.r = R.build(self.cfg, Eng(), clock=lambda: T0, gh=self.gh)
        self.assertIsNone(self.r.repo)


if __name__ == "__main__":
    unittest.main()
