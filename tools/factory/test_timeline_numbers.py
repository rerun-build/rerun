import contextlib, io, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store
import timeline as T

D = "2026-11-13T"
OTHER = "ready 0, running 0, waiting 0 | mean wait: waiting -, queued -, fix_wait -, checks - | merged per hour 0.00 | tokens per merged -"
DATA = {"worker": "coder", "body": "**Part of**: #9"}


def at(hm):
    return D + hm + ":00Z"


class Numbers(unittest.TestCase):
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

    def _ledger(self):
        for state, hm in (("queued", "10:00"), ("building", "10:06"), ("review_wait", "10:20"),
                          ("reviewing", "10:30"), ("checks", "10:40"), ("merged", "10:50")):
            self.st.put_job("171", state, DATA, at=at(hm))
        fire = self.st.intent("171", "", "build", coworker="code", at=at("10:06"))
        self.st.fired(fire, "run-1")
        self.st.close_run("run-1", "done", at=at("10:20"), tokens_in=1000, tokens_out=200)
        self.st.put_job("172", "queued", DATA, at=at("11:00"))
        self.st.set("accept:9", "state", "running")

    def test_read_rows_carries_tokens_and_convergence(self):
        self._ledger()
        rows = T.read_rows(self.path)
        self.assertEqual(rows["tokens"]["171"], 1200)
        self.assertEqual(rows["accept"], {9: "running"})

    def test_numbers_by_type_and_by_feature(self):
        self._ledger()
        lines = T.numbers_lines(T.read_rows(self.path), T.parse(at("12:00")))
        self.assertEqual(lines, [
            "numbers by type, last 24 h:",
            "  coder: ready 1, running 0, waiting 0 | mean wait: waiting -, queued 6 min, fix_wait -, checks 10 min | merged per hour 0.04 | tokens per merged 1200",
            "  reviewer: ready 0, running 0, waiting 0 | mean wait: review_wait 10 min, proof_wait -",
            "  researcher: " + OTHER,
            "  designer: " + OTHER,
            "numbers by feature, whole wave:",
            "  #9: 1 of 2 done, convergence running, tokens per merged 1200"])

    def test_rows_without_accept_or_tokens(self):
        self._ledger()
        rows = T.read_rows(self.path)
        bare = {"jobs": rows["jobs"], "transitions": rows["transitions"]}
        lines = T.numbers_lines(bare, T.parse(at("12:00")))
        self.assertEqual(lines[-1], "  #9: 1 of 2 done, convergence waiting, tokens per merged 0")

    def test_an_empty_ledger_has_no_feature(self):
        lines = T.numbers_lines(T.read_rows(self.path), T.parse(at("12:00")))
        self.assertEqual(lines[-2:], ["numbers by feature, whole wave:", "  none"])

    def test_status_prints_the_numbers_between_the_job_list_and_the_map(self):
        self._ledger()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = T.main(["status", "--db", self.path])
        self.assertEqual(code, 0)
        lines = out.getvalue().split("\n")
        self.assertEqual(lines.count("numbers by type, last 24 h:"), 1)
        self.assertEqual(lines.count("dependency map of open work, by first start (UTC):"), 1)
        numbers = lines.index("numbers by type, last 24 h:")
        self.assertEqual(lines[numbers - 1], "")
        mapping = lines.index("dependency map of open work, by first start (UTC):")
        self.assertEqual(lines[mapping - 1], "")
        self.assertEqual(lines[mapping - 2], "  #9: 1 of 2 done, convergence running, tokens per merged 1200")


if __name__ == "__main__":
    unittest.main()
