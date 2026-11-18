import json
import os
import unittest

import roster

HERE = os.path.dirname(os.path.abspath(__file__))
TEXT = open(os.path.join(HERE, "roster.json")).read()


def data():
    return json.loads(TEXT)


def area_names(files):
    r = roster.load(TEXT)
    return {n: sorted(fs) for n, fs in roster.areas(r, files).items()}


class RosterSensitiveTest(unittest.TestCase):
    def setUp(self):
        self.r = roster.load(TEXT)

    def test_gate_and_ledger_join_factory_roster(self):
        for f in ("tools/factory/gate.py", "tools/factory/ledger.py"):
            got = area_names([f])
            self.assertEqual(got.get("factory-roster"), [f], f)
            self.assertTrue(roster.required(self.r, [f]) >= {"LINUS", "BRUCE"}, f)

    def test_factory_roster_area_is_sensitive_with_same_owner_and_builder(self):
        a = [x for x in data()["areas"] if x["name"] == "factory-roster"][0]
        self.assertEqual(a["owner"], "linus")
        self.assertEqual(a["builder"], "code")
        self.assertIs(a["sensitive"], True)

    def test_factory_py_stays_in_factory_checkout(self):
        got = area_names(["tools/factory/factory.py"])
        self.assertEqual(sorted(got), ["factory-checkout", "factory-tools"])

    def test_other_factory_files_stay_plain(self):
        for f in ("tools/factory/dispatch.py", "tools/factory/gatefiles.py",
                  "tools/factory/gatefiles.json", "tools/factory/roster.py"):
            got = area_names([f])
            if f.endswith("roster.py"):
                self.assertIn("factory-roster", got, f)
            else:
                self.assertNotIn("factory-roster", got, f)

    def test_only_two_globs_added(self):
        a = [x for x in data()["areas"] if x["name"] == "factory-roster"][0]
        self.assertEqual(sorted(a["globs"]), sorted([
            "tools/factory/roster.json", "tools/factory/roster.py",
            "tools/factory/gate.py", "tools/factory/ledger.py"]))


if __name__ == "__main__":
    unittest.main()
