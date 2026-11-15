import http.server
import os
import socket
import subprocess
import sys
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "checks.py")
SLUG_PREFIX = "runtime-check-no-such-slug."
NAMES = [
    "liveness",
    "settings-redirect",
    "redeem-404",
    "auth-email-field",
    "published-unknown-slug",
    "engine-health",
]


class Handler(http.server.BaseHTTPRequestHandler):
    broken = None

    def log_message(self, *args):
        pass

    def reply(self, status, body=b"", ctype="application/json", location=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if location:
            self.send_header("Location", location)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        broken = type(self).broken
        host = self.headers.get("Host", "")
        if host.startswith(SLUG_PREFIX):
            self.reply(200 if broken == "published-unknown-slug" else 404, b"gate", "text/html")
        elif self.path == "/api/version":
            if broken == "liveness":
                self.reply(500, b"{}")
            else:
                self.reply(200, b'{"buildSha": "abc123"}')
        elif self.path == "/settings":
            if broken == "settings-redirect":
                self.reply(200, b"ok", "text/html")
            else:
                self.reply(307, b"", "text/html", "/")
        elif self.path == "/redeem":
            self.reply(200 if broken == "redeem-404" else 404, b"x", "text/html")
        elif self.path == "/auth":
            if broken == "auth-email-field":
                self.reply(200, b"<html><input type='text'></html>", "text/html")
            else:
                self.reply(200, b'<html><input type="email" name="e"></html>', "text/html")
        elif self.path == "/health":
            status = "down" if broken == "engine-health" else "ok"
            self.reply(200, ('{"status": "%s"}' % status).encode())
        else:
            self.reply(200, b"home", "text/html")


def serve(server):
    try:
        server.serve_forever()
    except (OSError, ValueError):
        pass


def start_stub():
    for port in range(5300, 5400):
        try:
            server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        except OSError:
            continue
        threading.Thread(target=serve, args=(server,), daemon=True).start()
        return server
    raise RuntimeError("no free port in 5300-5399")


def free_closed_port():
    for port in range(5300, 5400):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    raise RuntimeError("no free port in 5300-5399")


def run(base, *extra):
    proc = subprocess.run(
        [sys.executable, "-I", SCRIPT, base, *extra],
        capture_output=True,
        text=True,
        timeout=60,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    return proc.returncode, lines


class ChecksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = start_stub()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.server_close()

    def setUp(self):
        Handler.broken = None

    def full_args(self):
        return ["--publish-host", "example.test", "--engine-url", self.base]

    def test_all_pass_one_line_each(self):
        code, lines = run(self.base, *self.full_args())
        self.assertEqual(code, 0, lines)
        self.assertEqual(len(lines), 6, lines)
        for line in lines:
            self.assertTrue(line.startswith("PASS "), line)

    def test_without_optional_targets_two_are_skipped_and_exit_is_zero(self):
        code, lines = run(self.base)
        self.assertEqual(code, 0, lines)
        self.assertEqual(sum(x.startswith("PASS ") for x in lines), 4, lines)
        self.assertEqual(sum(x.startswith("SKIP ") for x in lines), 2, lines)

    def test_each_break_fails_only_its_check(self):
        for name in NAMES:
            with self.subTest(check=name):
                Handler.broken = name
                code, lines = run(self.base, *self.full_args())
                self.assertEqual(code, 1, lines)
                fails = [x for x in lines if x.startswith("FAIL ")]
                self.assertEqual(len(fails), 1, lines)
                self.assertEqual(fails[0].split()[1], name, lines)

    def test_nothing_listening_fails_every_check_without_hanging(self):
        port = free_closed_port()
        base = "http://127.0.0.1:%d" % port
        code, lines = run(base, "--publish-host", "example.test", "--engine-url", base, "--deadline", "2")
        self.assertEqual(code, 1, lines)
        self.assertEqual(len(lines), 6, lines)
        for line in lines:
            self.assertTrue(line.startswith("FAIL "), line)


if __name__ == "__main__":
    unittest.main()
