import contextlib, io, json, os, shutil, stat, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E
import limits
import trigger as T

KEY = "engine-KEY-0123456789abcdef"
TOKEN = "tok-SECRET-0123456789abcdef"
BODY = "You were started by the factory runner.\nDo the challenge."


class State:
    def __init__(self):
        self.triggers, self.creates, self.fires, self.runs, self.reject_fire = {}, [], [], {}, False


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _handle(self):
        st = self.server.state
        if self.headers.get("Authorization") != "Bearer " + KEY:
            return self._send(401, {"error": "unauthorized " + KEY})
        n = int(self.headers.get("Content-Length") or 0)
        data = json.loads(self.rfile.read(n) or b"{}")
        p = self.path.split("?")[0].strip("/").split("/")
        agent = p[1]
        if p[2:3] == ["triggers"]:
            mine = st.triggers.setdefault(agent, {})
            if len(p) == 3 and self.command == "GET":
                return self._send(200, {"triggers": list(mine.values())})
            if len(p) == 3 and self.command == "POST":
                slug = data["name"]
                st.creates.append((agent, slug))
                mine[slug] = {"slug": slug, "name": slug, "enabled": True, "token": TOKEN + "-" + slug, "body": data["body"], "model": data["model"]}
                return self._send(201, mine[slug])
            if len(p) == 5 and p[4] == "fire":
                t = mine.get(p[3])
                st.fires.append((agent, p[3], data))
                if st.reject_fire or not t or data.get("token") != t["token"]:
                    return self._send(404, {"error": "trigger not found " + data.get("token", "")})
                return self._send(202, {"runId": "run-%d" % len(st.fires), "sessionId": "ses-1", "triggerSlug": p[3]})
        if p[2:3] == ["runs"] and len(p) == 4 and self.command == "GET":
            row = st.runs.get(p[3])
            return self._send(200, row) if row else self._send(404, {"error": "run not found"})
        self._send(404, {"error": "no"})

    do_GET = do_POST = _handle


