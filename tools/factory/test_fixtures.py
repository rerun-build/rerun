import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


class Fixtures(unittest.TestCase):
    def test_jest_ci_log_fixture(self):
        r = G.results(load("jest_ci.log"))
        self.assertEqual([(x[0], x[1], x[2]) for x in r], [
            ("jest", "packages/core/src/parser.spec.ts", True),
            ("jest", "apps/web/src/button.test.tsx", True),
            ("jest", "apps/server/src/routes/health.test.ts", False),
            ("jest", "packages/shared/__tests__/util.test.js", True)])
        self.assertTrue(G.test_hit("src/routes/health.test.ts", "apps/server/src/routes/health.test.ts", "jest"))

    def test_rust_ci_log_fixture(self):
        r = G.results(load("rust_ci.log"))
        kinds = {x[0] for x in r}
        self.assertIn("nextest-it", kinds)
        self.assertIn("cargo-unit", kinds)
        nx = [x for x in r if x[0] == "nextest-it"]
        cg = [x for x in r if x[0] == "cargo-unit"]
        self.assertEqual(len(nx), 30)
        self.assertEqual(len(cg), 9)
        self.assertEqual(nx[0][:3], ("nextest-it", "terminal-commander-probes::governor_limits::alloc_helper", True))
        self.assertEqual(nx[-1][:3], ("nextest-it", "terminal-commander-probes::governor_limits::synthetic_failure_case", False))
        self.assertEqual(cg[0][:3], ("cargo-unit", "concurrent_probes_buckets_do_not_cross_talk", True))
        self.assertEqual(cg[-1][:3], ("cargo-unit", "synthetic_failed_case", False))
        self.assertEqual(sum(1 for x in r if not x[2]), 2)


class PythonFixtures(unittest.TestCase):
    def test_unittest_ci_log_fixture(self):
        r = G.results(load("unittest_ci.log"))
        ut = [(x[1], x[2]) for x in r if x[0] == "unittest"]
        self.assertEqual(ut[:4], [("tests::test_report::ReportTest::test_totals", True), ("tests::test_report::ReportTest::test_empty", False),
                                  ("tests::test_store::StoreTest::test_save", True), ("tests::test_store::StoreTest::test_load", False)])
        self.assertEqual(sum(1 for x in ut if not x[1]), 4)
        self.assertEqual([x[2] for x in r if x[0] == "unittest-run"], [False])
        self.assertNotIn("test_later", " ".join(x[1] for x in r))
        self.assertTrue(G.test_hit("tests/test_report.py", "tests::test_report::ReportTest::test_empty", "unittest"))
        self.assertFalse(G.test_hit("tests/test_report.py", "tests::test_store::StoreTest::test_load", "unittest"))

    def test_pytest_ci_log_fixture(self):
        r = G.results(load("pytest_ci.log"))
        self.assertTrue(all(x[0] == "pytest" for x in r))
        self.assertEqual(len(r), 6)
        self.assertEqual([x[1] for x in r if not x[2]], ["tests/test_report.py::test_empty"] * 2)
        self.assertTrue(G.test_hit("tests/test_report.py", "tests/test_report.py::test_empty", "pytest"))
        self.assertFalse(G.test_hit("tests/test_store.py", "tests/test_report.py::test_empty", "pytest"))


if __name__ == "__main__":
    unittest.main()
