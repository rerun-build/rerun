import contextlib, io, os, sys, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G

H = "abcdef0123456789abcdef0123456789abcdef01"
S8 = H[:8]
CHUNKS = "## Goal\nx\n## Chunks\n- [ ] O1. a | builder: code | done-test: t | max-lines: 300\n- [ ] O2. b | builder: hopper | done-test: t | max-lines: 300\n"


def reviews(ref, body, issue, who):
    def fake(path, paginate=False, jq=".[]"):
        p = path.split("?")[0]
        if p.endswith("/pulls/5"):
            return {"head": {"sha": H, "ref": ref}, "base": {"ref": "dev"}, "body": body}
        if p.endswith("/pulls/5/files"):
            return [{"filename": "src/a.ts", "status": "modified", "additions": 1, "deletions": 0}]
        if p.endswith("/pulls/5/commits"):
            return []
        if p.endswith("/issues/78"):
            return {"body": issue}
        if p.endswith("/issues/5/comments"):
            return [{"created_at": "2026-11-12T10:0%d" % i, "html_url": "u/%d" % i, "body": "Review ACCEPT @%s: %s ACCEPT ok" % (S8, w)} for i, w in enumerate(who)]
        return {"sha": H}
    out = io.StringIO()
    with tempfile.TemporaryDirectory() as td, mock.patch.object(G, "gh_json", fake), mock.patch.object(G, "head_checks", lambda *a: []), \
            mock.patch.object(G.F, "STATE", td), mock.patch.object(G.F, "base_roster", lambda *a: None), contextlib.redirect_stdout(out):
        G.gate("special-place-ai-heaven/rerun", "5")
    return next(l for l in out.getvalue().splitlines() if l.startswith("REVIEWS "))


class TestBuilderFromLedger(unittest.TestCase):
    def test_every_named_chunk_builder_is_refused(self):
        line = reviews("factory/roster", "Job: special-place-ai-heaven/rerun#78, chunk O1, O2", CHUNKS, ["HOPPER"])
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("ACCEPT by builder HOPPER refused", line)

    def test_chunk_outside_the_chunks_section_is_not_bound(self):
        issue = "## Notes\n- [ ] O1. a | builder: hopper | done-test: t\n## Chunks\n- [ ] O2. b | builder: code | done-test: t\n"
        line = reviews("factory/roster", "Job: special-place-ai-heaven/rerun#78, chunk O1", issue, ["LINUS"])
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("builder not bound", line)

    def test_job_branch_of_another_issue_is_not_bound(self):
        line = reviews("factory/job-71", "Job: special-place-ai-heaven/rerun#78, chunk O1", CHUNKS, ["LINUS"])
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("builder not bound", line)

    def test_chunk_branch_keeps_its_line_builder(self):
        line = reviews("chunk/78-O2", "Job: special-place-ai-heaven/rerun#78, chunk O2", CHUNKS, ["HOPPER"])
        self.assertTrue(line.startswith("REVIEWS FAIL"), line)
        self.assertIn("ACCEPT by builder HOPPER refused", line)


if __name__ == "__main__":
    unittest.main()