class Base(unittest.TestCase):
    def setUp(self):
        self.srv = HTTPServer(("127.0.0.1", 0), Fake)
        self.srv.state = self.st = State()
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))
        self.eng = E.Engine("http://127.0.0.1:%d" % self.srv.server_port, KEY)
        self.tmp = tempfile.mkdtemp(prefix="trigger-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.tokfile = os.path.join(self.tmp, "vol", "tokens.json")
        self.cfg = {"tick_seconds": 120, "token_file": self.tokfile, "triggers": [
            {"stage": "challenge", "coworker": "DEVILS_ADVOCATE", "agent": "agent-da", "slug": "factory-challenge", "model": "claude-x"}]}
        cfgp = os.path.join(self.tmp, "runner.json")
        with open(cfgp, "w") as f:
            json.dump(self.cfg, f)
        os.makedirs(os.path.join(self.tmp, "triggers"))
        with open(os.path.join(self.tmp, "triggers", "challenge.md"), "w", newline="\n") as f:
            f.write(BODY + "\n")
        for k, v in (("CONFIG", cfgp), ("TRIGGERS", os.path.join(self.tmp, "triggers")), ("PROBE_POLL_S", 0)):
            p = mock.patch.object(T, k, v)
            p.start()
            self.addCleanup(p.stop)

    def main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.object(E, "Engine", lambda: self.eng):
            code = T.main(argv)
        for secret in (KEY, TOKEN):
            self.assertNotIn(secret, out.getvalue() + err.getvalue())
        return code, out.getvalue()


class TestEnsure(Base):
    def test_creates_once_reuses_and_survives_restart(self):
        tokens = T.ensure_triggers(self.eng, self.cfg)
        self.assertEqual(self.st.creates, [("agent-da", "factory-challenge")])
        self.assertEqual(tokens, {"agent-da/factory-challenge": TOKEN + "-factory-challenge"})
        T.ensure_triggers(self.eng, self.cfg)
        self.assertEqual(len(self.st.creates), 1)
        self.assertEqual(stat.S_IMODE(os.stat(self.tokfile).st_mode), 0o600)
        self.assertEqual(T.load_tokens(self.tokfile), tokens)
        with open(self.tokfile) as f:
            self.assertNotIn(KEY, f.read())

    def test_new_trigger_carries_body_and_model(self):
        T.ensure_triggers(self.eng, self.cfg)
        row = self.st.triggers["agent-da"]["factory-challenge"]
        self.assertEqual((row["body"], row["model"]), (BODY, "claude-x"))

    def test_wrong_slug_from_engine_is_an_error_without_secrets(self):
        self.cfg["triggers"][0]["slug"] = "Factory Challenge"
        with mock.patch.object(self.eng, "create_trigger", lambda *a, **k: {"slug": "other", "token": TOKEN}):
            with self.assertRaises(T.TriggerError) as cm:
                T.ensure_triggers(self.eng, self.cfg)
        self.assertNotIn(TOKEN, str(cm.exception))

    def test_bad_token_file_raises_class_only(self):
        os.makedirs(os.path.dirname(self.tokfile))
        with open(self.tokfile, "w") as f:
            f.write("{not json " + TOKEN)
        with self.assertRaises(T.TriggerError) as cm:
            T.load_tokens(self.tokfile)
        self.assertNotIn(TOKEN, str(cm.exception))


class TestFire(Base):
    def test_fire_once_with_bearer_token_and_string_body(self):
        tokens = T.ensure_triggers(self.eng, self.cfg)
        run = T.fire(self.eng, "agent-da", "factory-challenge", tokens["agent-da/factory-challenge"], {"v": 1, "stage": "probe"})
        self.assertEqual(run, ("run-1", "ses-1"))
        self.assertEqual(len(self.st.fires), 1)
        sent = self.st.fires[0][2]
        self.assertEqual((sent["method"], sent["body"]), ("POST", '{"v":1,"stage":"probe"}'))
        self.assertIsInstance(sent["body"], str)

    def test_rejected_fire_is_one_call_and_hides_secrets(self):
        self.st.reject_fire = True
        T.ensure_triggers(self.eng, self.cfg)
        with self.assertRaises(T.TriggerError) as cm:
            T.fire(self.eng, "agent-da", "factory-challenge", TOKEN, {})
        self.assertEqual(len(self.st.fires), 1)
        self.assertIn("HTTP 404", str(cm.exception))
        for s in (TOKEN, KEY):
            self.assertNotIn(s, str(cm.exception))

    def test_timeout_is_one_call(self):
        calls = []

        def opener(req, timeout):
            calls.append(1)
            raise TimeoutError("timed out " + TOKEN)
        eng = E.Engine("http://x", KEY, urlopen=opener)
        with self.assertRaises(T.TriggerError) as cm:
            T.fire(eng, "a", "s", TOKEN, {})
        self.assertEqual(len(calls), 1)
        self.assertNotIn(TOKEN, str(cm.exception))


class TestRunReader(Base):
    ROW = {"id": "r1", "agentId": "agent-da", "sessionId": "s1", "status": "error", "stepCount": 2, "startedAt": "2026-11-12T08:00:00.123Z",
           "finishedAt": "2026-11-12T08:03:00.000Z", "error": "interrupted: engine restarted", "inputTokens": 812, "triggerSource": "trigger",
           "triggerSlug": "factory-challenge"}

    def test_maps_to_snake_case_for_limits(self):
        self.st.runs["r1"] = dict(self.ROW)
        row = T.read_run(self.eng, "agent-da", "r1")
        self.assertEqual((row["status"], row["input_tokens"], row["trigger_slug"], row["session_id"], row["started_at"]),
                         ("error", 812, "factory-challenge", "s1", "2026-11-12T08:00:00.123Z"))
        self.assertEqual(T.input_tokens(row), 812)
        self.assertEqual(limits.run_outcome(row, limits.ts(row["started_at"]) + 5)[0], "RESTARTED")
        self.assertIsNone(T.read_run(self.eng, "agent-da", "other"))
        self.assertIsNone(T.map_run(None))

    def test_missing_keys_read_as_none(self):
        self.st.runs["r1"] = {"id": "r1", "status": "done"}
        row = T.read_run(self.eng, "agent-da", "r1")
        self.assertIsNone(row["input_tokens"])
        self.assertIsNone(T.input_tokens(row))
        self.assertEqual(row["status"], "done")


class TestCheckTriggers(Base):
    def test_ok_after_ensure(self):
        T.ensure_triggers(self.eng, self.cfg)
        self.assertEqual(self.main(["check-triggers"]), (0, "factory-challenge OK\n"))

    def test_drift_prints_slug_only(self):
        T.ensure_triggers(self.eng, self.cfg)
        row = self.st.triggers["agent-da"]["factory-challenge"]
        for body, model in ((BODY + "\nextra", "claude-x"), (BODY, "claude-y"), (BODY, None)):
            row["body"], row["model"] = body, model
            self.assertEqual(self.main(["check-triggers"]), (1, "factory-challenge DRIFT\n"))

    def test_missing_trigger_or_engine_down_is_drift(self):
        self.assertEqual(self.main(["check-triggers"]), (1, "factory-challenge DRIFT\n"))
        self.eng = E.Engine("http://127.0.0.1:1", KEY)
        self.assertEqual(self.main(["check-triggers"]), (1, "factory-challenge DRIFT\n"))


class TestProbe(Base):
    def probe(self, run, wait=600):
        self.st.runs["run-1"] = run
        with mock.patch.object(T, "PROBE_WAIT_S", wait):
            return self.main(["probe", "--stage", "challenge"])

    def test_done_under_limit_is_ok_and_fires_once(self):
        self.assertEqual(self.probe({"id": "run-1", "status": "done", "inputTokens": 812}), (0, "PROBE OK run-1 ses-1 input=812\n"))
        self.assertEqual(len(self.st.fires), 1)
        self.assertEqual(len(self.st.creates), 1)
        self.st.runs["run-2"] = {"id": "run-2", "status": "done", "inputTokens": 1}
        self.main(["probe", "--stage", "challenge"])
        self.assertEqual(len(self.st.creates), 1)

    def test_too_many_tokens_error_or_still_running_fails(self):
        for run, wait in (({"id": "run-1", "status": "done", "inputTokens": 300000}, 600), ({"id": "run-1", "status": "error", "inputTokens": 5}, 600),
                          ({"id": "run-1", "status": "running"}, 0)):
            del self.st.fires[:]
            code, out = self.probe(run, wait)
            self.assertEqual(code, 1, out)
            self.assertTrue(out.startswith("PROBE FAIL run-1 ses-1"), out)

    def test_fire_error_fails_without_secrets(self):
        self.st.reject_fire = True
        code, out = self.main(["probe", "--stage", "challenge"])
        self.assertEqual((code, out), (1, "PROBE FAIL: engine answered HTTP 404 for POST /agents/agent-da/triggers/factory-challenge/fire\n"))

    def test_unknown_stage_refused(self):
        self.assertEqual(self.main(["probe", "--stage", "build"])[0], 2)


class TestFiles(unittest.TestCase):
    PREAMBLE = ("You were started by the factory runner. Your packet is the JSON in trigger_payload. Do only this stage, then end. "
                "Never wait for CI, never dispatch another coworker, never merge. If stage is `probe`: change nothing, post nothing, "
                "answer with the single line PROBE OK and end.")

    def test_challenge_body_and_runner_json(self):
        with open(os.path.join(T.HERE, "triggers", "challenge.md"), encoding="utf-8") as f:
            body = f.read()
        self.assertTrue(body.startswith(self.PREAMBLE))
        self.assertIn("`PLAN READY`", body)
        self.assertIn("`PLAN REJECT: <n> points open`", body)
        cfg = T.load_config()
        self.assertNotIn("tick_seconds", cfg)
        self.assertIn(("challenge", "DEVILS_ADVOCATE", "factory-challenge"), [(e["stage"], e["coworker"], e["slug"]) for e in cfg["triggers"]])


if __name__ == "__main__":
    unittest.main()
