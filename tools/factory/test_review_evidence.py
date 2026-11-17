import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proof
import test_dispatch as T

BODY = "\n".join([
    "PLAN READY (facts read on dev 1615836)",
    "**Depends on**: none",
    "**Worker**: coder",
    "**Files**",
    "- `a/b.py`",
    "- `a/test_b.py`",
    "**Test file**: `a/test_b.py`",
    "**Change**",
    "- first ask",
    "- second ask",
    "- third ask",
    "**Done-test**",
    "- t",
    "**Run**",
    "```",
    "cd a && run1",
    "```",
])


def evidence(n, text="shown"):
    return "\n".join("EVIDENCE %d: %s" % (k, text) for k in range(1, n + 1))


class Reader(unittest.TestCase):
    def test_the_ask_bullets_of_the_change_are_counted_by_the_proof_reader(self):
        self.assertEqual(proof.change_asks(BODY), ["first ask", "second ask", "third ask"])
        self.assertEqual(proof.change_asks(T.ready()), [])

    def test_the_change_asks_include_corrections_and_skip_fences(self):
        body = "\n".join(["**Change**", "- one", "```", "- not an ask", "```", "**Corrections**", "- two", "**Done-test**", "- t"])
        self.assertEqual(proof.change_asks(body), ["one", "two"])

    def test_evidence_counts_each_distinct_ask_number_once(self):
        out = "EVIDENCE 1: a\nEVIDENCE 1: again\nEVIDENCE 3: c\nnoise\nEVIDENCE 4: beyond the count"
        self.assertEqual(proof.evidence(out, 3), 2)


class Review(T.Base):
    def setUp(self):
        super().setUp()
        self.w.issues[0]["body"] = BODY

    def reasons(self):
        return [r[0] for r in self.w.rows("SELECT reason FROM transitions WHERE job=5 ORDER BY id")]

    def kinds(self):
        return [r[0] for r in self.w.rows("SELECT kind FROM failures WHERE job='5'")]

    def review_message(self):
        return [m for a, m, _ in self.w.sends if "One review" in m][-1]

    def test_the_review_brief_lists_each_ask_and_asks_one_evidence_line_for_each_above_the_verdict(self):
        self.to_review()
        msg = self.review_message()
        self.assertIn("The asks of the Change, in order:", msg)
        for n, text in enumerate(["first ask", "second ask", "third ask"], 1):
            self.assertIn("ASK %d: %s" % (n, text), msg)
        self.assertIn("EVIDENCE <n>: <what you ran or read and what it showed>", msg)
        self.assertIn("An ACCEPT with fewer EVIDENCE lines than asks is not an ACCEPT.", msg)

    def test_an_accept_with_an_evidence_line_for_every_ask_goes_to_the_checks(self):
        self.to_review()
        self.w.finish("r1", evidence(3) + "\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_an_accept_short_of_evidence_is_asked_again_once_and_counted(self):
        self.to_review()
        self.w.finish("r1", evidence(2) + "\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertIn("accept with 2 of 3 evidence lines: asked again", self.reasons())
        self.assertIn("asked again", self.kinds())
        self.tick()
        self.w.finish("r1", evidence(3) + "\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_a_second_accept_short_of_evidence_is_a_failed_review(self):
        self.to_review()
        self.w.finish("r1", evidence(2) + "\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.tick()
        self.w.finish("r1", evidence(2) + "\nVERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("blocked: review without evidence twice: accept with 2 of 3 evidence lines", self.reasons())
        self.assertIn("review without evidence", self.kinds())
        self.assertEqual(self.w.merges, [])

    def test_a_reject_needs_only_its_sentence(self):
        self.to_review()
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: the test is wrong")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")

    def test_a_job_with_no_change_bullets_needs_no_evidence(self):
        self.w.issues[0]["body"] = T.ready()
        self.to_review()
        self.assertNotIn("The asks of the Change", self.review_message())
        self.w.finish("r1", "VERDICT: ACCEPT @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")


if __name__ == "__main__":
    unittest.main()
