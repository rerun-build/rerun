#!/usr/bin/env python3
import base64, os, shutil, stat, subprocess, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
VPS = os.path.join(HERE, "..", "..", "deploy", "vps")
SH = shutil.which("sh")
HEX = "ab" * 32


@unittest.skipIf(SH is None, "no sh on PATH: these tests run deploy/vps scripts (CI runs them on Linux)")
class EnvScripts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        os.makedirs(os.path.join(self.tmp, "deploy", "vps"))
        for name in ("set-env.sh", "add-web.sh", "add-router.sh", "make-env.sh"):
            shutil.copy(os.path.join(VPS, name), os.path.join(self.tmp, "deploy", "vps", name))
        os.makedirs(os.path.join(self.tmp, "bin"))
        self.write("bin/docker", '#!/bin/sh\necho "$*" >> "$DOCKER_LOG"\n', 0o755)
        self.write("bin/openssl", "#!/bin/sh\necho %s\n" % HEX, 0o755)

    def path(self, rel):
        return os.path.join(self.tmp, *rel.split("/"))

    def write(self, rel, text, mode=None):
        with open(self.path(rel), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        if mode:
            os.chmod(self.path(rel), mode)

    def read(self, rel):
        with open(self.path(rel), encoding="utf-8") as f:
            return f.read()

    def run_script(self, name, args=(), answer="", extra=None):
        env = dict(os.environ, PATH=self.path("bin") + os.pathsep + os.environ.get("PATH", ""),
                   DOCKER_LOG=self.path("docker.log"))
        env.pop("CRAWL4AI_URL", None)
        env.update(extra or {})
        p = subprocess.run([SH, "deploy/vps/" + name, *args], cwd=self.tmp, input=answer.encode(),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=60)
        self.out = p.stdout.decode("utf-8", "replace")
        return p.returncode

    def docker_log(self):
        if not os.path.exists(self.path("docker.log")):
            return None
        return self.read("docker.log")

    def mode(self, rel):
        return stat.S_IMODE(os.stat(self.path(rel)).st_mode)

    def test_set_env_writes_each_value_quoted_once_and_restarts_the_app(self):
        self.write(".env", "A=1\nKEY_X='old'\n")
        self.assertEqual(self.run_script("set-env.sh", ["KEY_X", "NEW_KEY"], "v-one\nv-two\n"), 0)
        self.assertEqual(self.read(".env"), "A=1\nKEY_X='v-one'\nNEW_KEY='v-two'\n")
        self.assertIn("Set: KEY_X NEW_KEY", self.out)
        self.assertNotIn("v-one", self.out)
        self.assertEqual(self.docker_log(), "compose up -d app\n")

    def test_set_env_changes_nothing_for_a_bad_key_or_a_quoted_value(self):
        self.write(".env", "A=1\n")
        self.assertEqual(self.run_script("set-env.sh", ["bad-key", "GOOD"], "it's\n"), 0)
        self.assertEqual(self.read(".env"), "A=1\n")
        self.assertIn("Skipping 'bad-key'", self.out)
        self.assertIn("Nothing changed.", self.out)
        self.assertIsNone(self.docker_log())

    def test_add_web_fills_only_missing_keys_and_keeps_the_file_private(self):
        self.write(".env", "WEBGATE_KEY='keep'\n")
        self.assertEqual(self.run_script("add-web.sh", answer="tok-123456\n"), 0)
        self.assertEqual(self.read(".env"),
                         "WEBGATE_KEY='keep'\nSEARXNG_SECRET='%s'\n"
                         "CRAWL4AI_URL='https://crawl4ai.robagentic.tech'\nCRAWL4AI_TOKEN='tok-123456'\n" % HEX)
        self.assertIn("Added or updated: SEARXNG_SECRET CRAWL4AI_URL CRAWL4AI_TOKEN", self.out)
        self.assertNotIn("tok-123456", self.out)
        self.assertEqual(self.mode(".env"), 0o600)
        self.assertFalse(os.path.exists(self.path(".env.tmp")))

    def test_add_web_with_enter_alone_keeps_the_token_empty_and_says_so(self):
        self.write(".env", "")
        self.assertEqual(self.run_script("add-web.sh", answer="\n"), 0)
        self.assertNotIn("CRAWL4AI_TOKEN=", self.read(".env"))
        self.assertIn("CRAWL4AI_TOKEN is still empty", self.out)

    def test_add_router_fills_what_is_missing_hides_the_password_and_adds_its_file_once(self):
        self.write(".env", "RERUN_APP_HOST='rerun.example.org'\nCOMPOSE_FILE='docker-compose.yml:deploy/vps/docker-compose.vps.yml'\n")
        self.assertEqual(self.run_script("add-router.sh", answer="a-long-password-1\n198.51.100.4/32\n"), 0)
        self.assertEqual(self.read(".env"),
                         "RERUN_APP_HOST='rerun.example.org'\n"
                         "COMPOSE_FILE='docker-compose.yml:deploy/vps/docker-compose.vps.yml:deploy/vps/router.yml'\n"
                         "ROUTER_JWT_SECRET='%s'\nROUTER_API_KEY_SECRET='%s'\nROUTER_HOST='router.example.org'\n"
                         "ROUTER_PASSWORD='a-long-password-1'\nROUTER_ADMIN_CIDR='198.51.100.4/32'\n" % (HEX, HEX))
        self.assertNotIn("a-long-password-1", self.out)
        self.assertNotIn(HEX, self.out)
        self.assertIn("router.example.org", self.out)
        self.assertEqual(self.mode(".env"), 0o600)
        self.assertEqual([n for n in os.listdir(self.tmp) if n.startswith(".env.")], [])
        before = self.read(".env")
        self.assertEqual(self.run_script("add-router.sh"), 0)
        self.assertEqual(self.read(".env"), before)
        self.assertIn("Added or updated: nothing", self.out)

    def test_add_router_refuses_a_short_password_and_sets_none(self):
        self.write(".env", "RERUN_APP_HOST='rerun.example.org'\n")
        self.assertEqual(self.run_script("add-router.sh", answer="short\n"), 1)
        self.assertNotIn("ROUTER_PASSWORD", self.read(".env"))
        self.assertNotIn("router.yml", self.read(".env"))
        self.assertNotIn("short", self.out)

    def test_add_router_refuses_a_range_that_is_not_one(self):
        self.write(".env", "RERUN_APP_HOST='rerun.example.org'\n")
        self.assertEqual(self.run_script("add-router.sh", answer="a-long-password-1\n1.2.3.4; echo x\n"), 1)
        self.assertNotIn("ROUTER_ADMIN_CIDR", self.read(".env"))
        self.assertNotIn("router.yml", self.read(".env"))

    def test_make_env_builds_the_file_from_supabase_and_the_bundle(self):
        self.write(".env.example", "EXAMPLE=1\n")
        self.write("supabase.env",
                   "SUPABASE_PUBLIC_URL=https://db.example\nANON_KEY=anon-k\nSERVICE_ROLE_KEY=svc-k\n"
                   "SMTP_HOST=smtp.example\nSMTP_PORT=587\nSMTP_USER=mailer\nSMTP_PASS=smtp-pw\n"
                   "SMTP_SENDER_NAME=Rerun\nSMTP_ADMIN_EMAIL=a@example.org\n")
        bundle = base64.b64encode(b"OPENROUTER_API_KEY=or-key-1\nRERUN_ENGINE_API_KEY=eng-key-1\n").decode()
        code = self.run_script("make-env.sh", answer=bundle + "\n", extra={"SUPABASE_ENV": self.path("supabase.env")})
        self.assertEqual(code, 0, self.out)
        lines = self.read(".env").splitlines()
        for line in ("EXAMPLE=1", "NEXT_PUBLIC_SUPABASE_URL='https://db.example'", "SUPABASE_SECRET_KEY='svc-k'",
                     "SMTP_FROM='Rerun <a@example.org>'", "OPENROUTER_API_KEY='or-key-1'",
                     "RERUN_ENGINE_API_KEY='eng-key-1'", "WEBGATE_KEY='%s'" % HEX):
            self.assertIn(line, lines)
        self.assertIn("Still empty: RERUN_EMBED_API_KEY FOREMAN_HUB_TOKEN_SECRET BOARD_IMAGE_SECRET "
                      "ADMIN_EMAILS SIGN_UP_EMAILS CRAWL4AI_TOKEN(sudo sh deploy/vps/add-web.sh)", self.out)
        for secret in ("or-key-1", "eng-key-1", "svc-k", "smtp-pw"):
            self.assertNotIn(secret, self.out)
        self.assertEqual(self.mode(".env"), 0o600)

    def test_make_env_refuses_to_overwrite_an_existing_env(self):
        self.write(".env", "KEEP=1\n")
        self.assertEqual(self.run_script("make-env.sh"), 1)
        self.assertEqual(self.read(".env"), "KEEP=1\n")
        self.assertIn(".env exists already", self.out)


if __name__ == "__main__":
    unittest.main()
