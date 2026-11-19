import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_NAME = "code-intel-status.sh"
SCRIPT = ROOT / "deploy/vps" / SCRIPT_NAME
RUNBOOK = ROOT / "deploy/vps/CODE-INTEL.md"
COMPOSE = ROOT / "deploy/vps/code-intel.yml"


def sh_lines():
    text = RUNBOOK.read_text()
    out = []
    for block in re.findall(r"```sh\n(.*?)```", text, re.S):
        out.extend(block.splitlines())
    return out


def section(n):
    text = RUNBOOK.read_text()
    start = text.index("## %d." % n)
    end = text.find("\n## ", start + 1)
    return text[start:] if end == -1 else text[start:end]


def services():
    found = {}
    current = None
    for line in COMPOSE.read_text().splitlines():
        m = re.match(r"^  (code-[a-z-]+):\s*$", line)
        if m:
            current = m.group(1)
        p = re.search(r"--project (\S+?)=/repo", line)
        if p and current:
            found[current] = p.group(1)
    return found


class CodeIntelRunbook(unittest.TestCase):
    def test_status_script_mounts_read_only_and_runs_code_q_status(self):
        s = SCRIPT.read_text()
        for needle in (
            "set -eu",
            "docker compose -f deploy/vps/code-intel.yml ps --all",
            '--network "$NET"',
            "--user 1001:1001",
            "node /data/tools/factory-current/code-q.mjs --status",
        ):
            self.assertIn(needle, s)
        self.assertNotIn("/data/tools/factory/", s)
        mounts = re.findall(r"-v (\S+)", s)
        self.assertEqual(len(mounts), 2)
        for m in mounts:
            self.assertTrue(m.rstrip("\"").endswith(":ro"), m)
        self.assertNotIn("sudo", s)
        self.assertNotIn("docker.sock", s)
        self.assertEqual(subprocess.run(["sh", "-n", str(SCRIPT)]).returncode, 0)

    def test_every_sudo_line_stands_alone(self):
        lines = [x for x in sh_lines() if "sudo" in x]
        self.assertGreaterEqual(len(lines), 12)
        for x in lines:
            self.assertTrue(x.startswith("sudo "), x)
            self.assertEqual(x.count("sudo"), 1, x)

    def test_env_lines_run_once_under_sudo(self):
        lines = [x for x in sh_lines() if ">> deploy/vps/.env" in x and "CODE_INTEL_" in x]
        self.assertEqual(len(lines), 2)
        for x in lines:
            self.assertTrue(x.startswith("sudo sh -c '"), x)
            self.assertTrue(x.endswith("'"), x)
            inner = x[len("sudo sh -c '"):-1]
            self.assertEqual(subprocess.run(["sh", "-n", "-c", inner]).returncode, 0, x)
        self.assertIn("Run these two lines once", section(1))

    def test_status_lines_named_by_kind(self):
        self.assertNotIn("Every line must read", RUNBOOK.read_text())
        self.assertIn("`<service> running`", section(4))
        self.assertIn("`<repo> up ready`", section(4))
        self.assertIn("as in step 4", section(5))
        self.assertIn("`code-terminal-commander` not `running`", section(6))

    def test_config_line_matches_the_compose_services(self):
        svc = services()
        self.assertEqual(len(svc), 4)
        text = RUNBOOK.read_text()
        for name, checkout in svc.items():
            plain = '"%s": "http://%s:8787/mcp"' % (checkout, name)
            escaped = plain.replace('"', '\\"')
            self.assertTrue(plain in text or escaped in text, name)

    def test_dev_network_before_live_and_fallback_check(self):
        t = RUNBOOK.read_text()
        dev = t.index("rerun-dev_default")
        live = t.index("rerun_default")
        self.assertLess(dev, live)
        self.assertIn("stop code-terminal-commander", t)
        self.assertIn("start code-terminal-commander", t)
        self.assertGreater(t.index("--force-recreate"), live)

    def test_index_location_and_follow(self):
        t = RUNBOOK.read_text()
        for needle in ("`.symforge/`", "no `index.bin`", "follow_base", "with no restart"):
            self.assertIn(needle, t)

    def test_speed_and_cost_check(self):
        s7 = section(7)
        lines = s7.splitlines()
        for line in (
            "/data/tools/bin/code-q --check Agent_Army_Professionals search_symbols '{\"query\": \"main\"}'",
            "/data/tools/bin/code-q --check rerun find_references '{\"name\": \"follow_base\"}'",
            "pgrep -fa '[s]ymforge daemon' || echo no daemon left",
        ):
            self.assertIn(line, lines)
        for needle in ("PASS", "stands in"):
            self.assertIn(needle, s7)
        self.assertNotIn("sudo", s7)
        self.assertIn("docker compose -f deploy/vps/code-intel.yml down", section(8))
        s4 = section(4)
        self.assertIn("`watching`", s4)
        self.assertIn("`not watching`", s4)
        self.assertNotIn("pgrep -fa 'symforge daemon'", RUNBOOK.read_text())

    def test_no_addresses_or_keys(self):
        urls = {"http://%s:8787/mcp" % n for n in services()}
        for f in (SCRIPT, RUNBOOK):
            t = f.read_text()
            self.assertIsNone(re.search(r"\b\d{1,3}(\.\d{1,3}){3}\b", t), f.name)
            self.assertIsNone(re.search(r"[0-9a-fA-F]{64}", t), f.name)
            for u in re.findall(r"https?://[^\s\"'\\]+", t):
                self.assertIn(u, urls, u)


if __name__ == "__main__":
    unittest.main()
