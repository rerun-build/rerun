import os
import re
import unittest

VPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps")


def logical():
    with open(os.path.join(VPS, "update.sh"), encoding="utf-8") as f:
        text = "\n".join(l for l in f.read().splitlines() if not l.lstrip().startswith("#"))
    return re.sub(r"\\\n\s*", "", text)


class MigrationPassword(unittest.TestCase):
    def test_docker_run_line_never_holds_the_password(self):
        runs = [l for l in logical().splitlines() if l.startswith("docker run")]
        self.assertEqual(len(runs), 1)
        self.assertNotIn("$PW", runs[0])
        self.assertIn("-e PW ", runs[0])
        self.assertNotIn("-e PW=", runs[0])
        self.assertIn("encodeURIComponent", runs[0])

    def test_url_encodes_password_picks_single_network_and_drains_before_migrating(self):
        text = logical()
        self.assertIn("encodeURIComponent", text)
        self.assertIn("println $k", text)
        self.assertLess(text.index("\nwait_drained\n"), text.index('"db", "push"'))
        self.assertRegex(text, r"(?m)^export PW$")
        self.assertRegex(text, r"(?m)^unset PW$")

if __name__ == "__main__":
    unittest.main()
