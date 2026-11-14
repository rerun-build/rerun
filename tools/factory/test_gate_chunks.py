import contextlib, io, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G

ISSUE = {"body": "- [ ] A. x | max-lines: 10\n- [ ] B. y | max-lines: 5\n"}
COMMITS = [{"sha": "a1", "commit": {"message": "A: one\n\nbody"}}, {"sha": "b1", "commit": {"message": "B: two"}}]
FILES = {"a1": [{"additions": 6, "deletions": 3}], "b1": [{"additions": 4, "deletions": 3}]}


def fake(path, **k):
    if "/issues/" in path:
        return ISSUE
    if "/pulls/" in path:
        return COMMITS
    return {"files": FILES[path.rsplit("/", 1)[1]]}


class GateChunks(unittest.TestCase):
    def test_limits_judged_per_chunk_commit(self):
        old, G.gh_json = G.gh_json, fake
        try:
            self.assertEqual(G.chunk_limits("special-place-ai-heaven/rerun", 9, "special-place-ai-heaven/rerun", 71, ["A", "B"]), ["chunk B: 7 changed lines > max 5"])
            self.assertEqual(G.chunk_limits("special-place-ai-heaven/rerun", 9, "special-place-ai-heaven/rerun", 71, ["A"]), [])
            self.assertEqual(G.chunk_limits("special-place-ai-heaven/rerun", 9, "special-place-ai-heaven/rerun", 71, ["A", "Z"])[0][:13], "chunk Z: no c")
        finally:
            G.gh_json = old

    def test_receipt_gives_done_test_and_fail_before(self):
        body = "Job: o/r#71, chunk A, B\nReceipt A: done-test ok (base exit 2, head exit 0)\nReceipt B: done-test ok (base exit 0, head exit 0)\nReceipt C: done-test FAIL (base exit 1, head exit 1)\n"
        self.assertEqual(G.receipts(body, "factory/job-71"), {"A": (True, True), "B": (True, False), "C": (False, True)})
        self.assertEqual(G.receipts(body, "chunk/71-A"), {})
        self.assertEqual(G.receipts(body, "factory/job-x"), {})

    def test_job_pr_without_receipt_fails_both(self):
        def run(body):
            pr = {"head": {"sha": "a" * 40, "ref": "factory/job-71"}, "body": body}
            fk = lambda path, **k: pr if path.endswith("/pulls/9") else {} if "/issues/71" in path else []
            ok = [{"name": "ci", "status": "completed", "conclusion": "success", "id": 1, "url": ""}]
            out, olds = io.StringIO(), (G.gh_json, G.head_checks, G.F.STATE, G.F.base_roster)
            G.gh_json, G.head_checks, G.F.STATE, G.F.base_roster = fk, lambda *a: ok, tempfile.mkdtemp(), lambda full: None
            try:
                with contextlib.redirect_stdout(out):
                    G.gate("special-place-ai-heaven/rerun", "9")
            finally:
                G.gh_json, G.head_checks, G.F.STATE, G.F.base_roster = olds
            return {l.split()[0]: l.split()[1] for l in out.getvalue().splitlines()[1:] if l.split()[0] in ("CI_GREEN", "DONE_TEST", "FAIL_BEFORE")}
        head = "Job: special-place-ai-heaven/rerun#71, chunk A, B\n"
        self.assertEqual(run(head + "Receipt A: done-test ok (base exit 2, head exit 0)"), {"CI_GREEN": "PASS", "DONE_TEST": "FAIL", "FAIL_BEFORE": "FAIL"})
        self.assertEqual(run(head + "Receipt A: done-test ok (base exit 2, head exit 0)\nReceipt B: done-test ok (base exit 1, head exit 0)")["DONE_TEST"], "PASS")


if __name__ == "__main__":
    unittest.main()
