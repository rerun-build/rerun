import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import factory as F
import sense

CLK = os.sysconf("SC_CLK_TCK")
TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2"


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.email=a@b.c", "-c", "user.name=t", *args], cwd=cwd, check=True, capture_output=True)


def by_name(rs):
    return {r["name"]: r for r in rs}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.work = os.path.join(self.tmp, "work")
        self.state = os.path.join(self.work, "state")
        self.wt = os.path.join(self.work, "wt")
        self.proc = os.path.join(self.tmp, "proc")
        self.tools = os.path.join(self.tmp, "tools")
        for d in (self.state, self.wt, self.proc, self.tools):
            os.makedirs(d)
        self.put(self.proc, "loadavg", "0.10 0.10 0.10 1/100 1\n")
        self.put(self.proc, "uptime", "5000.00 4000.00\n")
        self.spawned = mock.Mock()
        for target, value in (
            (F, {"WORK": self.work, "STATE": self.state, "WT": self.wt}),
            (sense, {"PROC": self.proc, "TOOLS": self.tools, "spawn": self.spawned, "CAP_S": 10}),
        ):
            for k, v in value.items():
                p = mock.patch.object(target, k, v)
                p.start()
                self.addCleanup(p.stop)

    def put(self, folder, name, text, mode="w"):
        with open(os.path.join(folder, name), mode) as f:
            f.write(text)

    def readings(self):
        return by_name(sense.readings())

    def add_proc(self, pid, argv, env, age_s):
        d = os.path.join(self.proc, str(pid))
        os.makedirs(d)
        self.put(d, "cmdline", "\0".join(argv) + "\0")
        self.put(d, "environ", "\0".join(env) + "\0")
        start = int((5000 - age_s) * CLK)
        self.put(d, "stat", "%d (x) S %s\n" % (pid, " ".join(["0"] * 18 + [str(start)])))
        self.put(d, "comm", "python3\n")


class Readings(Base):
    def test_every_reading_is_a_value_or_null_with_a_reason(self):
        rs = sense.readings()
        names = by_name(rs)
        for n in ("work_bytes", "wt_count", "wt_unsaved", "wt_oldest_unsaved_idle_h", "wt_new_count", "pr_open_oldest_s", "installs_count", "tests_count", "tools_commit"):
            self.assertIn(n, names)
        for r in rs:
            self.assertEqual(sorted(r), ["name", "reason", "value"])
            v = r["value"]
            self.assertTrue(v is None or isinstance(v, (int, float)) or (isinstance(v, str) and len(v) <= 64), r)
            if v is None:
                self.assertTrue(isinstance(r["reason"], str) and "\n" not in r["reason"] and 0 < len(r["reason"]) <= 120, r)
            else:
                self.assertIsNone(r["reason"], r)

    def test_a_reading_that_fails_is_null_and_the_others_stay(self):
        r = self.readings()
        self.assertIsNone(r["tools_commit"]["value"])
        self.assertEqual(r["tools_commit"]["reason"], "FileNotFoundError")
        self.assertEqual(r["wt_count"]["value"], 0)

    def test_a_reading_over_its_time_cap_is_null(self):
        def slow():
            time.sleep(2)
            return []
        with mock.patch.object(sense, "CAP_S", 0.2), mock.patch.object(sense, "scan_procs", slow):
            t0 = time.time()
            r = self.readings()
            took = time.time() - t0
        self.assertLess(took, 1.5)
        self.assertIsNone(r["tests_count"]["value"])
        self.assertTrue(r["tests_count"]["reason"].startswith("over "))
        self.assertEqual(r["wt_count"]["value"], 0)


