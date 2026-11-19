import json, os, re, tempfile, threading, unittest
from unittest import mock

import machine
from test_dispatch import Base

DOC = {"version": 1, "madeAt": "2026-11-19T10:00:00Z", "engine": "running", "skippedTicks": 0,
       "readings": [{"name": "load_1", "value": 4.5, "reason": None}, {"name": "disk_free_kb", "value": None, "reason": "df failed"}],
       "housekeeping": [{"cmd": "mirror", "rc": 0, "s": 3}],
       "factory": {"version": 1, "readings": [{"name": "wt_count", "value": 7}]}}
NOW = 2000000000.0
SHAPE = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-")
PRINTABLE = re.compile(r"[ -~]*")


def put(p, data, age, now=NOW):
    with open(p, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))
    os.utime(p, (now - age, now - age))
    return p


def rows(m):
    return [(r["name"], r["value"], r["reason"], r["source"]) for r in m["readings"]]


class Read(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.p = os.path.join(self.dir.name, "machine.json")

    def test_a_fresh_file_gives_every_reading_with_its_source_and_the_file_age(self):
        m = machine.read(NOW, put(self.p, json.dumps(DOC), 60))
        self.assertEqual(rows(m), [("load_1", 4.5, None, "keeper"), ("disk_free_kb", None, "df failed", "keeper"),
                                   ("wt_count", 7, None, "factory")])
        self.assertEqual((m["fileAgeS"], m["fresh"], m["engine"], m["fileMadeAt"]), (60, True, "running", "2026-11-19T10:00:00Z"))
        self.assertEqual(m["housekeeping"], [{"cmd": "mirror", "rc": 0, "s": 3}])
        self.assertTrue(machine.read(NOW, put(self.p, json.dumps(DOC), 900))["fresh"])

    def test_a_file_older_than_15_minutes_shows_every_value_as_unknown_never_the_last_number(self):
        m = machine.read(NOW, put(self.p, json.dumps(DOC), 901))
        self.assertEqual([(r["value"], r["reason"]) for r in m["readings"]], [(None, "keeper file older than 15 minutes")] * 3)
        self.assertEqual((m["engine"], m["housekeeping"], m["skippedTicks"], m["fresh"], m["fileAgeS"]), ("unknown", [], 0, False, 901))

    def test_missing_half_written_huge_not_json_a_list_a_folder_and_a_pipe_never_raise(self):
        cases = [("missing", None, "keeper file missing"),
                 ("half", json.dumps(DOC)[:40], "keeper file is not JSON"),
                 ("huge", b" " * (machine.MAX_BYTES + 12), "keeper file over 524288 bytes"),
                 ("trace", "Traceback (most recent call last):", "keeper file is not JSON"),
                 ("list", "[1, 2]", "keeper file is not an object")]
        for name, data, reason in cases:
            p = os.path.join(self.dir.name, name)
            if data is not None:
                put(p, data, 0)
            m = machine.read(NOW, p)
            self.assertEqual((name, m["fresh"], m["fileAgeS"], [(r["name"], r["reason"]) for r in m["readings"]]),
                             (name, False, None, [("keeper_file", reason)]))
        folder = os.path.join(self.dir.name, "folder")
        os.mkdir(folder)
        self.assertEqual(machine.read(NOW, folder)["readings"][0]["reason"], "keeper file unreadable: IsADirectoryError")
        pipe = os.path.join(self.dir.name, "pipe")
        os.mkfifo(pipe)
        got = []
        t = threading.Thread(target=lambda: got.append(machine.read(NOW, pipe)), daemon=True)
        t.start()
        t.join(5)
        self.assertFalse(t.is_alive())
        self.assertEqual(got[0]["readings"][0]["reason"], "keeper file is not a regular file")
        self.assertEqual((got[0]["fresh"], got[0]["fileAgeS"]), (False, None))

    def test_values_are_cut_to_the_contract(self):
        doc = dict(DOC, madeAt="not a time", skippedTicks=True, factory=None,
                   readings=[{"name": "r%03d" % i + "é" * 80, "value": "v" * 99, "reason": "w" * 200} for i in range(250)] + [1, {"value": 2}],
                   housekeeping=[{"cmd": "c%d" % i, "rc": 0, "s": 1} for i in range(15)])
        m = machine.read(NOW, put(self.p, json.dumps(doc), 10))
        self.assertLessEqual(len(json.dumps(m)), machine.MAX_BLOCK_BYTES)
        self.assertTrue(m["readings"])
        for r in m["readings"]:
            self.assertEqual((len(r["name"]), len(r["value"]), len(r["reason"])), (64, 64, 120))
            for s in (r["name"], r["value"], r["reason"]):
                self.assertTrue(PRINTABLE.fullmatch(s))
        self.assertEqual((len(m["housekeeping"]), m["fileMadeAt"], m["skippedTicks"]), (10, None, 0))
        small = '{"readings": [{"name": "a", "value": true}, {"name": "b", "value": NaN}, {"name": "c", "value": [1]}]}'
        m = machine.read(NOW, put(self.p, small, 10))
        self.assertEqual([(r["value"], r["reason"]) for r in m["readings"]],
                         [(1, None), (None, "not a finite number"), (None, "not a number or a string")])

    def test_a_full_block_holds_no_token_shape(self):
        doc = dict(DOC, readings=[{"name": "a", "value": "ghp_" + "A" * 36}, {"name": "ghp_" + "B" * 36, "value": 1},
                                  {"name": "c", "value": 2, "reason": "github_pat_" + "C" * 30}, {"name": "d", "value": "sk-" + "D" * 30}])
        text = json.dumps(machine.read(NOW, put(self.p, json.dumps(doc), 10)))
        self.assertIsNone(SHAPE.search(text))
        self.assertIn("value looks like a token", text)


class Beat(Base):
    def setUp(self):
        super().setUp()
        self.w.report_answer = {}
        self.p = os.path.join(self.dir.name, "machine.json")
        env = mock.patch.dict(os.environ, {machine.ENV: self.p})
        env.start()
        self.addCleanup(env.stop)

    def test_the_snapshot_and_the_digest_carry_the_machine_block(self):
        put(self.p, json.dumps(DOC), 60, self.w.clock)
        self.tick()
        snap = self.w.reports[-1]
        self.assertTrue(snap["machine"]["fresh"])
        self.assertEqual(snap["digest"]["machine"], snap["machine"])

    def test_every_bad_file_lets_the_beat_end_normally(self):
        for data in ("{", "[1]", b" " * (machine.MAX_BYTES + 1)):
            put(self.p, data, 60, self.w.clock)
            before = len(self.w.reports)
            self.tick()
            self.assertEqual(len(self.w.reports), before + 1)
            self.assertFalse(self.w.reports[-1]["machine"]["fresh"])

    def test_without_the_keeper_setting_there_is_no_machine_block(self):
        os.environ.pop(machine.ENV)
        put(self.p, json.dumps(DOC), 60, self.w.clock)
        self.tick(3)
        self.assertNotIn("machine", self.w.reports[-1])
        self.assertNotIn("machine", self.w.reports[-1]["digest"])


class Compose(unittest.TestCase):
    def test_the_dispatcher_mounts_the_keeper_folder_read_only_and_names_the_file(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps", "factory-dispatcher.yml")) as f:
            text = f.read()
        self.assertIn("      FACTORY_KEEPER_FILE: /keeper/machine.json\n", text)
        self.assertIn("      - /var/lib/rerun-keeper:/keeper:ro\n", text)
        self.assertNotIn("docker.sock", text)


if __name__ == "__main__":
    unittest.main()
