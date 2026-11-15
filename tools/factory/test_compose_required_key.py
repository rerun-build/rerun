import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def compose():
    with open(os.path.join(ROOT, "docker-compose.yml"), encoding="utf-8") as f:
        return "\n".join(l for l in f.read().splitlines() if not l.lstrip().startswith("#"))


class ComposeRequiresTheEngineKey(unittest.TestCase):
    def test_every_use_of_the_key_refuses_an_empty_value(self):
        uses = re.findall(r"\$\{RERUN_ENGINE_API_KEY[^}]*\}", compose())
        self.assertGreaterEqual(len(uses), 2)
        for use in uses:
            self.assertRegex(use, r"^\$\{RERUN_ENGINE_API_KEY:\?\S")


if __name__ == "__main__":
    unittest.main()
