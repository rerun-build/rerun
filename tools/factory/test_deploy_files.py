import os, re, shutil, subprocess, sys, tempfile, unittest

VPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps")


def read(name):
    with open(os.path.join(VPS, name), encoding="utf-8") as f:
        return f.read()


def code(text):
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))


class DevEngine(unittest.TestCase):
    def test_key_is_one_required_variable_handed_over_as_a_secret(self):
        c = code(read("dev-engine.yml"))
        self.assertRegex(c, r"(?m)^x-required-key: \$\{RERUN_DEV_ENGINE_KEY:\?set RERUN_DEV_ENGINE_KEY in deploy/vps/\.env\}$")
        self.assertIn("RERUN_API_KEY_FILE: /run/secrets/rerun_dev_engine_key", c)
        self.assertRegex(c, r"(?m)^    secrets:\n      - rerun_dev_engine_key$")
        self.assertRegex(c, r"(?m)^secrets:\n  rerun_dev_engine_key:\n    environment: RERUN_DEV_ENGINE_KEY$")
        self.assertNotRegex(c, r"(?m)RERUN_API_KEY:")

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
    def test_install_copies_every_module_and_config_that_is_not_a_test(self):
        if sys.platform == "win32" or shutil.which("sh") is None:
            self.skipTest("no sh")
        here = os.path.join(VPS, "..", "..", "tools", "factory")
        want = sorted(n for n in os.listdir(here) if (n.endswith(".py") and not n.startswith("test_")) or n.endswith(".json") or n.endswith(".mjs"))
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["sh", os.path.join(here, "install.sh"), "--prefix", tmp, "--jev-keyfile", "/x"], check=True, capture_output=True)
            got = sorted(n for n in os.listdir(os.path.join(tmp, "factory")) if n != "triggers")
            self.assertEqual(got, want)
            with open(os.path.join(tmp, "factory", "runner_loop.py"), encoding="utf-8") as f:
                self.assertNotIn("/data/tools/factory", f.read())


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


class OneDeploy(unittest.TestCase):
    def test_the_vps_project_carries_the_dispatcher(self):
        self.assertTrue(code(read("docker-compose.vps.yml")).startswith("include:\n  - deploy/vps/factory-dispatcher.yml\n"))

    def test_both_volumes_keep_the_names_they_had_before_the_move(self):
        with open(os.path.join(VPS, "..", "..", "docker-compose.yml"), encoding="utf-8") as f:
            self.assertIn("volumes:\n  engine-data:\n    name: rerun_engine-data\n", f.read())
        self.assertIn("volumes:\n  factory-dispatcher-data:\n    name: rerun-factory_factory-dispatcher-data", code(read("factory-dispatcher.yml")))

    def test_the_dispatcher_can_be_held_off(self):
        self.assertIn("    deploy:\n      replicas: ${FACTORY_DISPATCHER:-1}\n", code(read("factory-dispatcher.yml")))

    def test_update_stops_the_old_dispatcher_after_the_drain_and_keeps_its_data(self):
        c = code(read("update.sh"))
        drained, stop, up = c.index("\nwait_drained\n"), c.index("docker stop -t 150 $OLD"), c.index("docker compose up -d")
        self.assertLess(drained, c.index("docker compose build factory-dispatcher"))
        self.assertLess(c.index("docker compose build factory-dispatcher"), stop)
        self.assertLess(stop, c.index("        DISPATCHER=\n"))
        self.assertLess(drained, stop)
        self.assertLess(stop, up)
        self.assertIn("label=com.docker.compose.project=rerun-factory", c)
        self.assertLess(up, c.index("DISPATCHER=$(docker ps -qf name=factory-dispatcher", up))
        self.assertLess(c.index("docker compose config -q"), c.index("touch /state/drain"))
        for bad in ("docker volume rm", "down -v", "--volumes", "rm -v", "volume prune", "compose down"):
            self.assertNotIn(bad, c)
        self.assertEqual([l for l in c.splitlines() if l.lstrip().startswith("docker compose") and "--yes" in l], [])


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


class EveryScript(unittest.TestCase):
    def test_every_deploy_script_is_named_in_a_test(self):
        here = os.path.dirname(os.path.abspath(__file__))
        text = ""
        for n in sorted(os.listdir(here)):
            if n.startswith("test_") and n.endswith(".py"):
                with open(os.path.join(here, n), encoding="utf-8") as f:
                    text += f.read()
        missing = [
            n for n in sorted(os.listdir(VPS))
            if n.endswith(".sh") and not re.search(r"[\"']%s[\"']" % re.escape(n), text)
        ]
        self.assertEqual(missing, [])


@unittest.skipIf(shutil.which("sh") is None, "no sh")
class RunnerScripts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        os.makedirs(os.path.join(self.tmp, "deploy", "vps"))
        os.makedirs(os.path.join(self.tmp, "bin"))
        for n in ("factory-status.sh", "factory-m2-proof.sh"):
            with open(os.path.join(VPS, n), encoding="utf-8") as f:
                body = f.read()
            with open(os.path.join(self.tmp, "deploy", "vps", n), "w", encoding="utf-8") as f:
                f.write(body)
        self.log = os.path.join(self.tmp, "docker.log")
        self.fake("docker", 'echo "$*" >> "$DOCKER_LOG"')
        self.fake("sleep", ":")
        self.fake("openssl", "echo 00")

    def fake(self, name, body):
        path = os.path.join(self.tmp, "bin", name)
        with open(path, "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\n" + body + "\n")
        os.chmod(path, 0o755)

    def run_script(self, name, *args):
        env = dict(os.environ)
        env["PATH"] = os.path.join(self.tmp, "bin") + os.pathsep + env.get("PATH", "")
        env["DOCKER_LOG"] = self.log
        r = subprocess.run(
            ["sh", os.path.join("deploy", "vps", name), *args],
            cwd=self.tmp, env=env, capture_output=True, text=True, timeout=60,
        )
        return r.returncode, r.stdout + r.stderr

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as f:
            return f.read().splitlines()

    def test_status_hands_its_arguments_to_the_runner_report(self):
        rc, out = self.run_script("factory-status.sh", "--json")
        self.assertEqual(rc, 0, out)
        self.assertEqual(
            self.calls(),
            ["compose -f deploy/vps/factory-runner.yml exec -T factory-runner python3 -I /app/status_report.py --json"],
        )

    def test_proof_refuses_without_root_and_touches_nothing(self):
        self.fake("id", "echo 1000")
        rc, out = self.run_script("factory-m2-proof.sh")
        self.assertEqual(rc, 1)
        self.assertIn("Run it with sudo", out)
        self.assertEqual(self.calls(), [])

    def test_proof_runs_its_eight_steps_in_order(self):
        self.fake("id", "echo 0")
        rc, out = self.run_script("factory-m2-proof.sh")
        self.assertEqual(rc, 0, out)
        self.assertEqual(re.findall(r"(?m)^== (\d)/8 ", out), [str(i) for i in range(1, 9)])
        self.assertNotIn("STEP FAILED", out)
        calls = self.calls()
        self.assertEqual(len(calls), 16)
        enq = [c.split("runner_loop.py ", 1)[1] for c in calls if "runner_loop.py enqueue" in c]
        self.assertEqual(
            enq,
            ["enqueue r1 challenge", "enqueue r2 challenge-hold", "enqueue r3 challenge-hold", "enqueue r4 challenge-hold"],
        )
        self.assertEqual(sum("/app/status_report.py" in c for c in calls), 4)


if __name__ == "__main__":
    unittest.main()
