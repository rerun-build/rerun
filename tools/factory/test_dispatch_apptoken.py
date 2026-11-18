import os
import tempfile
import time
import unittest

import apptoken
import dispatch as D


class Proc:
    def __init__(self, rc=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = rc, out, err


class TokenPerCall(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.app = os.path.join(self.dir.name, "token")
        self.seen = []

    def tearDown(self):
        self.dir.cleanup()

    def run_(self, argv, **kw):
        self.seen.append(kw["env"]["GH_TOKEN"])
        return Proc(out="ok")

    def test_each_call_reads_the_token_again(self):
        tokens = iter(["one", "two"])
        gh = D.make_gh(lambda: next(tokens), self.run_)
        gh(["issue", "view", "5"])
        gh(["issue", "view", "6"])
        self.assertEqual(self.seen, ["one", "two"])

    def test_a_plain_token_still_works(self):
        D.make_gh("plain", self.run_)(["issue", "view", "5"])
        self.assertEqual(self.seen, ["plain"])

    def test_the_app_token_is_used_while_valid_and_the_key_file_after(self):
        token = D.token_source(self.app, lambda: "shared", lambda: 1000)
        self.assertEqual(token(), "shared")
        apptoken.write(self.app, "ghs_app", 1000 + 3600)
        self.assertEqual(token(), "ghs_app")
        later = D.token_source(self.app, lambda: "shared", lambda: 1000 + 3500)
        self.assertEqual(later(), "shared")

    def test_a_failed_call_never_names_the_token_of_that_call(self):
        gh = D.make_gh(lambda: "ghs_live", lambda argv, **kw: Proc(1, "", "bad credentials ghs_live"))
        with self.assertRaises(D.Error) as e:
            gh(["issue", "view", "5"])
        self.assertNotIn("ghs_live", str(e.exception))

    def test_a_refused_app_call_that_wrote_nothing_runs_once_more_with_the_shared_key(self):
        procs = iter([Proc(1, "", "HTTP 403: Resource not accessible by integration"), Proc(0, "done")])

        def run(argv, **kw):
            self.seen.append(kw["env"]["GH_TOKEN"])
            return next(procs)

        gh = D.make_gh(lambda: "ghs_app", run, shared=lambda: "shared")
        self.assertEqual(gh(["api", "-X", "PATCH", "x"]), "done")
        self.assertEqual(self.seen, ["ghs_app", "shared"])

    def test_an_app_call_that_wrote_something_is_not_repeated(self):
        def run(argv, **kw):
            self.seen.append(kw["env"]["GH_TOKEN"])
            return Proc(1, "https://github.com/o/r/pull/7", "HTTP 403: Resource not accessible by integration")

        with self.assertRaises(D.Error):
            D.make_gh(lambda: "ghs_app", run, shared=lambda: "shared")(["pr", "create"])
        self.assertEqual(self.seen, ["ghs_app"])

    def test_a_call_already_on_the_shared_key_is_not_repeated(self):
        def run(argv, **kw):
            self.seen.append(kw["env"]["GH_TOKEN"])
            return Proc(1, "", "HTTP 404: Not Found")

        with self.assertRaises(D.Error):
            D.make_gh(lambda: "shared", run, shared=lambda: "shared")(["issue", "view", "5"])
        self.assertEqual(self.seen, ["shared"])

    def test_the_token_source_brings_its_shared_key_as_the_fallback(self):
        procs = iter([Proc(1, "", "HTTP 404: Not Found"), Proc(0, "done")])

        def run(argv, **kw):
            self.seen.append(kw["env"]["GH_TOKEN"])
            return next(procs)

        apptoken.write(self.app, "ghs_app", time.time() + 3600)
        gh = D.make_gh(D.token_source(self.app, lambda: "shared"), run)
        self.assertEqual(gh(["issue", "view", "5"]), "done")
        self.assertEqual(self.seen, ["ghs_app", "shared"])

    def test_the_real_clock_is_the_default(self):
        apptoken.write(self.app, "ghs_app", time.time() + 3600)
        self.assertEqual(D.token_source(self.app, lambda: "shared")(), "ghs_app")


if __name__ == "__main__":
    unittest.main()
