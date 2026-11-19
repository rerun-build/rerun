import fcntl, hashlib, json, os, re, shutil, stat, subprocess, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DEPLOY = os.path.join(HERE, "..", "..", "deploy", "vps")
SCRIPT = os.path.join(DEPLOY, "keeper.sh")
SH = shutil.which("sh")

DOCKER = r"""#!/bin/sh
echo "docker $*" >> "$CALLS"
S="$STATE"
case "$*" in
  *"exec -T engine"*)
    rest=${*#*exec -T engine }
    ;;
  *) rest= ;;
esac
case "$*" in
  *"ps --status running --services"*)
    [ -f "$S/engine_up" ] && echo engine
    exit 0 ;;
  *"exec -T engine test -x "*)
    n=${rest##*/}
    [ -f "$S/inst_$n" ]; exit $? ;;
  *"exec -T engine sh -c ls "*)
    [ -f "$S/inst_janitor" ]; exit $? ;;
  *"exec -T engine sh -c mkdir"*)
    cat > "$S/copied"; exit 0 ;;
  *"exec -T engine /data/tools/bin/sense"*)
    cat "$S/sense_out" 2>/dev/null; exit 0 ;;
  *"exec -T engine node dist/cli/bin.js shared-env run /data/tools/bin/mirror"*) n=mirror ;;
  *"exec -T engine node dist/cli/bin.js shared-env run /data/tools/bin/wt janitor"*) n=janitor ;;
  *"exec -T engine node dist/cli/bin.js shared-env run /data/tools/bin/tools-update"*) n=tools-update ;;
  *"system df"*)
    echo "Images 3.2GB"; echo "Containers 0B"; echo "Local Volumes 10.5GB"; echo "Build Cache 1.1GB"; exit 0 ;;
  *"ps -a"*"project=rerun "*|*"ps -a"*"project=rerun")
    echo rerun-engine-1; exit 0 ;;
  *"ps -a"*) exit 0 ;;
  *"inspect"*)
    echo "running 2 sha256:abcdef0123456789abcdef0123456789"; exit 0 ;;
  *"stats"*)
    echo "rerun-engine-1 12.5% 3.4%"; exit 0 ;;
  *) exit 0 ;;
esac
[ -f "$S/print_$n" ] && cat "$S/print_$n"
[ -f "$S/sleep_$n" ] && exec sleep "$(cat "$S/sleep_$n")"
rc=0
[ -f "$S/rc_$n" ] && rc=$(cat "$S/rc_$n")
exit "$rc"
"""

STANDINS = {
    "systemctl": '#!/bin/sh\necho "systemctl $*" >> "$CALLS"\n',
    "nproc": "#!/bin/sh\necho 4\n",
    "df": "#!/bin/sh\necho 'Filesystem 1024-blocks Used Available Capacity Mounted on'\necho '/dev/x 100000000 27000000 73000000 27% /'\n",
    "docker": DOCKER,
}

SERVICE = (
    "[Unit]\nDescription=Rerun machine keeper: housekeeping and readings (deploy/vps/keeper.sh)\nAfter=docker.service\n"
    "[Service]\nType=oneshot\nExecStart=%s run %s\nTimeoutStartSec=280\nNice=10\n"
)
TIMER = (
    "[Unit]\nDescription=Rerun machine keeper every 5 minutes\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=5min\n"
    "AccuracySec=30s\n[Install]\nWantedBy=timers.target\n"
)
TOKEN = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9]{20,}")


