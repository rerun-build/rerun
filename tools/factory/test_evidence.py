import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evidence as E
import gate as G

FULL = "special-place-ai-heaven/testpilot"
COMMENTS = "repos/%s/issues/209/comments?per_page=100" % FULL
LINE = "- [ ] %s. Chunk | builder: larry | test: backend src/a.spec.ts | done-test: src/a.spec.ts | paths: src/a.ts, src/a.spec.ts | max-lines: 300 | depends on: -"
PLAN = "## Goal\nx\n## Chunks\n" + LINE % "1" + "\n" + LINE % "2" + "\n## Risks\n"


def cm(i, t, body):
    return {"id": i, "created_at": "2026-11-12T%s:00Z" % t, "body": body, "html_url": "https://github.com/x/%d" % i}


def fake(data):
    def get(path, paginate=False):
        if path not in data:
            raise G.NoAnswer("API error on %s: HTTP 404" % path)
        v = data[path]
        if isinstance(v, Exception):
            raise v
        return v
    return get


class TestEvidence(unittest.TestCase):
    def test_stale_plan_ready_ignored(self):
        old = [cm(1, "08:00", PLAN), cm(2, "08:10", "1. fine\nPLAN READY"), cm(3, "08:20", PLAN.replace("Chunk", "Chunk v2"))]
        self.assertEqual(E.challenge(fake({COMMENTS: old}), FULL, 209, 3)[0], "NONE")
        verdict, d = E.challenge(fake({COMMENTS: old + [cm(4, "08:30", "1. done-test missing\nPLAN REJECT: 1 points open")]}), FULL, 209, 3)
        self.assertEqual((verdict, d["comment"]), ("REJECT", 4))
        self.assertIn("done-test missing", d["text"])
        ready = old + [cm(5, "08:40", "1. checked\nPLAN READY")]
        self.assertEqual(E.challenge(fake({COMMENTS: ready}), FULL, 209, 3)[0], "READY")
        self.assertEqual(E.challenge(fake({COMMENTS: ready}), FULL, 209, 99)[0], "NONE")

    def test_challenge_first_verdict_after_plan_counts(self):
        c = [cm(3, "08:20", PLAN), cm(4, "08:30", "quote: PLAN READY is not at line start"), cm(5, "08:31", "1. x\nPLAN REJECT: 1 points open"),
             cm(6, "08:32", "PLAN READY")]
        self.assertEqual(E.challenge(fake({COMMENTS: c}), FULL, 209, 3)[:1], ("REJECT",))

    def test_plan_needs_a_new_comment_with_good_chunks(self):
        fired = "2026-11-12T08:05:00Z"
        before = [cm(1, "08:00", PLAN), cm(2, "08:06", "no plan here")]
        self.assertEqual(E.plan(fake({COMMENTS: before}), FULL, 209, fired)[0], "NONE")
        bad = before + [cm(3, "08:07", PLAN.replace(" | builder: larry", ""))]
        verdict, why = E.plan(fake({COMMENTS: bad}), FULL, 209, fired)
        self.assertEqual(verdict, "NONE")
        self.assertIn("missing builder", why)
        self.assertEqual(E.plan(fake({COMMENTS: before + [cm(4, "08:08", "## Chunks\n(none yet)\n")]}), FULL, 209, fired)[0], "NONE")
        verdict, d = E.plan(fake({COMMENTS: bad + [cm(5, "08:09", PLAN)]}), FULL, 209, fired)
        self.assertEqual((verdict, d["comment"], [c["id"] for c in d["chunks"]]), ("OK", 5, ["1", "2"]))

    def test_read_error_is_never_an_answer(self):
        boom = fake({COMMENTS: G.NoAnswer("API error: HTTP 502")})
        for call in (lambda: E.plan(boom, FULL, 209, "2026-11-12T08:00:00Z"), lambda: E.challenge(boom, FULL, 209, 3),
                     lambda: E.review(boom, FULL, 209, "a" * 40, "LINUS", "2026-11-12T08:00:00Z")):
            with self.assertRaises(G.NoAnswer):
                call()