class FolderSize(Base):
    def test_the_folder_measure_starts_at_most_once_per_ten_minutes_low_priority_in_the_background(self):
        sense.readings()
        sense.readings()
        self.assertEqual(self.spawned.call_count, 1)
        args, kw = self.spawned.call_args
        self.assertIn("nice -n 19 timeout", args[0][2])
        self.assertEqual(args[0][3:], ["sh", "300", self.work, os.path.join(self.state, "sense-du.txt")])
        self.assertTrue(kw["start_new_session"])
        self.assertEqual(kw["stdin"], subprocess.DEVNULL)
        self.assertEqual(kw["stdout"], subprocess.DEVNULL)
        old = time.time() - 601
        os.utime(os.path.join(self.state, "sense-du.start"), (old, old))
        sense.readings()
        self.assertEqual(self.spawned.call_count, 2)

    def test_the_folder_measure_is_skipped_while_the_load_is_above_three_per_core(self):
        self.put(self.proc, "loadavg", "%d.00 1.00 1.00 1/100 1\n" % (3 * (os.cpu_count() or 1) + 1))
        r = self.readings()
        self.spawned.assert_not_called()
        self.assertIsNone(r["work_bytes"]["value"])
        self.assertEqual(r["work_bytes"]["reason"], "measure skipped: load above 3 per core")

    def test_the_cached_measure_is_read_with_its_age(self):
        p = os.path.join(self.state, "sense-du.txt")
        self.put(self.state, "sense-du.txt", "12345\t/data/work\n")
        old = time.time() - 100
        os.utime(p, (old, old))
        r = self.readings()
        self.assertEqual(r["work_bytes"]["value"], 12345)
        self.assertGreaterEqual(r["work_bytes_age_s"]["value"], 100)


class Folders(Base):
    def test_folders_are_counted_by_a_local_pass_with_no_network(self):
        a = os.path.join(self.wt, "repo", "1-aaa")
        b = os.path.join(self.wt, "repo", "2-bbb")
        os.makedirs(os.path.join(self.wt, "repo", "scratch"))
        for p in (a, b):
            os.makedirs(p)
            git(p, "init", "-q")
            self.put(p, "f.txt", "x")
            git(p, "add", "f.txt")
            git(p, "commit", "-qm", "c")
        self.put(a, "new.txt", "y")
        with mock.patch.object(F, "pr_lookup", side_effect=AssertionError("network"), create=True):
            r = self.readings()
        self.assertEqual(r["wt_count"]["value"], 3)
        self.assertEqual(r["wt_unsaved"]["value"], 2)
        self.assertEqual(r["wt_foreign"]["value"], 1)
        self.assertEqual(r["wt_clean"]["value"], 0)
        self.assertIn(r["wt_oldest_unsaved"]["value"], ("repo/1-aaa", "repo/2-bbb"))
        self.assertIsInstance(r["wt_oldest_unsaved_idle_h"]["value"], float)

    def test_no_unsaved_folder_is_a_null_with_its_reason(self):
        r = self.readings()
        self.assertEqual(r["wt_count"]["value"], 0)
        self.assertEqual(r["wt_oldest_unsaved"]["reason"], "no folder with unsaved work")


