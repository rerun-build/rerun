import os
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps", "dev-engine-claude.sh")
DOCKER = '#!/bin/sh\nfor a in "$@"; do last=$a; done\necho "$last" >> "%s"\ncase "$last" in\n    check) echo connection=absent ;;\n    connect) cat >> "%s" ;;\nesac\n'


def run(stty_ok):
    with tempfile.TemporaryDirectory() as d:
        log = os.path.join(d, "calls")
        for name, body in (("docker", DOCKER % (log, log)), ("stty", "#!/bin/sh\nexit %d\n" % (0 if stty_ok else 1))):
            path = os.path.join(d, name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(path, 0o755)
        env = {"PATH": d + os.pathsep + os.environ["PATH"]}
        p = subprocess.run(["sh", SCRIPT], input="secret-token-value\n", capture_output=True, text=True, env=env, timeout=30)
        calls = ""
        if os.path.exists(log):
            with open(log, encoding="utf-8") as f:
                calls = f.read()
    return p, calls


class HiddenTyping(unittest.TestCase):
    def test_refuses_to_ask_when_the_terminal_cannot_hide_typing(self):
        p, calls = run(False)
        self.assertEqual(p.returncode, 1)
        self.assertIn("cannot hide typing", p.stdout + p.stderr)
        self.assertNotIn("Token from", p.stdout)
        self.assertNotIn("connect", calls)
        self.assertNotIn("secret-token-value", calls + p.stdout + p.stderr)

    def test_sends_the_token_once_when_typing_is_hidden(self):
        p, calls = run(True)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(calls.count("secret-token-value"), 1)
        self.assertNotIn("secret-token-value", p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main()
