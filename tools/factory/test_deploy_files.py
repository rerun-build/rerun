import ast, os, re, unittest

VPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps")


def read(name):
    with open(os.path.join(VPS, name), encoding="utf-8") as f:
        return f.read()


def code(text):
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))


class DevEngine(unittest.TestCase):
    def test_key_comes_from_one_required_variable(self):
        self.assertIn("RERUN_API_KEY: ${RERUN_DEV_ENGINE_KEY:?", read("dev-engine.yml"))

    def test_no_literal_key_no_ports_no_socket(self):
        c = code(read("dev-engine.yml"))
        self.assertNotRegex(c, r"RERUN_API_KEY:\s*[^$\s]")
        for bad in ("ports:", "docker.sock", "privileged", "env_file", "RERUN_ENGINE_API_KEY"):
            self.assertNotIn(bad, c)


class Runner(unittest.TestCase):
    def setUp(self):
        self.t = read("factory-runner.yml")
        self.c = code(self.t)

    def test_same_network_project_as_dev_engine(self):
        self.assertIn("name: rerun-dev", self.c)
        self.assertNotIn("networks:", self.c)

    def test_compose_builds_from_factory_runner_dockerfile(self):
        self.assertRegex(self.c, r"(?m)^    build:\n(      .*\n)*?      dockerfile: factory-runner\.Dockerfile$")
        self.assertNotRegex(self.c, r"(?m)^    image:")
        self.assertNotRegex(self.c, r"gh[pousr]_\w{10}|github_pat_|(?i:token)\w*[ \t]*[:=][ \t]*[^\s$?]")
        self.assertNotIn("env_file", self.c)
        self.assertNotIn("ports:", self.c)

    def test_only_the_dev_key_and_url(self):
        self.assertIn("RERUN_DEV_ENGINE_KEY: ${RERUN_DEV_ENGINE_KEY:?", self.c)
        self.assertIn("RERUN_DEV_ENGINE_URL: http://engine-dev:3000", self.c)
        self.assertNotIn("RERUN_ENGINE_API_KEY", self.c)
        self.assertNotIn("env_file", self.c)

    def test_hardening(self):
        for bad in ("ports:", "docker.sock", "privileged: true", "cap_add", "network_mode", "pid:"):
            self.assertNotIn(bad, self.c)
        for need in ("restart: unless-stopped", "mem_limit:", "max-size:", "cap_drop:", "no-new-privileges:true", "read_only: true"):
            self.assertIn(need, self.c)

    def test_tools_mounted_read_only_and_own_volume(self):
        self.assertIn("../../tools/factory:/app:ro", self.c)
        self.assertRegex(self.c, r"factory-runner-data:/state")
        mounts = re.findall(r"^\s+- (\S+:/\S+)$", self.c, re.M)
        self.assertEqual(len(mounts), 2, mounts)

    def test_token_comes_from_key_file_secret(self):
        self.assertRegex(self.c, r"(?m)^    secrets:\n      - gh_token$")
        self.assertRegex(self.c, r"(?m)^secrets:\n  gh_token:\n    file: \$\{FACTORY_GH_TOKEN_FILE:\?")
        self.assertNotRegex(self.c, r"(GH|GITHUB|FACTORY_GIT)_TOKEN\s*:")
        self.assertNotIn("env_file", self.c)
        self.assertNotIn("ports:", self.c)
        self.assertEqual(len(re.findall(r"^\s+- (\S+:/\S+)$", self.c, re.M)), 2)

    def test_dispatcher_health_check_reads_the_heartbeat(self):
        c = code(read("factory-dispatcher.yml"))
        self.assertIn("/state/heartbeat", c)
        self.assertIn("time.time() - os.path.getmtime('/state/heartbeat') < 120", c)
        for want in ("interval: 30s", "timeout: 5s", "retries: 2", "start_period: 60s"):
            self.assertIn(want, c)
        self.assertRegex(c, r'healthcheck:\s*\n\s*test: \["CMD", "python3", "-c", ')


class StatusScript(unittest.TestCase):
    def setUp(self):
        self.s = read("dev-engine-status.sh")
        self.c = code(self.s)

    def test_bearer_from_dev_key_only(self):
        self.assertIn("RERUN_DEV_ENGINE_KEY", self.c)
        self.assertNotIn("RERUN_ENGINE_API_KEY", self.s)
        self.assertNotRegex(self.c, r"sed -n 's/\^RERUN_ENGINE")

    def test_key_never_echoed(self):
        for line in self.c.splitlines():
            if "$DEVKEY" in line and not line.startswith("[ -n"):
                self.assertNotRegex(line, r"\b(say|echo)\b")
                self.assertNotIn("docker exec -e", line)


