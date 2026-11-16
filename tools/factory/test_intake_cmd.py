import base64, os, sys, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_loop as R
import ghclient
import store
from test_intake import OK1, OK2, plan

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json"), encoding="utf-8") as f:
    ROSTER = f.read()
LARRY = OK2.replace("builder: code", "builder: larry")


class FakeGh:
    def issue(self, n): return {"title": "rerun#%d" % n, "body": "goal", "author_association": "OWNER"}
    def comments(self, n): return [{"body": plan(OK1, OK2), "author_association": "MEMBER"}]
    def branch_sha(self, b): return "sha-of-" + b
    def get(self, path): raise ghclient.GhError("GET failed: HTTP 404", 404)


class IntakeCmd(unittest.TestCase):
    def test_issue_becomes_job_with_base_sha(self):
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            state, errors = R.intake_issue(st, FakeGh(), "o/r", 71)
            kv = st.get_all("71")
            self.assertEqual((errors, sorted(state["chunks"])), ([], ["A1", "A2"]))
            self.assertEqual((kv["base"], kv["base_branch"], kv["title"], kv["repo_url"]),
                             ("sha-of-dev", "dev", "rerun#71", "https://github.com/o/r"))
            self.assertEqual(len(st.ready_list("71")), 2)
            st.close()

    def test_no_plan_stores_no_base(self):
        gh = FakeGh(); gh.comments = lambda n: []
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            self.assertIsNone(R.intake_issue(st, gh, "o/r", 71)[0])
            self.assertEqual(st.get_all("71"), {})
            st.close()

    def test_stranger_comment_adds_no_chunk(self):
        gh = FakeGh(); gh.comments = lambda n: [{"body": plan(OK1), "author_association": "NONE", "user": {"login": "x"}}]
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            self.assertIsNone(R.intake_issue(st, gh, "o/r", 71)[0])
            st.close()

    def test_branch_sha_error_exits_1_and_stores_no_job(self):
        class Down(FakeGh):
            def branch_sha(self, b): raise ghclient.GhError("down")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.db")
            with mock.patch.object(R.GH, "Client", lambda *a: Down()), mock.patch.object(R.T, "load_config", lambda: {}), \
                    mock.patch.object(R, "store_path", lambda cfg: path):
                self.assertEqual(R.main(["intake", "o/r#71"]), 1)
            st = store.Store(path)
            self.assertEqual((st.get_all("71"), st.ready_list("71")), ({}, []))
            st.close()

    def test_dev_roster_refuses_a_wrong_builder(self):
        paths = []
        gh = FakeGh()
        gh.comments = lambda n: [{"body": plan(OK1, LARRY), "author_association": "MEMBER"}]

        def get(path):
            paths.append(path)
            return {"content": base64.b64encode(ROSTER.encode("utf-8")).decode("ascii"), "encoding": "base64"}
        gh.get = get
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            state, errors = R.intake_issue(st, gh, "o/r", 71)
            self.assertEqual(sorted(state["chunks"]), ["A1"])
            self.assertEqual(errors, ["A2: builder larry, the map gives code; use code or add builder-why"])
            self.assertEqual(paths, ["/contents/tools/factory/roster.json?ref=dev"])
            st.close()

    def test_no_roster_on_dev_keeps_every_builder(self):
        gh = FakeGh()
        gh.comments = lambda n: [{"body": plan(OK1, LARRY), "author_association": "MEMBER"}]
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            state, errors = R.intake_issue(st, gh, "o/r", 71)
            self.assertEqual(sorted(state["chunks"]), ["A1", "A2"])
            st.close()

    def test_roster_read_error_stores_no_job(self):
        gh = FakeGh()

        def get(path): raise ghclient.GhError("GET failed: HTTP 500", 500)
        gh.get = get
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            with self.assertRaises(ghclient.GhError):
                R.intake_issue(st, gh, "o/r", 71)
            self.assertEqual((st.get_all("71"), st.ready_list("71")), ({}, []))
            st.close()


if __name__ == "__main__":
    unittest.main()
