import os
import shutil
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
VPS = os.path.join(HERE, "..", "..", "deploy", "vps")
SH = shutil.which("sh")
DOCKER = """#!/bin/sh
case "$*" in
  "compose config --services") printf 'app\\nengine\\nfactory-dispatcher\\n%s' "$TOKEN_SERVICE" ;;
  "compose logs --since 5m factory-dispatcher") cat "$LOGS" ;;
  "compose exec -T factory-token stat -c %Y /token/token") echo "$TOKEN_AT" ;;
  *) echo "unexpected docker $*" >&2; exit 9 ;;
esac
"""
CURL = '#!/bin/sh\necho "$CURL_CODE"\n'
BEAT = "factory-dispatcher-1  | 2026-11-19T00:01:00Z beat 3 | waiting 1, queued 0\n"


@unittest.skipIf(SH is None, "no sh on PATH: these tests run deploy/vps scripts (CI runs them on Linux)")
class Doctor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        os.makedirs(os.path.join(self.tmp, "deploy", "vps"))
        os.makedirs(os.path.join(self.tmp, "bin"))
        shutil.copy(os.path.join(VPS, "doctor.sh"), os.path.join(self.tmp, "deploy", "vps", "doctor.sh"))
        for name, text in (("bin/docker", DOCKER), ("bin/curl", CURL)):
            self.write(name, text)
            os.chmod(os.path.join(self.tmp, name), 0o755)
        self.write(".env", "RERUN_APP_HOST='app.example.org'\nRERUN_ENGINE_HOST='engine.example.org'\nRERUN_OLD_APP_HOST='old.example.org'\n")
        self.write("deploy/vps/.env", "FACTORY_ACCOUNT_URL='https://app.example.org/api/mcp'\n")
        self.write("logs", BEAT)

    def write(self, name, text):
        with open(os.path.join(self.tmp, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

    def run_doctor(self, code="200", token="factory-token\n", token_at=None):
        env = dict(os.environ, PATH=os.path.join(self.tmp, "bin") + os.pathsep + os.environ["PATH"], DOCTOR_WAIT_S="0",
                   DOCTOR_SINCE="2026-11-19T00:00:30Z",
                   CURL_CODE=code, LOGS=os.path.join(self.tmp, "logs"), TOKEN_SERVICE=token,
                   TOKEN_AT=str(int(time.time()) - 60 if token_at is None else token_at))
        p = subprocess.run([SH, "deploy/vps/doctor.sh"], cwd=self.tmp, capture_output=True, text=True, env=env, timeout=60)
        self.out = p.stdout + p.stderr
        return p.returncode

    def test_a_healthy_install_passes_every_check(self):
        self.assertEqual(self.run_doctor(), 0, self.out)
        self.assertNotIn("FAIL", self.out)
        for part in ("https://app.example.org", "https://engine.example.org", "dispatcher", "token", ".env"):
            self.assertIn(part, self.out)

    def test_a_dispatcher_that_gets_http_errors_fails_with_the_line(self):
        self.write("logs", BEAT + "factory-dispatcher-1  | 2026-11-19T00:01:05Z #1455 building: account list_runs failed: HTTP 308\n")
        self.assertEqual(self.run_doctor(), 1)
        self.assertIn("FAIL dispatcher", self.out)
        self.assertIn("HTTP 308", self.out)

    def test_an_error_from_before_the_check_started_is_not_counted(self):
        self.write("logs", "factory-dispatcher-1  | 2026-11-19T00:00:10Z #1406 send raised: account send_message failed: HTTP 401\n" + BEAT)
        self.assertEqual(self.run_doctor(), 0, self.out)

    def test_a_beat_from_before_the_check_started_is_not_enough(self):
        self.write("logs", "factory-dispatcher-1  | 2026-11-19T00:00:10Z beat 2 | waiting 1, queued 0\n")
        self.assertEqual(self.run_doctor(), 1)
        self.assertIn("FAIL dispatcher", self.out)

    def test_a_dispatcher_with_no_beat_fails(self):
        self.write("logs", "")
        self.assertEqual(self.run_doctor(), 1)
        self.assertIn("FAIL dispatcher", self.out)

    def test_a_setting_that_still_names_the_old_address_fails_by_its_name_only(self):
        self.write("deploy/vps/.env", "FACTORY_ACCOUNT_URL='https://old.example.org/api/mcp'\nSECRET_X='abc'\n")
        self.assertEqual(self.run_doctor(), 1)
        self.assertIn("FACTORY_ACCOUNT_URL", self.out)
        self.assertNotIn("api/mcp", self.out)

    def test_an_address_that_does_not_answer_fails(self):
        self.assertEqual(self.run_doctor(code="000"), 1)
        self.assertIn("FAIL https://app.example.org", self.out)

    def test_a_stale_app_token_fails_and_no_token_service_is_skipped(self):
        self.assertEqual(self.run_doctor(token_at=int(time.time()) - 7200), 1)
        self.assertIn("FAIL token", self.out)
        self.assertEqual(self.run_doctor(token=""), 0, self.out)


if __name__ == "__main__":
    unittest.main()
