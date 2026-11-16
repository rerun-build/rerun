import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

from test_code_q import CODE_Q, Stub, text

READY = "Status: Ready\nFiles:  4789 indexed (4712 parsed, 77 partial, 0 failed)"
READY_LINE = "alpha up ready 4789 files fetched 2h ago"


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

    def status(self, servers):
        cfg = os.path.join(self.tmp, "cfg.json")
        with open(cfg, "w") as f:
            json.dump({"servers": servers, "checkouts": self.checkouts, "keyFile": self.key}, f)
        env = dict(os.environ, CODE_Q_CONFIG=cfg)
        p = subprocess.run(["node", CODE_Q, "--status"], env=env, capture_output=True, text=True, timeout=60)
        return p.returncode, p.stdout.splitlines()

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
