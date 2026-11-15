#!/usr/bin/env python3
import contextlib, io, os, sys, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E
import realmodel as R

TOKEN = "sk-ant-oat01-" + "Ab3_" * 12
CONN = {"id": "c1", "name": "claude-plan", "provider": "claude", "models": list(R.MODELS), "connected": True}
BARE = {"id": "c1", "name": "claude-plan", "provider": "claude", "models": [], "connected": True}
STUB = {"id": "s1", "name": "stub", "provider": "custom", "models": ["stub-fast"], "connected": True}
DONE = {"status": "done", "provider": "claude", "model": "claude-haiku-5-5", "inputTokens": 9100, "outputTokens": 4}
FELL_BACK = {"status": "done", "provider": "custom", "model": "stub-fast", "inputTokens": 1, "outputTokens": 1}


class FakeEng:
    def __init__(self, connections=(), default="s1", rows=(DONE,), fire_error=None, delete_error=None):
        self.calls, self.connections, self.default = [], [dict(c) for c in connections], default
        self.rows, self.fire_error, self.delete_error = list(rows), fire_error, delete_error

    def _call(self, method, path, query=None, payload=None):
        self.calls.append((method, path, payload))
        if (method, path) == ("GET", "/connections"):
            return {"connections": [dict(c) for c in self.connections], "default": {"connectionId": self.default}}
        if (method, path) == ("POST", "/connections"):
            self.connections.append({"id": "c1", "name": payload["name"], "provider": payload["provider"],
                                     "models": list(payload.get("models") or []), "connected": True})
            return {"id": "c1"}
        if (method, path) == ("PATCH", "/connections/c1"):
            next(c for c in self.connections if c["id"] == "c1")["models"] = list(payload["models"])
            return {}
        if (method, path) == ("POST", "/agents"):
            return {"id": "a1"}
        if method == "DELETE" and path.startswith("/agents/") and self.delete_error:
            raise self.delete_error
        return {}

    def create_trigger(self, agent_id, name, body):
        self.calls.append(("TRIGGER", agent_id, body))
        return {"slug": "probe", "token": "trigger-token"}

    def fire_trigger(self, agent_id, slug, token, payload):
        if self.fire_error:
            raise self.fire_error
        return "r1", "s1"

    def get_run(self, agent_id, run_id):
        return self.rows.pop(0) if len(self.rows) > 1 else self.rows[0]


def quiet(seconds):
    pass


class Connect(unittest.TestCase):
    def test_bad_token_is_refused_and_nothing_is_sent(self):
        for bad in ("", "short", "has a space " + "x" * 30, 'quote"' + "x" * 30, "line\nbreak" + "x" * 30):
            eng = FakeEng([STUB])
            with self.assertRaises(ValueError):
                R.connect(eng, bad)
            self.assertEqual(eng.calls, [])

    def test_creates_a_claude_connection_that_lists_its_models_with_the_token_only_in_the_body(self):
        eng = FakeEng([STUB])
        out = R.connect(eng, TOKEN + "\n")
        posts = [c for c in eng.calls if c[0] == "POST"]
        self.assertEqual(posts, [("POST", "/connections", {"name": "claude-plan", "provider": "claude", "models": R.MODELS,
                                                           "keys": {"CLAUDE_CODE_OAUTH_TOKEN": TOKEN}})])
        self.assertEqual(out, ["connection=created", "connection=present token-held=yes offers-models=3of3 default-is-real-model=no"])
        self.assertNotIn(TOKEN, "\n".join(out) + repr([path for _, path, _ in eng.calls]))

    def test_an_existing_connection_gets_the_new_token_and_any_missing_models(self):
        eng = FakeEng([STUB, BARE])
        self.assertEqual(R.connect(eng, TOKEN), ["connection=updated", "models=added 3"])
        self.assertIn(("PATCH", "/connections/c1/keys", {"set": {"CLAUDE_CODE_OAUTH_TOKEN": TOKEN}}), eng.calls)
        self.assertIn(("PATCH", "/connections/c1", {"models": R.MODELS}), eng.calls)

    def test_check_shows_a_connection_that_lists_no_model_and_a_moved_default(self):
        self.assertEqual(R.check(FakeEng([STUB])), ["connection=absent default-is-real-model=no"])
        self.assertEqual(R.check(FakeEng([STUB, BARE])), ["connection=present token-held=yes offers-models=0of3 default-is-real-model=no"])
        self.assertEqual(R.check(FakeEng([CONN], default="c1")), ["connection=present token-held=yes offers-models=3of3 default-is-real-model=yes"])