class FactoryM2Doc(unittest.TestCase):
    def setUp(self):
        self.t = read("FACTORY-M2.md")
    def test_setup_is_one_sudo_line_in_its_own_block_and_no_heredoc(self):
        line = "sudo docker compose -f deploy/vps/factory-runner.yml exec -T factory-runner python3 /app/runner_loop.py setup"
        self.assertIn("```sh\n%s\n```" % line, self.t)
        self.assertNotIn("<<'PY'", self.t)
        self.assertNotIn("_call(", self.t)
    def test_order_up_before_setup_before_first_enqueue(self):
        up = self.t.index("factory-runner.yml up -d")
        setup = self.t.index("runner_loop.py setup")
        self.assertLess(up, setup)
        self.assertLess(setup, self.t.index("runner_loop.py enqueue"))
    def test_install_copies_what_the_runner_imports(self):
        with open(os.path.join(VPS, "..", "..", "tools", "factory", "install.sh"), encoding="utf-8") as f:
            s = f.read()
        loop = re.search(r"for f in ([^;]+); do", s).group(1).split()
        for need in ("trigger.py", "engine.py", "store.py", "limits.py", "runner_loop.py", "status_report.py", "runner.json"):
            self.assertIn(need, loop)
    def test_install_copies_every_module_its_files_import(self):
        here = os.path.join(VPS, "..", "..", "tools", "factory")
        with open(os.path.join(here, "install.sh"), encoding="utf-8") as f:
            loop = re.search(r"for f in ([^;]+); do", f.read()).group(1).split()
        missing = set()
        for name in (n for n in loop if n.endswith(".py")):
            with open(os.path.join(here, name), encoding="utf-8") as f:
                tree = ast.parse(f.read())
            for node in ast.walk(tree):
                mods = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
                for dep in (m.split(".")[0] + ".py" for m in mods):
                    if dep not in loop and os.path.exists(os.path.join(here, dep)):
                        missing.add("%s imports %s" % (name, dep))
        self.assertEqual(sorted(missing), [])


WIDE = ("system prune", "volume prune", "container prune", "network prune", "--volumes", "image prune -a", "image prune --all")


class Leftovers(unittest.TestCase):
    def test_update_removes_the_images_it_replaced_after_the_restart(self):
        c = code(read("update.sh"))
        self.assertLess(c.index("docker compose up -d"), c.index("docker image prune -f"))
        for bad in WIDE:
            self.assertNotIn(bad, c)

    def test_tidy_removes_untagged_images_and_build_cache_and_nothing_else(self):
        c = code(read("tidy.sh"))
        self.assertEqual([l.strip() for l in c.splitlines() if " prune" in l], ["docker image prune -f", "docker builder prune -af"])
        for bad in WIDE + ("docker rm", "docker rmi", "docker volume rm"):
            self.assertNotIn(bad, c)

    def test_tidy_timer_runs_a_root_owned_copy_weekly_and_catches_up(self):
        c = code(read("tidy.sh"))
        for need in ("ExecStart=$BIN run", "OnCalendar=Sun 04:30", "Persistent=true", "install -m 755"):
            self.assertIn(need, c)


class ClaudeScript(unittest.TestCase):
    def setUp(self):
        self.c = code(read("dev-engine-claude.sh"))

    def test_token_goes_only_through_one_pipe(self):
        uses = [l.strip() for l in self.c.splitlines() if "TOKEN" in l]
        self.assertEqual(uses, ["read -r TOKEN || TOKEN=''", '[ -n "$TOKEN" ] || { echo "Cancelled: nothing sent."; exit 0; }',
                                "printf '%s\\n' \"$TOKEN\" | realmodel connect", "TOKEN="])

    def test_no_file_no_trace_no_live_key(self):
        for bad in ("set -x", ".env", "RERUN_ENGINE_API_KEY", "docker exec -e", "tee "):
            self.assertNotIn(bad, self.c)
        self.assertIn("stty -echo", self.c)
        self.assertIn("-f deploy/vps/factory-runner.yml exec -T factory-runner python3 /app/realmodel.py", self.c)


if __name__ == "__main__":
    unittest.main()
