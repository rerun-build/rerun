import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy/vps/code-intel-status.sh"
RUNBOOK = ROOT / "deploy/vps/CODE-INTEL.md"
COMPOSE = ROOT / "deploy/vps/code-intel.yml"


def sh_lines():
    text = RUNBOOK.read_text()
    out = []
    for block in re.findall(r"```sh\n(.*?)```", text, re.S):
        out.extend(block.splitlines())
    return out


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
            "node /data/tools/factory/code-q.mjs --status",
        ):
            self.assertIn(needle, s)
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
