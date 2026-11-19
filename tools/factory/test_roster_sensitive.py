import os
import unittest

import roster as R

HERE = os.path.dirname(os.path.abspath(__file__))


class TestGateFilesSensitive(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "roster.json")) as f:
            self.r = R.load(f.read())

    def test_gate_and_ledger_join_factory_roster(self):
        for f in ("tools/factory/gate.py", "tools/factory/ledger.py"):
            self.assertIn("factory-roster", R.areas(self.r, [f]), f)
            self.assertEqual(R.required(self.r, [f]), {"LINUS", "BRUCE"}, f)

    def test_factory_py_stays_in_factory_checkout(self):
        f = "tools/factory/factory.py"
        self.assertEqual(list(R.areas(self.r, [f])), ["factory-checkout", "factory-tools"])
        self.assertEqual(R.required(self.r, [f]), {"LINUS", "BRUCE"})

    def test_other_factory_files_stay_plain(self):
        for f in ("tools/factory/store.py", "tools/factory/dispatch.py", "tools/factory/test_gate.py"):
            self.assertEqual(R.required(self.r, [f]), {"LINUS"}, f)
        self.assertEqual(list(R.areas(self.r, ["tools/factory/store.py"])), ["factory-tools"])


if __name__ == "__main__":
    unittest.main()
