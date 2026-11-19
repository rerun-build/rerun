import contextlib, io, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
import timeline as T

D = "2026-11-13T"


def at(hm):
    return D + hm + ":00Z"


class DependencyMap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "ledger.db")
        self.st = store.Store(self.path)
        self.addCleanup(self._close)

    def _close(self):
        try:
            self.st.close()
        except Exception:
            pass

    def test_open_work_by_feature_with_its_edges(self):
        self.st.put_job("1", "merged", {"body": "**Part of**: #9\n"}, at=at("17:00"))
        self.st.put_job("171", "building", {"body": "**Part of**: #9\n"}, at=at("18:00"))
        self.st.put_job("172", "waiting", {"waiting": [171, 170], "body": "**Part of**: #9\n"}, at=at("18:05"))
        self.st.put_job("173", "queued", {}, at=at("17:30"))
        rows = T.read_rows(self.path)
        self.assertEqual(T.map_lines(rows, T.parse(at("18:40"))), [
            "dependency map of open work, by first start (UTC):",
            "  feature #9:",
            "    11-13 18:00 #171 building for 40 min",
            "    11-13 18:05 #172 waiting for 35 min <- #171 building, #170 not a factory job | stuck",
            "  no feature:",
            "    11-13 17:30 #173 queued for 70 min | stuck",
        ])

    def test_an_empty_ledger_has_no_map(self):
        rows = T.read_rows(self.path)
        self.assertEqual(T.map_lines(rows, T.parse(at("18:40"))), ["dependency map of open work: none"])

    def test_status_prints_the_map_below_the_job_list(self):
        self.st.put_job("173", "queued", {}, at=at("17:30"))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = T.main(["status", "--db", self.path])
        self.assertEqual(code, 0)
        lines = out.getvalue().split("\n")
        self.assertTrue(lines[0].startswith("#173 queued for "))
        heading = lines.index("dependency map of open work, by first start (UTC):")
        self.assertEqual(lines[heading - 1], "")
        self.assertEqual(lines[heading + 1], "  no feature:")
        self.assertTrue(lines[heading + 2].startswith("    11-13 17:30 #173 queued for "))
        self.assertTrue(lines[heading + 2].endswith(" | stuck"))

    def test_a_missing_ledger_is_refused(self):
        missing = os.path.join(self.tmp.name, "missing.db")
        for cmd in ("status", "gantt"):
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = T.main([cmd, "--db", missing])
            self.assertEqual(code, 2)
            self.assertEqual(err.getvalue(), "no ledger at %s\n" % missing)

    def test_the_help_names_the_running_checkout(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            T.main(["--help"])
        self.assertIn("/state/src/tools/factory/timeline.py status", out.getvalue())


if __name__ == "__main__":
    unittest.main()
