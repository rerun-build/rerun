import unittest

import notes

PLAN = "## Plan\n\n### Result\nA person sees the queue on the floor.\n\n### Slices\n- one slice that adds `queue_view`\n"

OUT = """Checked dev.

NOTE 1 CHANGE major
QUOTE: A person sees the queue on the floor.
PROBLEM: the floor shows nothing when the queue is empty
EVIDENCE: apps/ui/floor.tsx: Floor renders null for []
FIX: say what the floor shows when the queue is empty

NOTE 2 REMOVE minor
QUOTE: this text is not in the plan at all
FIX: drop it

NOTE 3 OWNER major
QUOTE: one slice that adds queue_view
PROBLEM: who the queue is for is not settled
OPTION: only Rob sees it: the issue names him
OPTION: every member sees it
CATEGORY: product

NOTE 4 DECIDE minor
QUOTE: one slice that adds `queue_view`
OPTION: one slice
OPTION: two slices

NOTE 5 OWNER major
QUOTE: A person sees the queue on the floor.
OPTION: a
OPTION: b
CATEGORY: colour

NOTE 6 CHANGE sometimes
QUOTE: A person sees the queue on the floor.
FIX: x

REVIEW: 6 notes"""


class Read(unittest.TestCase):
    def setUp(self):
        self.kept, self.dropped = notes.read(OUT, PLAN)
        self.by = {n["n"]: n for n in self.kept}

    def test_a_note_whose_quote_is_in_the_plan_is_kept_with_its_fields(self):
        one = self.by[1]
        self.assertEqual((one["kind"], one["severity"]), ("CHANGE", "major"))
        self.assertEqual(one["FIX"], "say what the floor shows when the queue is empty")

    def test_a_quote_that_is_not_in_the_plan_throws_the_note_away(self):
        self.assertNotIn(2, self.by)
        self.assertIn((2, "its quote is not in the plan"), self.dropped)

    def test_backticks_and_spaces_do_not_break_a_quote(self):
        self.assertIn(3, self.by)
        self.assertIn(4, self.by)

    def test_an_owner_note_outside_the_owner_list_becomes_a_choice_for_boss(self):
        self.assertEqual(self.by[3]["kind"], "OWNER")
        self.assertEqual(self.by[5]["kind"], "DECIDE")
        self.assertEqual([n["n"] for n in notes.owner(self.kept)], [3])

    def test_unknown_severity_is_thrown_away_with_its_reason(self):
        self.assertIn((6, "unknown severity sometimes"), self.dropped)

    def test_heavy_counts_blocking_and_major_but_not_owner_notes(self):
        self.assertEqual([n["n"] for n in notes.heavy(self.kept)], [1, 5])

    def test_render_reads_back_the_same_notes(self):
        again, dropped = notes.read(notes.render_all(self.kept), PLAN)
        self.assertEqual(dropped, [])
        self.assertEqual([(n["n"], n["kind"]) for n in again], [(n["n"], n["kind"]) for n in self.kept])


class Shape(unittest.TestCase):
    def test_a_choice_needs_two_options_and_a_point_needs_a_fix(self):
        kept, dropped = notes.parse("NOTE 1 DECIDE major\nQUOTE: something long enough\nOPTION: only one\n"
                                    "NOTE 2 CHANGE major\nQUOTE: something long enough\n")
        self.assertEqual(kept, [])
        self.assertEqual(dropped, [(1, "a choice with fewer than two OPTION lines"), (2, "no FIX line")])

    def test_a_short_quote_does_not_anchor(self):
        kept, dropped = notes.read("NOTE 1 CHANGE major\nQUOTE: Plan\nFIX: x", PLAN)
        self.assertEqual((kept, dropped), ([], [(1, "its quote is not in the plan")]))

    def test_more_than_the_limit_is_cut_and_said(self):
        text = "\n".join("NOTE %d CHANGE minor\nQUOTE: A person sees the queue on the floor.\nFIX: x" % k for k in range(1, notes.MAX_NOTES + 3))
        kept, dropped = notes.read(text, PLAN)
        self.assertEqual(len(kept), notes.MAX_NOTES)
        self.assertEqual(len(dropped), 2)


class Comment(unittest.TestCase):
    def test_the_comment_does_not_start_like_a_plan(self):
        text = notes.comment([], [], 1, "on")
        self.assertFalse(text.startswith("## Plan"))
        self.assertIn("No points", text)

    def test_dry_run_says_so(self):
        self.assertIn("dry run", notes.comment([], [], 2, "dry"))

    def test_diff_is_short_or_says_to_read_the_whole(self):
        self.assertIn("+B", notes.diff("A", "B"))
        self.assertEqual(notes.diff("A", "A"), "")
        self.assertIn("read it whole", notes.diff("a", "b\n" * 4000))


if __name__ == "__main__":
    unittest.main()
