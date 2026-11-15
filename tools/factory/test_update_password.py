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
        self.assertNotIn("@db", runs[0])
        self.assertIn("-e SUPABASE_DB_URL ", runs[0])
        self.assertNotIn("-e SUPABASE_DB_URL=", runs[0])
        self.assertIn('--db-url \\"\\$SUPABASE_DB_URL\\"', runs[0])

    def test_url_is_built_in_the_shell_and_dropped_after(self):
        text = logical()
        self.assertRegex(text, r'(?m)^SUPABASE_DB_URL="postgresql://postgres:\$PW@db:5432/postgres\?sslmode=disable"$')
        self.assertRegex(text, r"(?m)^export SUPABASE_DB_URL$")
        self.assertRegex(text, r"(?m)^unset PW SUPABASE_DB_URL$")


if __name__ == "__main__":
    unittest.main()
