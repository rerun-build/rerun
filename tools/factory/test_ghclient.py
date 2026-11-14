import contextlib, io, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakegh, ghclient

SECRET = "s3cr3t-token-value"


class Base(unittest.TestCase):
    def setUp(self):
        self.f = fakegh.Fake(issues={71: {"number": 71, "title": "m3"}}, comments={71: [{"id": i} for i in range(5)]})
        self.f.start()
        os.environ["GH_TEST_TOKEN"] = SECRET
        self.c = ghclient.Client(self.f.url, "o/r", token_env="GH_TEST_TOKEN")

    def tearDown(self):
        self.f.stop()
        os.environ.pop("GH_TEST_TOKEN", None)


class Core(Base):
    def test_token_not_leaked(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.c.get("/issues/71")
            with self.assertRaises(ghclient.GhError) as cm:
                self.c.get("/issues/999")
        self.assertEqual(self.f.calls[0][3], "token " + SECRET)
        self.assertEqual(cm.exception.status, 404)
        for text in (out.getvalue(), err.getvalue(), str(cm.exception), repr(cm.exception), repr(self.c)):
            self.assertNotIn(SECRET, text)

    def test_pagination_follows_link(self):
        self.assertEqual([x["id"] for x in self.c.pages("/issues/71/comments", per_page=2)], [0, 1, 2, 3, 4])
        self.assertEqual(len([c for c in self.f.calls if c[1].endswith("/comments")]), 3)


class Calls(Base):
    def setUp(self):
        super().setUp()
        self.f.commits["abc"] = {"sha": "abc"}
        self.f.statuses["abc"] = [{"state": "success"}]
        self.f.checks["abc"] = {"check_runs": [{"name": "ci"}]}

    def test_calls_hit_fake(self):
        c = self.c
        self.assertEqual(c.issue(71)["title"], "m3")
        self.assertEqual(len(c.comments(71, per_page=2)), 5)
        self.assertEqual(c.commit("abc")["sha"], "abc")
        self.assertEqual(c.statuses("abc")[0]["state"], "success")
        self.assertEqual(c.checks("abc")[0]["name"], "ci")
        self.assertEqual(c.open_pr("t", "b", "dev", "body")["number"], 72)
        self.assertEqual(c.create_issue("x", "y")["number"], 73)
        self.assertEqual(self.f.calls[-2][:3], ("POST", "/repos/o/r/pulls", {"title": "t", "head": "b", "base": "dev", "body": "body"}))
        self.assertEqual(self.f.calls[-1][2], {"title": "x", "body": "y"})
        self.assertTrue(all(x[3] == "token " + SECRET for x in self.f.calls))
        c._open = lambda m, u, b=None: ([1], '<http://other.example/x>; rel="next"')
        self.assertEqual(list(c.pages("/x")), [1])
