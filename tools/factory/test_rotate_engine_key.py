#!/usr/bin/env python3
import json, os, re, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "..", "deploy", "vps", "rotate-engine-key.sh")
FAKE = os.path.join(HERE, "fixtures", "fake_docker.py")
SH = shutil.which("sh")

OLD = "Old_key-" + "a1B2" * 8
NEW = "0123456789abcdef" * 4
OTHER = "Other.key+" + "z9" * 16
PW = "pg-" + "secret" * 4
SECRETS = (OLD, NEW, OTHER, PW)


def posix(p):
    return p.replace("\\", "/")


@unittest.skipIf(SH is None, "no sh on PATH: these tests run deploy/vps/rotate-engine-key.sh (CI runs them on Linux)")
class RotateEngineKey(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        os.makedirs(os.path.join(self.tmp, "deploy", "vps"))
        shutil.copy(SCRIPT, os.path.join(self.tmp, "deploy", "vps", "rotate-engine-key.sh"))
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        os.makedirs(self.path("supabase"))
        self.write("bin/docker", '#!/bin/sh\nexec "$FAKE_PYTHON" "$FAKE_DOCKER_PY" "$@"\n', 0o755)
        self.openssl(NEW)
        self.write("supabase/.env", "POSTGRES_PASSWORD='%s'\n" % PW)
        self.write(".env", "COMPOSE_FILE=docker-compose.yml\nRERUN_ENGINE_API_KEY='%s'\nOTHER_SETTING=1\n" % OLD)
        self.state = {"rows": [{"workspace": "w1", "engine_api_key": OLD, "updated_at": None}],
                      "engine_key": OLD, "running": ["app", "engine"], "calls": [], "violations": [], "unknown": [],
                      "db_modes": ["socket", "local", "password"], "engine_open": False, "app_refuses": False,
                      "dbc": "supabase-db", "pg_password": PW, "tables": ["public.engine_pool"], "secrets": list(SECRETS)}

    def path(self, rel):
        return os.path.join(self.tmp, *rel.split("/"))

    def write(self, rel, text, mode=None):
        with open(self.path(rel), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        if mode:
            os.chmod(self.path(rel), mode)

    def read(self, rel):
        with open(self.path(rel), "rb") as f:
            return f.read()

    def exists(self, rel):
        return os.path.exists(self.path(rel))

    def openssl(self, value):
        body = "" if value is None else "printf '%%s\\n' '%s'\n" % value
        self.write("bin/openssl", '#!/bin/sh\nprintf "called\\n" >> "$FAKE_OPENSSL_LOG"\n' + body, 0o755)

    def run_script(self, mode, answer="", wait_s="0"):
        sp = self.path("state.json")
        with open(sp, "w", encoding="utf-8") as f:
            json.dump(self.state, f)
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ.get("PATH", ""),
                   FAKE_PYTHON=posix(sys.executable), FAKE_DOCKER_PY=posix(FAKE), FAKE_DOCKER_STATE=sp,
                   FAKE_OPENSSL_LOG=posix(self.path("openssl.log")), SUPABASE_DIR=posix(self.path("supabase")),
                   ROTATE_POLL_S="0", ROTATE_WAIT_S=wait_s)
        env.pop("SUPABASE_DB_CONTAINER", None)
        p = subprocess.run([SH, "deploy/vps/rotate-engine-key.sh", mode], cwd=self.tmp, input=answer.encode(),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=300)
        self.out = p.stdout.decode("utf-8", "replace")
        with open(sp, encoding="utf-8") as f:
            self.state = json.load(f)
        for s in SECRETS:
            self.assertNotIn(s, self.out)
            for c in self.state["calls"]:
                self.assertNotIn(s, "\0".join(c["argv"]))
        self.assertEqual(self.state["violations"], [], self.out)
        self.assertEqual(self.state["unknown"], [], self.out)
        return p.returncode

    def argvs(self):
        return [c["argv"] for c in self.state["calls"]]

    def stopped(self):
        return ["compose", "stop", "app", "engine"] in self.argvs()

    def ups(self):
        return [c for c in self.state["calls"] if c["argv"] == ["compose", "up", "-d"]]

    def keys(self):
        return [r["engine_api_key"] for r in self.state["rows"]]

    def env_value(self):
        lines = [l for l in self.read(".env").decode().splitlines() if l.startswith("RERUN_ENGINE_API_KEY=")]
        return lines[-1].split("=", 1)[1]

    def rotate(self, answer="ROTATE\n"):
        return self.run_script("rotate", answer)

    def test_check_changes_nothing_and_reports_one_row(self):
        before = self.read(".env")
        self.assertEqual(self.run_script("check"), 0, self.out)
        self.assertEqual(self.read(".env"), before)
        self.assertEqual(self.keys(), [OLD])
        self.assertFalse(self.stopped())
        self.assertEqual(self.ups(), [])
        self.assertFalse(self.exists(".env.engine-key-rotation"))
        for line in ("env-key acceptable=yes quoting=single", "db-access=socket", "db-tables-with-engine_api_key public.engine_pool",
                     "db-triggers-on-engine_pool none", "db-publications-with-engine_pool none",
                     "db-rows-holding-current-key 1 (expect 1)", "db-rehearsal swapped (rolled back)", "running app engine",
                     "engine-no-key http=401",
                     "engine-current-key http=200", "app-current-key http=400", "record absent"):
            self.assertIn(line, self.out)

    def test_check_falls_back_to_the_password_and_keeps_it_off_the_command_line(self):
        self.state["db_modes"] = ["password"]
        self.assertEqual(self.run_script("check"), 0, self.out)
        self.assertIn("db-access=password", self.out)
        self.assertIn("db-rows-holding-current-key 1", self.out)
        self.assertIn(["exec", "-i", "-e", "PGPASSWORD", "supabase-db"], [a[:5] for a in self.argvs()])

    def test_check_shows_what_else_touches_the_row_names_only(self):
        self.state["triggers"] = ["engine_pool_touch", "audit_2"]
        self.state["publications"] = ["supabase_realtime"]
        self.assertEqual(self.run_script("check"), 0, self.out)
        self.assertIn("db-triggers-on-engine_pool engine_pool_touch,audit_2\n", self.out)
        self.assertIn("db-publications-with-engine_pool supabase_realtime\n", self.out)
        self.assertIn("info", [c.get("sql") for c in self.state["calls"]])
        self.state["triggers"] = ["fine", "not a; name"]
        self.assertEqual(self.run_script("check"), 0, self.out)
        self.assertIn("db-triggers-on-engine_pool error\n", self.out)
        self.assertNotIn("not a; name", self.out)

    def test_the_fake_refuses_an_info_program_holding_a_key_or_a_copy(self):
        sys.path.insert(0, os.path.dirname(FAKE))
        self.addCleanup(sys.path.remove, os.path.dirname(FAKE))
        import fake_docker
        for text in ("-- rotate-engine-key: info\nselect '%s';\n" % OLD, "-- rotate-engine-key: info\ncopy k from stdin;\nx\n\\.\n"):
            st = dict(self.state, calls=[{"argv": []}], violations=[])
            self.assertEqual(fake_docker.sql(st, text)[0], 9)
            self.assertEqual(len(st["violations"]), 1)

    def test_check_without_a_throwaway_key_skips_the_rehearsal(self):
        self.openssl(None)
        self.assertEqual(self.run_script("check"), 0, self.out)
        self.assertIn("db-rehearsal skipped", self.out)
        self.assertEqual(self.keys(), [OLD])

    def test_rotate_happy_path(self):
        self.assertEqual(self.rotate(), 0, self.out)
        calls = self.state["calls"]
        stop = self.argvs().index(["compose", "stop", "app", "engine"])
        rehearse = next(i for i, c in enumerate(calls) if c.get("sql") == "rehearse")
        self.assertLess(rehearse, stop)
        swap = next(i for i, c in enumerate(calls) if c.get("sql") == "swap")
        up = next(i for i, c in enumerate(calls) if c["argv"] == ["compose", "up", "-d"])
        self.assertLess(stop, swap)
        self.assertLess(swap, up)
        self.assertEqual(calls[up]["env_key"], NEW)
        self.assertEqual(len(self.ups()), 1)
        self.assertEqual(self.keys(), [NEW])
        self.assertEqual(self.env_value(), "'%s'" % NEW)
        self.assertIn(b"OTHER_SETTING=1\n", self.read(".env"))
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % OLD).encode())
        self.assertIn("rotate complete", self.out)
        self.assertNotIn("FAIL", self.out)
        self.assertFalse(self.exists(".env.tmp"))

    @unittest.skipIf(os.name == "nt", "no POSIX file modes on Windows")
    def test_rotate_keeps_the_mode_of_env(self):
        os.chmod(self.path(".env"), 0o640)
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertEqual(os.stat(self.path(".env")).st_mode & 0o777, 0o640)
        self.assertFalse(self.exists(".env.tmp"))

    def test_rotate_waits_for_an_app_that_needs_a_few_polls(self):
        self.state["app_slow"] = 3
        self.assertEqual(self.run_script("rotate", "ROTATE\n", wait_s="60"), 0, self.out)
        self.assertIn("verify app-new-key http=400 ok", self.out)
        self.assertEqual(self.state["app_slow"], 0)
        hub = [c for c in self.argvs() if "http://app:3000/api/hub" in c]
        self.assertGreater(len(hub), 3 + 1)
        self.assertIn("rotate complete", self.out)

    def test_quoting_single_double_none_reads_the_same_key(self):
        for line, quoting in (("'%s'" % OLD, "single"), ('"%s"' % OLD, "double"), (OLD, "none")):
            self.write(".env", "RERUN_ENGINE_API_KEY=%s\n" % line)
            self.state["calls"] = []
            self.assertEqual(self.run_script("check"), 0, self.out)
            self.assertIn("env-key acceptable=yes quoting=%s" % quoting, self.out)
            self.assertIn("db-rows-holding-current-key 1 (expect 1)", self.out)
        self.write(".env", 'RERUN_ENGINE_API_KEY="%s"\n' % OLD)
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertEqual(self.keys(), [NEW])

    def test_zero_matching_rows_is_refused_before_anything_stops(self):
        self.state["rows"] = [{"workspace": "w1", "engine_api_key": OTHER, "updated_at": None}]
        before = self.read(".env")
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertEqual(self.read(".env"), before)
        self.assertEqual(self.keys(), [OTHER])
        self.assertFalse(self.stopped())
        self.assertEqual(self.ups(), [])
        self.assertIn("quoted", self.out)
        self.assertIn("db-rehearsal FAIL", self.out)
        self.assertIn("rows_old=0 rows_new=0", self.out)
        self.assertIn("nothing was stopped", self.out)
        self.assertFalse(self.exists(".env.engine-key-rotation"))
        self.write(".env", "RERUN_ENGINE_API_KEY='%s'\n" % OTHER)
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertEqual(self.keys(), [NEW])
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % OTHER).encode())

    def test_a_database_failure_after_the_stop_restarts_with_the_old_key_and_puts_the_record_back(self):
        self.write(".env.engine-key-rotation", "PREVIOUS=%s\n" % OTHER)
        self.state["swap_fails"] = True
        before = self.read(".env")
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertTrue(self.stopped())
        self.assertIn("db-swap FAIL", self.out)
        self.assertEqual(sorted(self.state["running"]), ["app", "engine"])
        self.assertEqual(self.ups()[-1]["env_key"], OLD)
        self.assertEqual(self.read(".env"), before)
        self.assertEqual(self.keys(), [OLD])
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % OTHER).encode())

    def test_a_change_whose_answer_was_lost_is_carried_through(self):
        self.state["swap_reply_lost"] = True
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertIn("its answer was lost", self.out)
        self.assertEqual(self.keys(), [NEW])
        self.assertEqual(self.env_value(), "'%s'" % NEW)
        self.assertEqual(self.ups()[-1]["env_key"], NEW)
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % OLD).encode())
        self.assertIn("rotate complete", self.out)

    def test_a_database_gone_after_the_stop_starts_nothing_and_keeps_the_record(self):
        self.state["db_down_at_swap"] = True
        before = self.read(".env")
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertTrue(self.stopped())
        self.assertIn("database state is unknown", self.out)
        self.assertIn("left STOPPED", self.out)
        self.assertEqual(self.ups(), [])
        self.assertNotIn("engine", self.state["running"])
        self.assertEqual(self.read(".env"), before)
        self.assertEqual(self.read(".env.engine-key-rotation"), ("OLD=%s\nNEW=%s\n" % (OLD, NEW)).encode())

    def test_minting_nothing_or_a_bad_value_stops_before_anything(self):
        for value in (None, "", "XYZ" * 22, "0123456789abcdef" * 3):
            self.openssl(value)
            self.state["calls"] = []
            before = self.read(".env")
            self.assertNotEqual(self.rotate(), 0, self.out)
            self.assertIn("mint FAIL", self.out)
            self.assertFalse(self.stopped())
            self.assertEqual(self.read(".env"), before)
            self.assertFalse(self.exists(".env.engine-key-rotation"))

    def test_resume_finishes_with_the_same_new_key_and_mints_nothing(self):
        self.state["rows"][0]["engine_api_key"] = NEW
        self.write(".env.engine-key-rotation", "OLD=%s\nNEW=%s\n" % (OLD, NEW))
        self.openssl("f" * 64)
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertFalse(self.exists("openssl.log"))
        self.assertIn("db-swap already", self.out)
        self.assertEqual(self.keys(), [NEW])
        self.assertEqual(self.env_value(), "'%s'" % NEW)
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % OLD).encode())

    def test_rollback_after_a_rotation_restores_the_old_key(self):
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertEqual(self.run_script("rollback", "ROLLBACK\n"), 0, self.out)
        warn = self.out.find("brings that exposure back")
        self.assertGreaterEqual(warn, 0, self.out)
        self.assertLess(warn, self.out.find("Type ROLLBACK to go on"))
        self.assertEqual(self.keys(), [OLD])
        self.assertEqual(self.env_value(), "'%s'" % OLD)
        self.assertEqual(self.state["engine_key"], OLD)
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % NEW).encode())

    def test_rollback_without_a_record_refuses(self):
        before = self.read(".env")
        self.assertEqual(self.run_script("rollback", "ROLLBACK\n"), 1, self.out)
        self.assertIn("REFUSED", self.out)
        self.assertFalse(self.stopped())
        self.assertEqual(self.read(".env"), before)

    def test_finish_removes_a_finished_record_and_rollback_then_refuses(self):
        self.assertEqual(self.rotate(), 0, self.out)
        self.assertEqual(self.run_script("finish"), 0, self.out)
        self.assertIn("rollback is no longer possible", self.out)
        self.assertFalse(self.exists(".env.engine-key-rotation"))
        self.assertEqual(self.run_script("rollback", "ROLLBACK\n"), 1, self.out)
        self.assertIn("REFUSED", self.out)
        self.assertEqual(self.keys(), [NEW])

    def test_finish_without_a_finished_record_refuses(self):
        self.assertEqual(self.run_script("finish"), 1, self.out)
        self.assertIn("finish REFUSED", self.out)
        self.assertFalse(self.exists(".env.engine-key-rotation"))
        rec = ("OLD=%s\nNEW=%s\n" % (OLD, NEW))
        self.write(".env.engine-key-rotation", rec)
        self.assertEqual(self.run_script("finish"), 1, self.out)
        self.assertIn("finish REFUSED", self.out)
        self.assertEqual(self.read(".env.engine-key-rotation"), rec.encode())
        self.assertEqual(self.state["calls"], [])

    def test_engine_open_without_a_key_fails_and_keeps_the_record(self):
        self.state["engine_open"] = True
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertIn("verify engine-no-key http=200 FAIL", self.out)
        self.assertIn("App and engine are STOPPED", self.out)
        self.assertNotIn("app", self.state["running"])
        self.assertNotIn("engine", self.state["running"])
        self.assertEqual(self.argvs()[-1], ["compose", "stop", "app", "engine"])
        self.assertNotIn("verify engine-new-key", self.out)
        self.assertIn("rollback", self.out)
        self.assertEqual(self.read(".env.engine-key-rotation"), ("OLD=%s\nNEW=%s\n" % (OLD, NEW)).encode())
        self.state["engine_open"] = False
        self.assertEqual(self.run_script("rollback", "ROLLBACK\n"), 0, self.out)
        self.assertEqual(self.keys(), [OLD])
        self.assertEqual(self.env_value(), "'%s'" % OLD)
        self.assertEqual(self.read(".env.engine-key-rotation"), ("PREVIOUS=%s\n" % NEW).encode())

    def test_app_refusing_the_new_key_fails(self):
        self.state["app_refuses"] = True
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertIn("verify app-new-key http=401 FAIL", self.out)
        self.assertTrue(self.exists(".env.engine-key-rotation"))

    def test_wrong_word_changes_nothing(self):
        before = self.read(".env")
        self.rotate("yes\n")
        self.assertIn("nothing changed", self.out)
        self.assertIn("any coworker run in progress fails", self.out)
        self.assertFalse(self.stopped())
        self.assertEqual(self.read(".env"), before)
        self.assertEqual(self.keys(), [OLD])
        self.assertFalse(self.exists(".env.engine-key-rotation"))

    def test_resume_with_an_unknown_key_in_env_stops_and_starts_nothing(self):
        self.write(".env", "RERUN_ENGINE_API_KEY='%s'\n" % OTHER)
        self.write(".env.engine-key-rotation", "OLD=%s\nNEW=%s\n" % (OLD, NEW))
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertIn("neither", self.out)
        self.assertEqual(self.ups(), [])
        self.assertNotIn("engine", self.state["running"])
        self.assertEqual(self.env_value(), "'%s'" % OTHER)

    def test_a_blank_key_in_env_is_never_started(self):
        self.write(".env", "RERUN_ENGINE_API_KEY=\n")
        self.write(".env.engine-key-rotation", "OLD=%s\nNEW=%s\n" % (OLD, NEW))
        self.state["rows"] = [{"workspace": "w1", "engine_api_key": NEW, "updated_at": None}]
        self.assertEqual(self.rotate(), 1, self.out)
        self.assertTrue(self.stopped())
        self.assertIn("left STOPPED", self.out)
        self.assertEqual(self.ups(), [])


class ScriptText(unittest.TestCase):
    def setUp(self):
        with open(SCRIPT, "rb") as f:
            self.raw = f.read()
        self.s = self.raw.decode("utf-8")

    def test_no_trace_no_env_value_on_docker_exec_no_key_printed(self):
        self.assertNotIn(b"\r", self.raw)
        self.assertNotIn("set -x", self.s)
        self.assertNotRegex(self.s, r"docker exec[^\n]*-e [A-Za-z_]+=")
        for line in self.s.splitlines():
            if re.search(r"\$\{?KEY_", line):
                self.assertNotRegex(line, r"\b(say|echo)\b", line)


if __name__ == "__main__":
    unittest.main()