@unittest.skipIf(SH is None or os.name == "nt" or shutil.which("flock") is None, "runs a POSIX shell script with stand-in programs on PATH (CI runs it on Linux)")
class Keeper(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        self.bin = os.path.join(self.tmp, "bin")
        self.state = os.path.join(self.tmp, "state")
        self.repo = os.path.join(self.tmp, "repo")
        self.calls = os.path.join(self.tmp, "calls")
        for d in (self.bin, self.state, self.repo, os.path.join(self.root, "proc")):
            os.makedirs(d)
        with open(os.path.join(self.repo, "docker-compose.yml"), "w") as f:
            f.write("services: {}\n")
        for name, text in STANDINS.items():
            self.put(os.path.join(self.bin, name), text, 0o755)
        self.put(os.path.join(self.root, "proc", "loadavg"), "4.52 5.1 6.0 1/100 123\n")
        self.put(os.path.join(self.root, "proc", "meminfo"), "MemTotal: 16000000 kB\nMemAvailable:    7340032 kB\n")
        self.copy = os.path.join(self.root, "usr/local/sbin/rerun-keeper")
        self.sumfile = self.copy + ".sha256"
        self.units = os.path.join(self.root, "etc/systemd/system")
        self.machine = os.path.join(self.root, "var/lib/rerun-keeper/machine.json")

    def put(self, path, text, mode=0o644):
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, mode)

    def flag(self, name, text=""):
        self.put(os.path.join(self.state, name), text)

    def env(self, test_flag=True, **extra):
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], CALLS=self.calls, STATE=self.state, KEEPER_ROOT=self.root)
        env.pop("KEEPER_TEST", None)
        if test_flag:
            env["KEEPER_TEST"] = "1"
        env.update(extra)
        return env

    def sh(self, args, test_flag=True, script=SCRIPT, **extra):
        return subprocess.run([SH, script] + args, env=self.env(test_flag, **extra), capture_output=True, text=True)

    def install(self):
        done = self.sh(["install"])
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return done

    def run_copy(self, **extra):
        return subprocess.run([self.copy, "run", self.repo], env=self.env(**extra), capture_output=True, text=True)

    def made(self):
        if not os.path.exists(self.calls):
            return []
        with open(self.calls) as f:
            return f.read().splitlines()

    def docker_calls(self):
        return [c for c in self.made() if c.startswith("docker ")]

    def data(self):
        with open(self.machine) as f:
            return json.load(f)

    def readings(self):
        return {r["name"]: r for r in self.data()["readings"]}

    def hk(self):
        return {h["cmd"]: h["rc"] for h in self.data()["housekeeping"]}

    def engine_with(self, *names):
        self.flag("engine_up")
        for n in names:
            self.flag("inst_" + n)

    def test_install_writes_a_root_copy_its_checksum_and_a_five_minute_timer(self):
        self.install()
        self.assertEqual(self.made(), ["systemctl daemon-reload", "systemctl enable --now rerun-keeper.timer", "systemctl list-timers rerun-keeper.timer --no-pager"])
        repo = os.path.realpath(os.path.join(DEPLOY, "..", ".."))
        with open(os.path.join(self.units, "rerun-keeper.service")) as f:
            self.assertEqual(f.read(), SERVICE % (self.copy, repo))
        with open(os.path.join(self.units, "rerun-keeper.timer")) as f:
            self.assertEqual(f.read(), TIMER)
        with open(self.sumfile) as f:
            recorded = f.read().strip()
        self.assertEqual(len(recorded), 64)
        with open(self.copy, "rb") as f:
            self.assertEqual(recorded, hashlib.sha256(f.read()).hexdigest())
        self.assertTrue(os.stat(self.copy).st_mode & stat.S_IXUSR)
        self.assertEqual(sorted(os.listdir(os.path.dirname(self.copy))), ["rerun-keeper", "rerun-keeper.sha256"])
        self.os_uninstall()

    def os_uninstall(self):
        done = self.sh(["uninstall"])
        self.assertEqual(done.returncode, 0)
        self.assertEqual(os.listdir(self.units), [])
        self.assertEqual(os.listdir(os.path.dirname(self.copy)), [])

    def test_the_installed_copy_cannot_install_and_other_words_print_the_usage(self):
        self.install()
        done = subprocess.run([self.copy, "install"], env=self.env(), capture_output=True, text=True)
        self.assertEqual(done.returncode, 2)
        done = self.sh(["frobnicate"])
        self.assertEqual(done.returncode, 2)
        self.assertIn("Usage", done.stdout)

    def test_a_test_root_without_the_test_switch_is_refused(self):
        for name in ("install", "uninstall"):
            self.assertEqual(self.sh([name], test_flag=False).returncode, 2)
        self.assertFalse(os.path.exists(self.units))
        self.assertEqual(self.made(), [])

    def test_one_run_writes_one_json_file_with_the_host_readings_by_a_rename(self):
        self.install()
        done = self.run_copy()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        r = self.readings()
        for name, want in (("load_1", 4.52), ("load_5", 5.1), ("load_15", 6.0), ("cores", 4), ("mem_available_kb", 7340032), ("disk_free_kb", 73000000),
                           ("c.rerun-engine-1.restarts", 2), ("c.rerun-engine-1.cpu_pct", 12.5), ("c.rerun-engine-1.mem_pct", 3.4)):
            self.assertEqual(r[name]["value"], want, name)
        for name, want in (("c.rerun-engine-1.state", "running"), ("c.rerun-engine-1.image", "abcdef012345"), ("images_size", "3.2GB"), ("volumes_size", "10.5GB")):
            self.assertEqual(r[name]["value"], want, name)
        self.assertEqual(self.data()["version"], 1)
        self.assertEqual(self.data()["engine"], "down")
        self.assertEqual(sorted(os.listdir(os.path.dirname(self.machine))), ["machine.json", "skips"])
        self.assertEqual(stat.S_IMODE(os.stat(self.machine).st_mode), 0o644)

    def test_an_installed_copy_that_differs_from_its_checksum_is_refused(self):
        self.install()
        with open(self.copy, "a") as f:
            f.write("echo tampered\n")
        done = self.run_copy()
        self.assertEqual(done.returncode, 2)
        self.assertIn("REFUSED", done.stdout)
        self.assertFalse(os.path.exists(self.machine))
        self.assertEqual(self.docker_calls(), [])

    def test_the_clone_copy_never_runs(self):
        done = self.sh(["run", self.repo])
        self.assertEqual(done.returncode, 2)
        self.assertIn("run the installed copy", done.stdout)
        self.assertEqual(self.docker_calls(), [])

    def test_a_second_run_while_one_is_alive_does_nothing(self):
        self.install()
        os.makedirs(os.path.join(self.root, "run"), exist_ok=True)
        with open(os.path.join(self.root, "run", "rerun-keeper.lock"), "w") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            done = self.run_copy()
        self.assertEqual(done.returncode, 0)
        self.assertIn("another run is alive", done.stdout)
        self.assertEqual(self.docker_calls(), [])

    def test_housekeeping_runs_what_is_installed_skips_the_rest_and_one_failure_stops_nothing(self):
        self.install()
        self.engine_with("mirror", "tools-update")
        self.flag("rc_mirror", "1")
        self.flag("print_mirror", "first line\nmirror broke here\n")
        done = self.run_copy()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("janitor is not installed yet: skipped", done.stdout)
        self.assertIn("mirror exit 1: mirror broke here", done.stdout)
        self.assertEqual(self.hk(), {"mirror": 1, "tools-update": 0})
        self.assertEqual(self.data()["engine"], "running")
        ran = [c for c in self.docker_calls() if "shared-env run /data/tools/bin/" in c and "sense" not in c]
        self.assertEqual(len(ran), 2)
        self.assertTrue(all("--project-directory %s -f %s/docker-compose.yml" % (self.repo, self.repo) in c for c in ran))

    def test_a_hanging_command_is_stopped_at_its_cap_and_the_others_still_run(self):
        self.install()
        self.engine_with("mirror", "tools-update")
        self.flag("sleep_mirror", "30")
        began = time.time()
        done = self.run_copy(KEEPER_CAP="2")
        self.assertLess(time.time() - began, 20)
        self.assertIn("mirror stopped at its cap of 2 s", done.stdout)
        self.assertEqual(self.hk()["tools-update"], 0)
        self.assertEqual(self.hk()["mirror"], 124)

    def test_an_engine_that_is_not_running_skips_the_tick_and_two_skips_show(self):
        self.install()
        self.run_copy()
        done = self.run_copy()
        self.assertIn("engine is not running: housekeeping and factory readings skipped (2 in a row)", done.stdout)
        d = self.data()
        self.assertEqual((d["engine"], d["skippedTicks"], d["housekeeping"]), ("down", 2, []))
        self.assertIn("load_1", self.readings())
        self.engine_with()
        self.run_copy()
        self.assertEqual((self.data()["engine"], self.data()["skippedTicks"]), ("running", 0))

    def test_the_factory_readings_come_from_sense_in_the_engine_and_bad_output_is_null(self):
        self.install()
        self.engine_with()
        good = '{"version":1,"readings":[{"name":"x","value":1,"reason":null}]}'
        self.flag("sense_out", good)
        self.run_copy()
        self.assertEqual(self.data()["factory"], json.loads(good))
        with open(os.path.join(self.state, "copied")) as f:
            self.assertEqual(json.load(f)["factory"], json.loads(good))
        self.flag("sense_out", "Traceback (most recent call last):\n  boom\n")
        done = self.run_copy()
        self.assertEqual(self.data()["factory"]["readings"], [])
        self.assertIn("sense gave no reading", done.stdout)

    def test_a_full_file_holds_no_token_shape(self):
        self.install()
        self.engine_with("mirror", "janitor", "tools-update")
        self.flag("print_mirror", "ghp_" + "A1b2C3d4E5" * 3 + "\n")
        self.flag("rc_mirror", "1")
        done = self.run_copy()
        with open(self.machine) as f:
            text = f.read()
        self.assertIn('"cmd":"mirror"', text)
        self.assertIsNone(TOKEN.search(text))
        with open(os.path.join(self.state, "copied")) as f:
            self.assertIsNone(TOKEN.search(f.read()))
        self.assertIsNotNone(TOKEN.search(done.stdout))

    def test_no_compose_file_gives_the_engine_or_the_dispatcher_the_control_socket(self):
        for name in ("docker-compose.yml", "factory-dispatcher.yml", "factory-runner.yml", "code-intel.yml"):
            path = os.path.join(DEPLOY, name) if name != "docker-compose.yml" else os.path.join(DEPLOY, "..", "..", name)
            with open(path, encoding="utf-8") as f:
                self.assertNotIn("docker.sock", f.read(), name)

    def test_update_installs_the_keeper_after_the_restart_and_goes_on_when_it_fails(self):
        with open(os.path.join(DEPLOY, "update.sh"), encoding="utf-8") as f:
            text = f.read()
        tail = 'echo "== keeper"\nsh deploy/vps/keeper.sh install || echo "keeper install failed: the copy installed before stays"\n'
        self.assertIn(tail, text)
        self.assertLess(text.index("docker compose up -d"), text.index("keeper.sh install"))
        self.assertTrue(text.endswith('sh deploy/vps/doctor.sh || echo "The checks above found a problem. The deploy itself is done."\n'))


if __name__ == "__main__":
    unittest.main()
