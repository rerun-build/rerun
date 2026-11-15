import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def compose():
    with open(os.path.join(ROOT, "docker-compose.yml"), encoding="utf-8") as f:
        return "\n".join(l for l in f.read().splitlines() if not l.lstrip().startswith("#"))


class EngineKeyAsSecret(unittest.TestCase):
    def setUp(self):
        self.c = compose()
        self.engine = re.search(r"(?ms)^  engine:\n(.*?)^  supabase-bridge:", self.c).group(1)

    def test_engine_environment_holds_no_key_variable(self):
        env = re.search(r"(?ms)^    environment:\n(.*?)^    \S", self.engine).group(1)
        self.assertNotRegex(env, r"(?m)^\s+RERUN_API_KEY:")

    def test_engine_reads_the_key_from_the_mounted_secret(self):
        self.assertIn("      RERUN_API_KEY_FILE: /run/secrets/rerun_engine_key\n", self.engine)
        self.assertRegex(self.engine, r"(?m)^    secrets:\n      - rerun_engine_key$")

    def test_the_secret_takes_its_value_from_the_env_variable(self):
        self.assertRegex(self.c, r"(?m)^secrets:\n  rerun_engine_key:\n    environment: RERUN_ENGINE_API_KEY$")

    def test_app_service_keeps_its_key_variable(self):
        app = re.search(r"(?ms)^  app:\n(.*?)^  engine:", self.c).group(1)
        self.assertRegex(app, r"(?m)^      RERUN_ENGINE_API_KEY: \$\{RERUN_ENGINE_API_KEY:\?")


if __name__ == "__main__":
    unittest.main()
