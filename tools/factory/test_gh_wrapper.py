import os
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.join(HERE, "bin", "gh")
FAKE = """#!/bin/sh
echo "$GH_TOKEN $*" >> "$LOG"
if [ "$GH_TOKEN" = app ] && [ -n "$APP_WROTE" ]; then echo "$APP_WROTE"; fi
if [ "$GH_TOKEN" = app ] && [ -n "$APP_FAILS" ]; then echo "$APP_FAILS" >&2; exit 1; fi
if [ "$1" = read ]; then cat; fi
echo "ok $GH_TOKEN"
"""


class Wrapper(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = self.dir.name
        self.key, self.app, self.real, self.log = (os.path.join(d, n) for n in ("key", "app", "gh", "log"))
        with open(self.key, "w") as f:
            f.write("shared\r\n")
        with open(self.real, "w") as f:
            f.write(FAKE)
        os.chmod(self.real, 0o755)

    def tearDown(self):
        self.dir.cleanup()

    def app_token(self, until):
        with open(self.app, "w") as f:
            f.write("app\n%d\n" % until)

    def run_gh(self, *args, fails="", stdin="", wrote="", dispatcher="1"):
        env = dict(os.environ, FACTORY_GH_KEY=self.key, FACTORY_GH_APP=self.app, FACTORY_GH_REAL=self.real,
                   LOG=self.log, APP_FAILS=fails, APP_WROTE=wrote)
        if dispatcher is None:
            env.pop("FACTORY_DISPATCHER", None)
        else:
            env["FACTORY_DISPATCHER"] = dispatcher
        return subprocess.run(["sh", WRAPPER] + list(args), input=stdin, capture_output=True, text=True, env=env)

    def calls(self):
        with open(self.log) as f:
            return [line.split(" ")[0] for line in f.read().splitlines()]

    def test_without_an_app_token_the_shared_key_is_used_as_before(self):
        p = self.run_gh("issue", "view", "5")
        self.assertEqual((p.returncode, p.stdout), (0, "ok shared\n"))
        self.assertEqual(self.calls(), ["shared"])

    def test_a_valid_app_token_is_used_first(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("pr", "create")
        self.assertEqual((p.returncode, p.stdout), (0, "ok app\n"))
        self.assertEqual(self.calls(), ["app"])

    def test_an_app_token_close_to_its_expiry_is_not_used(self):
        self.app_token(time.time() + 200)
        self.run_gh("issue", "view", "5")
        self.assertEqual(self.calls(), ["shared"])

    def test_a_repo_the_app_cannot_reach_falls_back_to_the_shared_key(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("issue", "view", "5", "-R", "other/repo", fails="GraphQL: Could not resolve to a Repository with the name 'other/repo'.")
        self.assertEqual((p.returncode, p.stdout), (0, "ok shared\n"))
        self.assertEqual(self.calls(), ["app", "shared"])

    def test_the_app_hitting_its_limit_falls_back_to_the_shared_key(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("pr", "create", fails="pull request create failed: GraphQL: was submitted too quickly (createPullRequest)")
        self.assertEqual(p.stdout, "ok shared\n")

    def test_any_other_failure_is_reported_as_it_is(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("pr", "merge", "5", fails="X Pull request is not mergeable")
        self.assertEqual((p.returncode, p.stderr.strip()), (1, "X Pull request is not mergeable"))
        self.assertEqual(self.calls(), ["app"])

    def test_input_from_a_dash_reaches_the_retry_too(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("read", "-", fails="HTTP 403: Resource not accessible by integration", stdin="body text\n")
        self.assertEqual(p.stdout, "body text\nok shared\n")

    def test_every_form_of_stdin_reaches_gh_with_the_app_token(self):
        self.app_token(time.time() + 3600)
        for form in (["--body-file=-"], ["-F", "body=@-"], ["--input", "-"], ["--body-file", "-"]):
            p = self.run_gh("read", *form, stdin="plan text\n")
            self.assertEqual(p.stdout, "plan text\nok app\n", form)

    def test_stdin_with_no_dash_form_still_reaches_gh(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("read", stdin="piped\n")
        self.assertEqual(p.stdout, "piped\nok app\n")

    def test_a_run_that_already_wrote_is_never_repeated(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("pr", "create", wrote="https://github.com/o/r/pull/7",
                        fails="HTTP 403: Resource not accessible by integration (requestReviews)")
        self.assertEqual((p.returncode, p.stdout), (1, "https://github.com/o/r/pull/7\n"))
        self.assertIn("requestReviews", p.stderr)
        self.assertEqual(self.calls(), ["app"])

    def test_a_fallback_says_so_on_stderr(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("issue", "view", "5", fails="HTTP 404: Not Found")
        self.assertIn("used the shared key", p.stderr)

    def test_gh_auth_stays_refused(self):
        self.app_token(time.time() + 3600)
        p = self.run_gh("auth", "token")
        self.assertEqual(p.returncode, 64)
        self.assertFalse(os.path.exists(self.log))

    def test_no_key_file_stops_before_anything_runs(self):
        os.remove(self.key)
        self.assertEqual(self.run_gh("issue", "view", "5").returncode, 78)

    def test_non_dispatcher_cannot_merge_pull_requests(self):
        self.app_token(time.time() + 3600)
        for args in (["pr", "merge", "5"], ["api", "-X", "PUT", "repos/o/r/pulls/5/merge"]):
            p = self.run_gh(*args, dispatcher=None)
            self.assertEqual(p.returncode, 64, args)
            self.assertIn("factory dispatcher", p.stderr)
        self.assertFalse(os.path.exists(self.log))


if __name__ == "__main__":
    unittest.main()