class TestBuild(unittest.TestCase):
    FIRED = "2026-11-12T08:05:00Z"
    REFS = "repos/%s/git/matching-refs/heads/chunk/209-2" % FULL
    CMP = "repos/%s/compare/job/209...chunk/209-2" % FULL
    CHUNK = {"id": "2", "test": "tools/factory/test_x.py", "paths": ["tools/factory/x.py", "tools/factory/test_x.py", "tools/factory/systemd/**"], "max_lines": 300}

    def compare(self, dates, files):
        return {"commits": [{"sha": "c%d" % i, "commit": {"committer": {"date": d}}} for i, d in enumerate(dates)],
                "files": [{"filename": f, "additions": n, "deletions": 0} for f, n in files]}

    def run_build(self, cmp, refs=None):
        refs = [{"ref": "refs/heads/chunk/209-2", "object": {"sha": "c9"}}] if refs is None else refs
        return E.build(fake({self.REFS: refs, self.CMP: cmp}), FULL, 209, "job/209", self.CHUNK, self.FIRED)

    def test_branch_not_pushed(self):
        self.assertEqual(self.run_build({}, refs=[{"ref": "refs/heads/chunk/209-20", "object": {"sha": "x"}}]),
                         ("NONE", "chunk/209-2 was not pushed"))

    def test_needs_a_commit_after_fired(self):
        verdict, why = self.run_build(self.compare(["2026-11-12T08:04:59Z"], [("tools/factory/test_x.py", 5)]))
        self.assertEqual(verdict, "NONE")
        self.assertIn("no commit after", why)

    def test_test_file_and_paths(self):
        late = ["2026-11-12T08:04:00Z", "2026-11-12T08:06:00Z"]
        verdict, why = self.run_build(self.compare(late, [("tools/factory/x.py", 5)]))
        self.assertEqual((verdict, why), ("NONE", "test file tools/factory/test_x.py is not in the diff"))
        verdict, why = self.run_build(self.compare(late, [("tools/factory/test_x.py", 5), ("apps/engine/a.ts", 1), (".github/workflows/x.yml", 1)]))
        self.assertEqual((verdict, why), ("NONE", "files outside paths: apps/engine/a.ts, .github/workflows/x.yml"))

    def test_ok_flags_size_only(self):
        verdict, d = self.run_build(self.compare(["2026-11-12T08:06:00Z"], [("tools/factory/test_x.py", 200), ("tools/factory/systemd/a/b.timer", 150)]))
        self.assertEqual((verdict, d["sha"], d["lines"]), ("OK", "c9", 350))
        self.assertEqual(d["flags"], ["350 changed lines > max-lines 300"])


class TestReview(unittest.TestCase):
    HEAD = "abcdef01" + "2" * 32
    FIRED = "2026-11-12T08:05:00Z"

    def test_sha_bound_verdict_after_fired(self):
        rv = lambda i, t, sha, name, v: cm(i, t, "Review %s @%s: %s %s @%s: note" % (v, sha, name, v, sha))
        c = [rv(1, "08:04", "abcdef01", "LINUS", "ACCEPT"), rv(2, "08:06", "11111111", "LINUS", "ACCEPT"), rv(3, "08:07", "abcdef01", "BRUCE", "ACCEPT")]
        self.assertEqual(E.review(fake({COMMENTS: c}), FULL, 209, self.HEAD, "LINUS", self.FIRED)[0], "NONE")
        verdict, d = E.review(fake({COMMENTS: c + [rv(4, "08:08", "abcdef01", "LINUS", "REJECT")]}), FULL, 209, self.HEAD, "linus", self.FIRED)
        self.assertEqual((verdict, d["comment"], d["url"]), ("REJECT", 4, "https://github.com/x/4"))
        self.assertEqual(E.review(fake({COMMENTS: c}), FULL, 209, self.HEAD, "BRUCE", self.FIRED)[0], "ACCEPT")


if __name__ == "__main__":
    unittest.main()
