import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

from test_code_q import CODE_Q, Stub, text

READY = "Status: Ready\nFiles:  4789 indexed (4712 parsed, 77 partial, 0 failed)\nWatcher: active (idle; event-driven, waiting for filesystem changes, debounce: 200ms)"
READY_LINE = "alpha up ready 4789 files watching fetched 2h ago"


@unittest.skipIf(shutil.which("node") is None, "no node")
class CodeQStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.checkouts = os.path.join(self.tmp, "checkouts")
        self.key = os.path.join(self.tmp, "key")
        with open(self.key, "w") as f:
            f.write("k\n")
        self.stubs = []

    def stub(self, replies, status=200):
        s = Stub(replies, status)
        self.addCleanup(s.close)
        self.stubs.append(s)
        return s

    def fetched(self, repo, age):
        git = os.path.join(self.checkouts, repo, ".git")
        os.makedirs(git)
        path = os.path.join(git, "FETCH_HEAD")
        open(path, "w").close()
        t = time.time() - age
        os.utime(path, (t, t))

    def status_run(self, servers, key_file):
        cfg = os.path.join(self.tmp, "cfg.json")
        with open(cfg, "w") as f:
            json.dump({"servers": servers, "checkouts": self.checkouts, "keyFile": key_file}, f)
        env = dict(os.environ, CODE_Q_CONFIG=cfg)
        return subprocess.run(["node", CODE_Q, "--status"], env=env, capture_output=True, text=True, timeout=60)

    def status(self, servers):
        p = self.status_run(servers, self.key)
        return p.returncode, p.stdout.splitlines()

    def test_unreadable_key_is_one_line(self):
        for key_file in (os.path.join(self.tmp, "missing"), self.tmp):
            with self.subTest(key_file=key_file):
                s = self.stub([text(READY)])
                p = self.status_run({"alpha": s.url}, key_file)
                self.assertEqual(p.stderr.splitlines(), ["code-q: cannot read the key file %s" % key_file])
                self.assertEqual(p.stdout, "")
                self.assertEqual(p.returncode, 1)
                self.assertEqual(s.requests, [])

    def test_ready_line_with_files_and_fetch_age(self):
        s = self.stub([text(READY)])
        self.fetched("alpha", 7300)
        code, lines = self.status({"alpha": s.url})
        self.assertEqual(lines, [READY_LINE])
        self.assertEqual(code, 0)

    def test_down_server_does_not_hide_the_others(self):
        s = self.stub([text(READY)])
        dead = self.stub([text(READY)])
        dead_url = dead.url
        dead.close()
        self.fetched("alpha", 7300)
        code, lines = self.status({"alpha": s.url, "beta": dead_url})
        self.assertEqual(lines, [READY_LINE, "beta down"])
        self.assertEqual(code, 1)

    def test_watcher_states(self):
        base = "Status: Ready\nFiles:  4789 indexed (4712 parsed, 77 partial, 0 failed)\n"
        self.fetched("alpha", 7300)
        cases = [
            ("Watcher: degraded (event stream failed after 3 processed events, overflows: 0, reconcile repairs: 0)", (1, ["alpha up ready 4789 files not watching fetched 2h ago"])),
            ("Watcher: local-fallback (no watcher attached; daemon proxy unavailable)", (1, ["alpha up ready 4789 files not watching fetched 2h ago"])),
            ("Watcher: off", (1, ["alpha up ready 4789 files not watching fetched 2h ago"])),
            ("Watcher: starting (registering filesystem watch; index will stay fresh once the watch is registered)", (1, ["alpha up loading"])),
            ("", (0, ["alpha up ready 4789 files watching unknown fetched 2h ago"])),
        ]
        for w, expected in cases:
            with self.subTest(watcher=w):
                s = self.stub([text(base + w)])
                self.assertEqual(self.status({"alpha": s.url}), expected)

    def test_loading_and_refused_key(self):
        a = self.stub([text("Index is loading, try again")])
        b = self.stub([], status=401)
        code, lines = self.status({"alpha": a.url, "beta": b.url})
        self.assertEqual(lines, ["alpha up loading", "beta up key refused"])
        self.assertEqual(code, 1)

    def test_never_fetched(self):
        s = self.stub([text(READY)])
        code, lines = self.status({"alpha": s.url})
        self.assertTrue(lines[0].endswith("fetched never"), lines)

    def test_status_sends_only_health(self):
        s = self.stub([text(READY)])
        self.status({"alpha": s.url})
        self.assertTrue(s.requests)
        for _, _, body in s.requests:
            self.assertEqual(body["params"]["name"], "health")

    def test_no_servers(self):
        code, lines = self.status({})
        self.assertEqual(lines, ["code-q: no servers configured"])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
