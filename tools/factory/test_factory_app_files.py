import os
import shutil
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
VPS = os.path.join(ROOT, "deploy", "vps")
TMPFS = 'driver_opts: {type: tmpfs, device: tmpfs, o: "uid=10001,gid=10001,mode=0755,size=64k"}'
KEY = (subprocess.run(["openssl", "genrsa", "2048"], capture_output=True, text=True).stdout if shutil.which("openssl")
       else "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


class Files(unittest.TestCase):
    def test_the_token_service_lives_only_in_its_own_overlay(self):
        app = read(VPS, "factory-app.yml")
        for part in ("factory-token:", '["python3", "-u", "/app/apptoken.py"]', "./tools/factory:/app:ro", "factory-token:/token\n",
                     "FACTORY_APP_ID: ${FACTORY_APP_ID:?", "FACTORY_APP_INSTALLATION: ${FACTORY_APP_INSTALLATION:?",
                     "file: ${FACTORY_APP_KEY_FILE:?", "cap_drop:\n      - ALL", "read_only: true", "dockerfile: factory-runner.Dockerfile"):
            self.assertIn(part, app)
        self.assertNotIn("factory-app.yml", read(VPS, "docker-compose.vps.yml"))
        self.assertNotIn("factory-app.yml", read(VPS, "make-env.sh"))

    def test_the_engine_and_the_dispatcher_read_the_same_token_volume(self):
        engine = read(ROOT, "docker-compose.yml")
        disp = read(VPS, "factory-dispatcher.yml")
        self.assertIn("      - factory-token:/run/factory-token:ro\n", engine)
        self.assertIn("      - factory-token:/token:ro\n", disp)
        for text in (engine, disp):
            self.assertIn("  factory-token:\n    name: rerun_factory-token\n    " + TMPFS, text)

    def test_the_image_can_sign_with_openssl(self):
        self.assertRegex(read(VPS, "factory-runner.Dockerfile"), r"apt-get install -y --no-install-recommends [^\n]*\bopenssl\b")


class Trust(unittest.TestCase):
    def test_every_brief_that_trusts_the_owner_also_trusts_the_factory_bot(self):
        found = 0
        for name in ("briefs.py", "dispatch.py", "planning.py"):
            for line in read(HERE, name).splitlines():
                if "special-place-administrator" in line and "instruction" in line:
                    found += 1
                    self.assertIn("moldwright-factory[bot]", line, name)
        self.assertEqual(found, 7)

    def test_the_runner_trusts_text_written_by_the_factory_bot(self):
        import runner_loop
        self.assertTrue(runner_loop._trusted({"author_association": "NONE", "user": {"login": "moldwright-factory[bot]"}}))
        self.assertFalse(runner_loop._trusted({"author_association": "NONE", "user": {"login": "someone"}}))


@unittest.skipUnless(shutil.which("sh"), "needs sh")
class AddApp(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self.dir.name, "repo")
        os.makedirs(os.path.join(self.repo, "deploy", "vps"))
        shutil.copy(os.path.join(VPS, "add-app.sh"), os.path.join(self.repo, "deploy", "vps", "add-app.sh"))
        self.keys = os.path.join(self.dir.name, "keys")
        with open(os.path.join(self.repo, ".env"), "w") as f:
            f.write("RERUN_APP_HOST=app.example\nCOMPOSE_FILE=docker-compose.yml:deploy/vps/docker-compose.vps.yml\n")

    def tearDown(self):
        self.dir.cleanup()

    def run_add(self, key):
        env = dict(os.environ, FACTORY_KEYS_DIR=self.keys, FACTORY_KEY_OWNER="%d:%d" % (os.getuid(), os.getgid()))
        return subprocess.run(["sh", os.path.join(self.repo, "deploy", "vps", "add-app.sh")], input=key, capture_output=True, text=True, env=env)

    def env(self):
        return read(self.repo, ".env")

    def test_a_pasted_key_is_stored_locked_and_the_overlay_joins_the_deploy(self):
        p = self.run_add(KEY)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        path = os.path.join(self.keys, "moldwright-factory.pem")
        self.assertEqual(read(path), KEY)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o400)
        env = self.env()
        for line in ("FACTORY_APP_KEY_FILE='%s'" % path, "FACTORY_APP_ID='5822204'", "FACTORY_APP_INSTALLATION='183438800'",
                     "COMPOSE_FILE='docker-compose.yml:deploy/vps/docker-compose.vps.yml:deploy/vps/factory-app.yml'"):
            self.assertIn(line, env)
        self.assertNotIn(KEY.splitlines()[1], p.stdout + p.stderr)

    def test_running_it_twice_adds_the_overlay_once(self):
        self.run_add(KEY)
        os.chmod(os.path.join(self.keys, "moldwright-factory.pem"), 0o600)
        self.run_add(KEY)
        self.assertEqual(self.env().count("factory-app.yml"), 1)

    def test_text_that_is_not_a_private_key_changes_nothing(self):
        before = self.env()
        p = self.run_add("hello\n")
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(self.env(), before)
        self.assertFalse(os.path.exists(os.path.join(self.keys, "moldwright-factory.pem")))


if __name__ == "__main__":
    unittest.main()
