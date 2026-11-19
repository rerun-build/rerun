import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNBOOK = ROOT / "deploy" / "vps" / "SHARED-ENV.md"
DEFINITION = ROOT / "deploy" / "vps" / "everos-mcp.json"
ENGINE_BIN = ROOT / "apps" / "engine" / "src" / "cli" / "bin.ts"

RETIRED = [
    "git-credential-ghtoken",
    "everos-mcp",
    "/data/tools/github/token",
    "/data/tools/everos/token",
    "bin.pre-1284",
]


def read(path):
    return path.read_text(encoding="utf-8")


def section(text, heading):
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:] if end == -1 else text[start:end]


class SharedEnvRunbookTest(unittest.TestCase):
    def test_the_everos_definition_holds_placeholders_only(self):
        definition = json.loads(read(DEFINITION))
        self.assertEqual(definition["name"], "everos")
        env = definition["env"]
        names = sorted(k for k in env if k.startswith("EVEROS_"))
        self.assertEqual(names, ["EVEROS_APP", "EVEROS_TOKEN", "EVEROS_URL", "EVEROS_USER_ID"])
        for name in names:
            self.assertEqual(env[name], "${" + name + "}")
        self.assertNotIn("everos-mcp", definition["command"])

    def test_every_command_it_uses_is_in_the_engine_help(self):
        runbook = read(RUNBOOK)
        words = set(re.findall(r"shared-env (list|set|remove|run)\b", runbook))
        self.assertEqual(words, {"list", "set", "remove", "run"})
        help_text = re.search(r"const HELP = `(.*?)`", read(ENGINE_BIN), re.S).group(1)
        for word in words:
            self.assertIn("rerun shared-env " + word, help_text)
        self.assertIn("mcp set-all everos", runbook)
        self.assertIn("rerun mcp set-all <server>", help_text)

    def test_it_names_what_it_retires(self):
        runbook = read(RUNBOOK)
        for name in RETIRED:
            self.assertIn(name, runbook)

    def test_the_key_files_go_only_after_the_checks_pass(self):
        runbook = read(RUNBOOK)
        headings = [f"## Step {i}" for i in range(1, 8)]
        positions = [runbook.index(h) for h in headings]
        self.assertEqual(positions, sorted(positions))
        step6 = section(runbook, "## Step 6")
        self.assertIn("gh api user", step6)
        self.assertIn("ls-remote", step6)
        step7_start = positions[6]
        step7 = section(runbook, "## Step 7")
        for match in re.finditer(r"rm -rf /data/tools/github", runbook):
            self.assertGreaterEqual(match.start(), step7_start)
            self.assertIn(match.group(0), step7)

    def test_the_server_count_is_read_at_run_time(self):
        runbook = read(RUNBOOK)
        step3 = section(runbook, "## Step 3")
        self.assertIn("mcp set-all everos", step3)
        self.assertIn("wc -l", step3)
        self.assertNotIn("37 of 43", runbook)


if __name__ == "__main__":
    unittest.main()