class Probe(unittest.TestCase):
    def test_one_run_on_the_real_model_and_the_coworker_is_removed(self):
        eng = FakeEng([STUB, CONN], rows=[{"status": "running"}, DONE])
        out = R.probe(eng, sleep=quiet)
        self.assertEqual(out, ["run=r1 status=done provider=claude model=claude-haiku-5-5 input-tokens=9100 output-tokens=4", "proof=PASS"])
        cfg = next(p for m, path, p in eng.calls if (m, path) == ("POST", "/agents"))["config"]
        self.assertEqual((cfg["connectionId"], cfg["provider"], cfg["model"]), ("c1", "claude", "claude-haiku-5-5"))
        self.assertEqual(eng.calls[-1][:2], ("DELETE", "/agents/a1"))

    def test_a_run_that_fell_back_to_the_default_model_is_a_failed_proof(self):
        out = R.probe(FakeEng([STUB, CONN], rows=[FELL_BACK]), sleep=quiet)
        self.assertIn("provider=custom model=stub-fast", out[0])
        self.assertTrue(out[-1].startswith("proof=FAIL"), out)

    def test_a_connection_without_models_gets_them_before_the_coworker_is_made(self):
        eng = FakeEng([STUB, BARE])
        out = R.probe(eng, sleep=quiet)
        self.assertEqual(out[0], "models=added 3")
        steps = [(m, p) for m, p, _ in eng.calls]
        self.assertLess(steps.index(("PATCH", "/connections/c1")), steps.index(("POST", "/agents")))
        self.assertEqual(out[-1], "proof=PASS")

    def test_a_run_still_going_after_the_wait_says_so_and_fails(self):
        out = R.probe(FakeEng([CONN], rows=[{"status": "running"}]), sleep=quiet)
        self.assertIn("status=running", out[0])
        self.assertIn("timeout=yes", out[0])
        self.assertTrue(out[-1].startswith("proof=FAIL"))

    def test_coworker_is_removed_when_the_fire_fails_and_the_first_error_is_kept(self):
        fire = E.EngineError("engine answered HTTP 500 for POST /agents/a1/triggers/probe/fire")
        eng = FakeEng([CONN], fire_error=fire, delete_error=E.EngineError("engine answered HTTP 502 for DELETE /agents/a1"))
        with self.assertRaises(E.EngineError) as caught:
            R.probe(eng, sleep=quiet)
        self.assertIs(caught.exception, fire)
        self.assertEqual(eng.calls[-1][:2], ("DELETE", "/agents/a1"))

    def test_a_credential_in_an_error_text_is_cut(self):
        eng = FakeEng([CONN], rows=[{"status": "error", "provider": "claude", "error": "provider refused " + TOKEN + " for this plan"}])
        out = R.probe(eng, sleep=quiet)
        self.assertIn("status=error", out[0])
        self.assertIn("error=provider refused <cut> for this plan", out[0])
        self.assertNotIn(TOKEN, "\n".join(out))
        self.assertTrue(out[-1].startswith("proof=FAIL"))

    def test_no_connection_no_coworker(self):
        eng = FakeEng([STUB])
        with self.assertRaises(RuntimeError):
            R.probe(eng)
        self.assertEqual([c for c in eng.calls if c[0] != "GET"], [])


class Main(unittest.TestCase):
    def run_main(self, eng, argv, stdin=""):
        buf = io.StringIO()
        with mock.patch.object(E, "Engine", lambda: eng), mock.patch.object(R.time, "sleep", quiet), \
                contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            return R.main(argv, stdin=io.StringIO(stdin)), buf.getvalue()

    def test_a_failed_connect_prints_no_token(self):
        class Refusing(FakeEng):
            def _call(self, method, path, query=None, payload=None):
                if method == "POST":
                    raise E.EngineError("engine answered HTTP 400 for POST /connections")
                return super()._call(method, path, query, payload)
        code, text = self.run_main(Refusing([STUB]), ["connect"], TOKEN + "\n")
        self.assertEqual(code, 1)
        self.assertIn("realmodel connect failed: engine answered HTTP 400", text)
        self.assertNotIn(TOKEN, text)

    def test_exit_status_follows_the_proof(self):
        self.assertEqual(self.run_main(FakeEng([STUB, CONN]), ["probe"])[0], 0)
        code, text = self.run_main(FakeEng([STUB, CONN], rows=[FELL_BACK]), ["probe"])
        self.assertEqual(code, 1)
        self.assertIn("proof=FAIL", text)

    def test_remove_and_usage(self):
        eng = FakeEng([STUB, CONN])
        self.assertEqual(R.remove(eng), ["connection=removed"])
        self.assertEqual(eng.calls[-1][:2], ("DELETE", "/connections/c1"))
        self.assertEqual(self.run_main(FakeEng(), ["nonsense"])[0], 2)


if __name__ == "__main__":
    unittest.main()
