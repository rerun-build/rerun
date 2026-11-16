import unittest

import instructions

OLD = "Plan each job in one pass."
NEW = "Plan each job in one pass.\n\n```\nrun the check\n```\nStop at the first failure."
SOUL = "You are a coworker.\n\n" + OLD + "\n\nEnd of text.\n"

BODY = (
    "**Coworker**: linus\n"
    "**Cause**: late merges\n"
    "**Reason**: Merges wait too long.\n\n"
    "**Old text**\n~~~~\n" + OLD + "\n~~~~\n\n"
    "**New text**\n~~~~\n" + NEW + "\n~~~~\n"
)


class InstructionsTests(unittest.TestCase):
    def test_a_full_issue_is_read(self):
        p = instructions.parse({"number": 7, "body": BODY})
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["number"], 7)
        self.assertEqual(p["coworker"], "linus")
        self.assertEqual(p["cause"], "late merges")
        self.assertEqual(p["reason"], "Merges wait too long.")
        self.assertEqual(p["old"], OLD)
        self.assertEqual(p["new"], NEW)
        self.assertIn("```", p["new"])

    def test_each_missing_part_is_one_error(self):
        for key in ("Coworker", "Cause", "Reason"):
            body = "\n".join(l for l in BODY.split("\n") if not l.startswith("**%s**" % key))
            self.assertEqual(len(instructions.parse({"number": 1, "body": body})["errors"]), 1, key)
        body = BODY.split("**New text**")[0]
        self.assertEqual(len(instructions.parse({"number": 1, "body": body})["errors"]), 1)

    def test_an_empty_old_text_means_the_new_text_is_added_at_the_end(self):
        self.assertEqual(instructions.apply("Soul\n\n", "", "Extra"), "Soul\n\nExtra\n")
        body = BODY.replace(OLD + "\n~~~~\n\n**New", "~~~~\n\n**New", 1).replace("~~~~\n~~~~", "~~~~\n~~~~")
        p = instructions.parse({"number": 1, "body": body})
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["old"], "")

    def test_an_empty_new_text_is_an_error(self):
        body = BODY.replace(NEW, "")
        self.assertEqual(len(instructions.parse({"number": 1, "body": body})["errors"]), 1)

    def test_the_old_text_is_replaced_where_it_stands_and_the_rest_is_untouched(self):
        out = instructions.apply(SOUL, OLD, NEW)
        self.assertEqual(out, "You are a coworker.\n\n" + NEW + "\n\nEnd of text.\n")

    def test_old_text_that_is_absent_or_stands_twice_is_refused(self):
        with self.assertRaises(ValueError) as a:
            instructions.apply(SOUL, "missing", NEW)
        self.assertIn("occurs 0 times", str(a.exception))
        with self.assertRaises(ValueError) as b:
            instructions.apply(SOUL + OLD, OLD, NEW)
        self.assertIn("occurs 2 times", str(b.exception))

    def test_the_revert_body_swaps_old_and_new_and_parses(self):
        p = instructions.parse({"number": 40, "body": BODY})
        rb = instructions.revert_body(40, p, "3 of 5")
        r = instructions.parse({"number": 41, "body": rb})
        self.assertEqual(r["errors"], [])
        self.assertEqual((r["old"], r["new"]), (NEW, OLD))
        self.assertEqual((r["coworker"], r["cause"]), ("linus", "late merges"))
        self.assertIn("#40", r["reason"])
        self.assertEqual(r["reason"], "Reverts #40: it did not lower its group (3 of 5).")
        changed = instructions.apply(SOUL, p["old"], p["new"])
        self.assertEqual(instructions.apply(changed, r["old"], r["new"]), SOUL)

    def test_the_review_brief_carries_the_change_and_what_to_check(self):
        p = instructions.parse({"number": 7, "body": BODY})
        brief = instructions.review_brief("o/r", 7, p)
        for part in ("o/r", "7", "linus", "late merges", "Merges wait too long.", OLD, NEW, "smallest change", "secret"):
            self.assertIn(part, brief)
        self.assertIn("VERDICT: ACCEPT", brief.splitlines()[-1])
        self.assertIn("VERDICT: REJECT: <one sentence>", brief.splitlines()[-1])

    def test_the_verdict_is_read_from_the_last_verdict_line(self):
        self.assertEqual(instructions.FORMS[0]["prefix"], "VERDICT: ")
        out = "x\nVERDICT: REJECT: no\nmore\nVERDICT: ACCEPT"
        self.assertEqual(instructions.verdict(out), ("accept", "VERDICT: ACCEPT"))
        self.assertEqual(instructions.verdict("VERDICT: REJECT: too wide")[0], "reject")
        self.assertEqual(instructions.verdict("nothing")[0], None)
        self.assertIsNone(instructions.verdict("VERDICT: ACCEPT\nVERDICT: maybe")[0])


if __name__ == "__main__":
    unittest.main()
