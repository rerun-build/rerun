import os, tempfile, unittest

import trigger as T


class FakeEngine:
    def __init__(self, patch=True):
        self.patch, self.calls = patch, []

    def list_triggers(self, agent):
        return []

    def create_trigger(self, agent, name, body, model=None, **kw):
        self.calls.append(("create", model))
        return {"slug": name, "token": "tok", "model": None}

    def set_trigger_model(self, agent, slug, model):
        self.calls.append(("set_model", agent, slug, model))
        return {"model": model} if self.patch else {}


class TriggerModel(unittest.TestCase):
    def cfg(self, d):
        return {"token_file": os.path.join(d, "t.json"), "triggers": [
            {"stage": "challenge", "agent": "ag", "slug": "factory-challenge", "model": "claude-x"}]}

    def test_fake_engine_gets_model(self):
        with tempfile.TemporaryDirectory() as d:
            eng = FakeEngine()
            T.ensure_triggers(eng, self.cfg(d))
            with open(os.path.join(d, "t.json"), encoding="utf-8") as f:
                self.assertIn("ag/factory-challenge", f.read())
        self.assertEqual(eng.calls[0], ("create", "claude-x"))

    def test_model_set_by_public_method(self):
        with tempfile.TemporaryDirectory() as d:
            eng = FakeEngine()
            T.ensure_triggers(eng, self.cfg(d))
        self.assertEqual(eng.calls[1], ("set_model", "ag", "factory-challenge", "claude-x"))

    def test_model_not_taken_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(T.TriggerError):
                T.ensure_triggers(FakeEngine(patch=False), self.cfg(d))


if __name__ == "__main__":
    unittest.main()
