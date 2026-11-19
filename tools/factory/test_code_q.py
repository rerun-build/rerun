import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CODE_Q = os.path.join(HERE, "code-q.mjs")

STAND_IN = """#!/usr/bin/env python3
import json, os, sys
with open(os.environ["MARKER"], "w") as f:
    f.write(os.getcwd())
with open(os.environ["MARKER"] + ".daemon", "w") as f:
    f.write(os.environ.get("SYMFORGE_NO_DAEMON", ""))
for line in sys.stdin:
    m = json.loads(line)
    if "id" not in m:
        continue
    if m["method"] == "initialize":
        r = {"protocolVersion": "2024-11-05", "capabilities": {}}
    elif m["method"] == "tools/list":
        r = {"tools": [{"name": "a"}]}
    else:
        r = {"content": [{"type": "text", "text": "stdio answer"}]}
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
"""


class Stub:
    def __init__(self, replies, status=200):
        self.replies = list(replies)
        self.status = status
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("content-length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                outer.requests.append((self.path, dict(self.headers), body))
                if outer.status != 200:
                    data = b"Unauthorized: missing or invalid Bearer token"
                    self.send_response(outer.status)
                    self.send_header("content-type", "text/plain")
                else:
                    reply = outer.replies.pop(0) if len(outer.replies) > 1 else outer.replies[0]
                    data = json.dumps({"jsonrpc": "2.0", "id": body.get("id"), "result": reply}).encode()
                    self.send_response(200)
                    self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d/mcp" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def text(t):
    return {"content": [{"type": "text", "text": t}]}


@unittest.skipIf(shutil.which("node") is None, "no node")
class CodeQ(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.marker = os.path.join(self.tmp, "marker")
        self.stand_in = os.path.join(self.tmp, "symforge")
        with open(self.stand_in, "w") as f:
            f.write(STAND_IN)
        os.chmod(self.stand_in, 0o755)
        self.checkouts = os.path.join(self.tmp, "repos")
        os.makedirs(os.path.join(self.checkouts, "r1"))
        self.key = os.path.join(self.tmp, "key")
        with open(self.key, "w") as f:
            f.write("k1\n")

    def run_q(self, servers, *args):
        cfg = os.path.join(self.tmp, "cfg.json")
        with open(cfg, "w") as f:
            json.dump({"symforge": self.stand_in, "checkouts": self.checkouts, "keyFile": self.key, "servers": servers}, f)
        env = dict(os.environ, CODE_Q_CONFIG=cfg, CODE_Q_RETRY_MS="10", MARKER=self.marker)
        env.pop("SYMFORGE_NO_DAEMON", None)
        return subprocess.run(["node", CODE_Q, *args], capture_output=True, text=True, env=env, timeout=60)

    def stub(self, *a, **k):
        s = Stub(*a, **k)
        self.addCleanup(s.close)
        return s

    def test_asks_the_configured_server_with_the_key(self):
        s = self.stub([text("served")])
        r = self.run_q({"r1": s.url}, "r1", "search_text", '{"query": "x"}')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "served")
        self.assertEqual(len(s.requests), 1)
        path, headers, body = s.requests[0]
        self.assertEqual(path, "/mcp")
        self.assertEqual(headers["authorization"], "Bearer k1")
        self.assertEqual(body["method"], "tools/call")
        self.assertEqual(body["params"], {"name": "search_text", "arguments": {"query": "x"}})
        self.assertFalse(os.path.exists(self.marker))

    def test_waits_while_the_server_loads(self):
        s = self.stub([text("Index is loading"), text("ok")])
        r = self.run_q({"r1": s.url}, "r1", "search_text")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "ok")
        self.assertEqual(len(s.requests), 2)

    def test_falls_back_and_says_so_when_the_server_is_down(self):
        s = Stub([text("x")])
        url = s.url
        s.close()
        r = self.run_q({"r1": url}, "r1", "search_text")
        self.assertIn("code-q: the server for r1 did not answer; asking a one-off symforge instead", r.stderr.splitlines())
        self.assertEqual(r.stdout.strip(), "stdio answer")
        with open(self.marker) as f:
            self.assertEqual(os.path.realpath(f.read()), os.path.realpath(os.path.join(self.checkouts, "r1")))

    def test_no_server_configured_falls_back_and_says_so(self):
        r = self.run_q({}, "r1", "search_text")
        self.assertIn("code-q: no server for r1; asking a one-off symforge instead", r.stderr.splitlines())
        self.assertEqual(r.stdout.strip(), "stdio answer")

    def test_the_one_off_symforge_starts_no_daemon(self):
        r = self.run_q({}, "r1", "search_text")
        self.assertEqual(r.stdout.strip(), "stdio answer")
        with open(self.marker + ".daemon") as f:
            self.assertEqual(f.read(), "1")

    def test_refused_key_exits_1_without_fallback(self):
        s = self.stub([text("x")], status=401)
        r = self.run_q({"r1": s.url}, "r1", "search_text")
        self.assertEqual(r.returncode, 1)
        self.assertIn("code-q: the server for r1 refused the key", r.stderr.splitlines())
        self.assertFalse(os.path.exists(self.marker))

    def test_index_folder_is_never_sent(self):
        s = self.stub([text("x")])
        r = self.run_q({"r1": s.url}, "r1", "index_folder", "{}")
        self.assertEqual(r.returncode, 2)
        self.assertIn("code-q: index_folder is not allowed", r.stderr.splitlines())
        self.assertEqual(s.requests, [])
        self.assertFalse(os.path.exists(self.marker))

    def test_list_over_http(self):
        s = self.stub([{"tools": [{"name": "a"}, {"name": "bb"}, {"name": "ccc"}]}])
        r = self.run_q({"r1": s.url}, "r1", "--list")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.splitlines()[0].startswith("3 tools,"))
        self.assertEqual(s.requests[0][2]["method"], "tools/list")

    def test_usage_exits_2(self):
        r = self.run_q({}, "r1")
        self.assertEqual(r.returncode, 2)

    def test_extra_arguments_exit_2_with_usage(self):
        for args in (("r1", "--list", "x"), ("r1", "t", "{}", "extra"), ("r1", "t", "{}", "a", "b")):
            r = self.run_q({}, *args)
            self.assertEqual(r.returncode, 2, args)
            self.assertIn("usage:", r.stderr)

    def test_install_copies_code_q(self):
        if sys.platform == "win32" or shutil.which("sh") is None:
            self.skipTest("no sh")
        prefix = os.path.join(self.tmp, "prefix")
        subprocess.run(["sh", os.path.join(HERE, "install.sh"), "--prefix", prefix, "--jev-keyfile", "/x"], check=True, capture_output=True)
        self.assertTrue(os.path.exists(os.path.join(prefix, "factory", "code-q.mjs")))
        with open(os.path.join(prefix, "bin", "code-q")) as f:
            self.assertIn(os.path.join(os.path.realpath(prefix), "factory", "code-q.mjs"), f.read())


if __name__ == "__main__":
    unittest.main()
