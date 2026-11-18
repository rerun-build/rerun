import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
VPS = os.path.join(HERE, "..", "..", "deploy", "vps")
SH = shutil.which("sh")
ENV = ("RERUN_APP_HOST='rerun.example.org'\nNEXT_PUBLIC_APP_URL='https://rerun.example.org'\n"
       "COMPOSE_FILE='docker-compose.yml:deploy/vps/docker-compose.vps.yml'\n")
SUPA = "SITE_URL=https://rerun.example.org\nADDITIONAL_REDIRECT_URLS=https://rerun.example.org/**\nJWT_EXPIRY=3600\n"


@unittest.skipIf(SH is None, "no sh on PATH: these tests run deploy/vps scripts (CI runs them on Linux)")
class MoveHost(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        os.makedirs(os.path.join(self.tmp, "deploy", "vps"))
        shutil.copy(os.path.join(VPS, "move-host.sh"), os.path.join(self.tmp, "deploy", "vps", "move-host.sh"))
        self.write(".env", ENV)
        self.write("supabase.env", SUPA)

    def write(self, name, text):
        with open(os.path.join(self.tmp, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

    def read(self, name):
        with open(os.path.join(self.tmp, name), encoding="utf-8") as f:
            return f.read()

    def move(self, host):
        p = subprocess.run([SH, "deploy/vps/move-host.sh", host], cwd=self.tmp, capture_output=True, text=True,
                           env=dict(os.environ, SUPABASE_ENV=os.path.join(self.tmp, "supabase.env")), timeout=60)
        self.out = p.stdout + p.stderr
        return p.returncode

    def test_the_app_moves_and_the_old_name_is_kept_for_the_redirect(self):
        self.assertEqual(self.move("moldwright.example.org"), 0, self.out)
        self.assertEqual(self.read(".env"),
                         "RERUN_APP_HOST='moldwright.example.org'\nNEXT_PUBLIC_APP_URL='https://moldwright.example.org'\n"
                         "COMPOSE_FILE='docker-compose.yml:deploy/vps/docker-compose.vps.yml:deploy/vps/moved-host.yml'\n"
                         "RERUN_OLD_APP_HOST='rerun.example.org'\n")
        self.assertEqual(self.read("supabase.env"),
                         "SITE_URL=https://moldwright.example.org\n"
                         "ADDITIONAL_REDIRECT_URLS=https://rerun.example.org/**,https://moldwright.example.org/**\nJWT_EXPIRY=3600\n")

    def test_running_it_again_changes_nothing(self):
        self.move("moldwright.example.org")
        env, supa = self.read(".env"), self.read("supabase.env")
        self.assertEqual(self.move("moldwright.example.org"), 0, self.out)
        self.assertEqual((self.read(".env"), self.read("supabase.env")), (env, supa))

    def test_a_name_that_is_not_a_host_changes_nothing(self):
        for bad in ("moldwright", "https://moldwright.example.org", "a b.org", ""):
            self.assertNotEqual(self.move(bad), 0, bad)
        self.assertEqual((self.read(".env"), self.read("supabase.env")), (ENV, SUPA))

    def test_the_redirect_overlay_sends_the_old_name_to_the_new_one(self):
        with open(os.path.join(VPS, "moved-host.yml"), encoding="utf-8") as f:
            text = f.read()
        for part in ("Host(`${RERUN_OLD_APP_HOST:?", "redirectregex.replacement=https://${RERUN_APP_HOST:?", "tls.certresolver=letsencrypt",
                     "redirectregex.permanent=true"):
            self.assertIn(part, text)


if __name__ == "__main__":
    unittest.main()