class Commands(Base):
    def test_running_commands_are_counted_with_their_oldest_age(self):
        fp = "/data/tools/factory/factory.py"
        self.add_proc(11, ["python3", "-I", fp, "new", "r", "1", "c"], ["FACTORY_CMD=wt"], 1000)
        self.add_proc(12, ["python3", "-I", fp, "new", "r", "2", "c"], ["FACTORY_CMD=wt"], 500)
        self.add_proc(13, ["python3", "-I", fp, "--title", "t"], ["FACTORY_CMD=pr-open"], 300)
        self.add_proc(14, ["pnpm", "install"], [], 200)
        self.add_proc(15, ["node", "/n/.bin/vitest", "run"], [], 100)
        self.add_proc(16, ["python3", "-m", "unittest", "x"], [], 50)
        self.add_proc(17, ["bash", "-c", "sleep 1"], [], 50)
        r = self.readings()
        self.assertEqual([r[n]["value"] for n in ("wt_new_count", "pr_open_count", "installs_count", "tests_count")], [2, 1, 1, 2])
        self.assertEqual(r["wt_new_oldest_s"]["value"], 1000)
        self.assertEqual(r["tests_oldest_s"]["value"], 100)

    def test_none_running_is_null_with_a_reason(self):
        r = self.readings()
        self.assertEqual(r["wt_new_count"]["value"], 0)
        self.assertEqual(r["wt_new_oldest_s"]["reason"], "none running")

    def test_a_full_reading_holds_no_token_shape_and_no_argument(self):
        self.add_proc(4242, ["python3", "-I", "/data/tools/factory/factory.py", "new", "/secret/path/" + TOKEN],
                      ["GH_TOKEN=" + TOKEN, "FACTORY_CMD=wt"], 10)
        text = json.dumps(sense.readings())
        self.assertIsNone(re.search(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9]{20,}|Bearer ", text))
        self.assertNotIn("/secret/path", text)


class ToolsStamp(Base):
    def test_the_tools_commit_comes_from_the_install_stamp(self):
        self.put(self.tools, "factory-installed", "abc1234def 2026-11-16T10:00:00Z\n")
        r = self.readings()
        self.assertEqual(r["tools_commit"]["value"], "abc1234def")
        self.assertEqual(r["tools_installed_at"]["value"], "2026-11-16T10:00:00Z")

    def test_a_stamp_without_a_commit_is_null(self):
        self.put(self.tools, "factory-installed", "unknown 2026-11-16T10:00:00Z\n")
        r = self.readings()
        self.assertIsNone(r["tools_commit"]["value"])
        self.assertEqual(r["tools_installed_at"]["value"], "2026-11-16T10:00:00Z")


class Install(unittest.TestCase):
    def test_the_plain_install_writes_the_stamp_of_its_commit(self):
        if sys.platform == "win32" or shutil.which("sh") is None:
            self.skipTest("no sh")
        want = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["sh", os.path.join(HERE, "install.sh"), "--prefix", tmp, "--jev-keyfile", "/x"], check=True, capture_output=True)
            with open(os.path.join(tmp, "factory-installed")) as f:
                parts = f.read().split()
            self.assertEqual(parts[0], want)
            self.assertRegex(parts[1], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
            self.assertFalse(os.path.exists(os.path.join(tmp, ".factory-installed.tmp")))
            self.assertTrue(os.path.exists(os.path.join(tmp, "bin", "sense")))


class Text(Base):
    def keeper(self, age):
        path = os.path.join(self.tmp, "keeper.json")
        rs = [{"name": "r%d" % i, "value": i, "reason": None} for i in range(1, 301)]
        self.put(self.tmp, "keeper.json", json.dumps({"version": 1, "madeAt": "2026-11-16T10:00:00Z", "readings": rs}))
        old = time.time() - age
        os.utime(path, (old, old))
        p = mock.patch.dict(os.environ, {"FACTORY_KEEPER_COPY": path})
        p.start()
        self.addCleanup(p.stop)

    def test_text_prints_the_keeper_copy_in_at_most_15_lines_and_a_stale_file_as_unknown(self):
        self.keeper(10)
        self.spawned.side_effect = AssertionError("spawned")
        out = sense.text()
        lines = out.splitlines()
        self.assertLessEqual(len(lines), 15)
        self.assertTrue(all(len(x) <= 150 for x in lines))
        self.assertTrue(lines[0].startswith("keeper file 2026-11-16T10:00:00Z, age "))
        self.assertIn("r1=1 ", out)
        self.keeper(901)
        out = sense.text()
        self.assertIn("STALE", out.splitlines()[0])
        self.assertIn("r1=unknown", out)
        self.assertNotIn("r1=1 ", out)
        self.spawned.assert_not_called()

    def test_a_missing_keeper_file_is_one_line(self):
        with mock.patch.dict(os.environ, {"FACTORY_KEEPER_COPY": os.path.join(self.tmp, "none.json")}):
            out = sense.text()
        self.assertEqual(out.splitlines(), ["keeper file: none readable at %s; no reading" % os.path.join(self.tmp, "none.json")])


class Main(Base):
    def run_main(self, argv):
        import io
        buf = io.StringIO()
        with mock.patch("sys.stdout", buf), mock.patch("sys.stderr", io.StringIO()):
            code = sense.main(argv)
        return code, buf.getvalue()

    def test_main_prints_one_json_line_and_text_and_usage(self):
        code, out = self.run_main([])
        self.assertEqual(code, 0)
        self.assertEqual(len(out.strip().splitlines()), 1)
        d = json.loads(out)
        self.assertEqual(d["version"], 1)
        self.assertIsInstance(d["readings"], list)
        self.assertEqual(self.run_main(["--text"])[0], 0)
        code, out = self.run_main(["--bad"])
        self.assertEqual(code, 2)
        self.assertIn("usage: sense [--text]", out)


class Wrapper(unittest.TestCase):
    def test_the_wrapper_is_two_lines(self):
        with open(os.path.join(HERE, "bin", "sense")) as f:
            self.assertEqual(f.read().splitlines(), ["#!/bin/sh", 'FACTORY_CMD=sense exec python3 -I /data/tools/factory/sense.py "$@"'])


if __name__ == "__main__":
    unittest.main()
