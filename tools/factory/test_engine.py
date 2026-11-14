#!/usr/bin/env python3
import contextlib, io, json, os, sys, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine

KEY = "k-secret-0123456789abcdef"
SEEN = []
RUNS = {"r1": {"id": "r1", "status": "running"}, "r2": {"id": "r2", "status": "error"}}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _handle(self):
        SEEN.append((self.command, self.path, self.headers.get("Authorization")))
        if self.headers.get("Authorization") != "Bearer " + KEY:
            return self._send(401, {"error": "unauthorized " + KEY})
        path, _, query = self.path.partition("?")
        p = path.strip("/").split("/")
        if p[:1] != ["agents"] or len(p) < 3 or p[2] != "runs":
            return self._send(404, {"error": "no"})
        if len(p) == 3 and self.command == "GET":
            rows = [r for r in RUNS.values() if "status=" not in query or "status=" + r["status"] in query]
            return self._send(200, {"runs": rows})
        rid = p[3]
        if rid == "bad":
            return self._send(200, b"not json")
        if rid == "boom":
            return self._send(500, {"error": "leak " + KEY})
        if rid not in RUNS:
            return self._send(404, {"error": "run not found"})
        if len(p) == 4 and self.command == "GET":
            return self._send(200, RUNS[rid])
        if len(p) == 5 and p[4] == "steps":
            return self._send(200, {"steps": [{"n": 1, "inputTokens": 5}]})
        if len(p) == 5 and p[4] == "cancel" and self.command == "POST":
            return self._send(200, {"ok": True, "aborted": True})
        self._send(404, {"error": "no"})

    do_GET = do_POST = _handle


class EngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d" % cls.srv.server_port

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        del SEEN[:]
        self.e = engine.Engine(self.url, KEY)

    def test_list_filters_and_bearer(self):
        self.assertEqual([r["id"] for r in self.e.list_runs("a1", status="error")], ["r2"])
        self.assertEqual(len(self.e.list_runs("a1")), 2)
        self.assertEqual(SEEN[0][2], "Bearer " + KEY)
        self.assertIn("status=error", SEEN[0][1])

    def test_get_steps_cancel(self):
        self.assertEqual(self.e.get_run("a1", "r1")["status"], "running")
        self.assertIsNone(self.e.get_run("a1", "nope"))
        self.assertEqual(self.e.run_steps("a1", "r1")[0]["n"], 1)
        self.assertTrue(self.e.cancel("a1", "r1"))
        self.assertEqual(SEEN[-1][:2], ("POST", "/agents/a1/runs/r1/cancel"))

    def test_errors_carry_status_only(self):
        calls = (lambda: self.e.get_run("a1", "boom"), lambda: self.e.get_run("a1", "bad"),
                 lambda: engine.Engine(self.url, "wrong").list_runs("a1"),
                 lambda: engine.Engine("http://127.0.0.1:1", KEY).list_runs("a1"))
        for call in calls:
            with self.assertRaises(engine.EngineError) as cm:
                call()
            self.assertNotIn(KEY, str(cm.exception))
        with self.assertRaises(engine.EngineError) as cm:
            self.e.get_run("a1", "boom")
        self.assertIn("HTTP 500", str(cm.exception))

    def test_ids_are_quoted(self):
        self.e.get_run("a/../x", "r1")
        self.assertTrue(SEEN[0][1].startswith("/agents/a%2F..%2Fx/runs/r1"))

    def test_env_and_missing(self):
        with self.assertRaises(engine.EngineError):
            engine.Engine(self.url, "")
        with self.assertRaises(engine.EngineError):
            engine.Engine("", KEY)
        old = dict(os.environ)
        try:
            os.environ[engine.URL_ENV], os.environ[engine.KEY_ENV] = self.url, KEY
            self.assertEqual(len(engine.Engine().list_runs("a1")), 2)
        finally:
            os.environ.clear()
            os.environ.update(old)

    def test_key_never_in_output(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            print(repr(self.e), self.e)
            self.e.list_runs("a1")
            with self.assertRaises(engine.EngineError) as cm:
                self.e.get_run("a1", "boom")
            print(cm.exception)
        self.assertNotIn(KEY, out.getvalue() + err.getvalue())

class Answer:
    def __init__(self, status, body):
        self.status, self.body = status, body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TriggerCallsTest(unittest.TestCase):
    def engine(self, status, body, sent):
        def opener(req, timeout):
            sent.append(req)
            return Answer(status, json.dumps(body).encode())
        return engine.Engine("http://x", KEY, urlopen=opener)

    def test_list_and_create(self):
        sent = []
        e = self.engine(200, {"triggers": [{"slug": "s1", "token": "t"}]}, sent)
        self.assertEqual(e.list_triggers("a/1")[0]["slug"], "s1")
        self.assertEqual((sent[0].get_method(), sent[0].full_url), ("GET", "http://x/agents/a%2F1/triggers"))
        sent = []
        e = self.engine(201, {"slug": "s1", "token": "t"}, sent)
        self.assertEqual(e.create_trigger("a1", "s1", "body", model="m")["slug"], "s1")
        self.assertEqual(json.loads(sent[0].data), {"name": "s1", "description": "", "body": "body", "provider": None, "model": "m"})
        self.assertEqual(sent[0].get_header("Authorization"), "Bearer " + KEY)
        with self.assertRaises(engine.EngineError):
            self.engine(201, {"slug": "s1"}, []).create_trigger("a1", "s1", "b")

    def test_fire_body_is_a_string_token_in_body_and_not_retried(self):
        sent = []
        e = self.engine(202, {"runId": "r1", "sessionId": "s1"}, sent)
        self.assertEqual(e.fire_trigger("a1", "slug", "tok-1", {"v": 1}), ("r1", "s1"))
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0].full_url, "http://x/agents/a1/triggers/slug/fire")
        body = json.loads(sent[0].data)
        self.assertEqual((body["token"], body["method"], body["body"]), ("tok-1", "POST", '{"v":1}'))
        self.assertNotIn("tok-1", sent[0].full_url)
        self.assertEqual(sent[0].get_header("Authorization"), "Bearer " + KEY)
        with self.assertRaises(engine.EngineError):
            self.engine(200, {"runId": "r1"}, []).fire_trigger("a1", "slug", "tok-1", {})

    def test_fire_errors_hide_key_and_token(self):
        calls = []

        def opener(req, timeout):
            calls.append(1)
            raise TimeoutError("timed out tok-1 " + KEY)
        with self.assertRaises(engine.EngineError) as cm:
            engine.Engine("http://x", KEY, urlopen=opener).fire_trigger("a1", "slug", "tok-1", {})
        self.assertEqual(len(calls), 1)
        self.assertNotIn(KEY, str(cm.exception))
        self.assertNotIn("tok-1", str(cm.exception))





if __name__ == "__main__":
    unittest.main()
