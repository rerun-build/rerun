import os, re, unittest

VPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps")
CHECKOUTS = {
    "code-rerun": ("rerun", "1536m"),
    "code-testpilot": ("testpilot", "1g"),
    "code-terminal-commander": ("terminal-commander", "768m"),
    "code-agent-army-professionals": ("Agent_Army_Professionals", "2560m"),
}
DATA = r"\$\{CODE_INTEL_DATA:\?set CODE_INTEL_DATA in deploy/vps/\.env\}"


def code():
    with open(os.path.join(VPS, "code-intel.yml"), encoding="utf-8") as f:
        return "\n".join(l for l in f.read().splitlines() if not l.lstrip().startswith("#"))


def services():
    c = code()
    m = re.search(r"(?ms)^services:\n(.*?)(?=^\S|\Z)", c)
    blocks = re.split(r"(?m)^  (?=[a-z][\w-]*:\n)", m.group(1))
    out = {}
    for b in blocks:
        if b.strip():
            name, _, body = b.partition(":\n")
            out[name] = body
    return out


class CodeIntelCompose(unittest.TestCase):
    def test_four_services_one_per_checkout(self):
        s = services()
        self.assertEqual(sorted(s), sorted(CHECKOUTS))
        for name, (checkout, _) in CHECKOUTS.items():
            self.assertIn("--project %s=/repo" % checkout, s[name])
            self.assertEqual(len(re.findall(r"--project ", s[name])), 1)

    def test_memory_limits(self):
        s = services()
        for name, (_, mem) in CHECKOUTS.items():
            self.assertRegex(s[name], r"(?m)^    mem_limit: %s$" % mem)

    def test_two_mounts_each_checkout_writable_binary_read_only(self):
        c = code()
        self.assertEqual(len(re.findall(r"(?m)^      - " + DATA, c)), 8)
        for name, (checkout, _) in CHECKOUTS.items():
            b = services()[name]
            self.assertRegex(b, r"(?m)^      - %s/work/repos/%s:/repo$" % (DATA, re.escape(checkout)))
            self.assertRegex(
                b,
                r"(?m)^      - %s/tools/lib/node_modules/symforge/node_modules/symforge-linux-x64/bin:/opt/symforge:ro$" % DATA,
            )

    def test_key_from_secret_file_never_in_environment(self):
        c = code()
        for name, b in services().items():
            self.assertRegex(b, r"(?m)^    secrets:\n      - code_intel_key$")
            self.assertIn("--api-key-env CODE_INTEL_KEY", b)
            self.assertNotIn("--api-key ", b)
            self.assertNotIn("CODE_INTEL_KEY:", b)
        self.assertRegex(
            c,
            r"(?m)^secrets:\n  code_intel_key:\n    file: %s/tools/etc/code-intel\.key$" % DATA,
        )

    def test_read_and_service_tools_only_no_index_folder_switch(self):
        for name, b in services().items():
            self.assertIn("--tools read,service", b)
            self.assertNotIn("--allow-index-folder", b)

    def test_hardening_and_network(self):
        c = code()
        for needle in ("read_only: true", "cap_drop:", "no-new-privileges:true", "restart: unless-stopped", "max-size: 10m"):
            self.assertEqual(c.count(needle), 4, needle)
        for bad in ("ports:", "docker.sock", "privileged", "network_mode", "env_file"):
            self.assertNotIn(bad, c)
        self.assertNotRegex(c, r"(?m)^volumes:")
        self.assertRegex(c, r"(?m)^name: rerun-code$")
        self.assertRegex(
            c,
            r"(?m)^networks:\n  default:\n    external: true\n    name: \$\{CODE_INTEL_NETWORK:\?set CODE_INTEL_NETWORK in deploy/vps/\.env\}$",
        )


if __name__ == "__main__":
    unittest.main()
