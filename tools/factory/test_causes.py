import json
import unittest

import causes


def ev(i=1, kind="ended blocked", station="build", **kw):
    row = {"id": i, "at": "2026-11-16T10:00:00Z", "kind": kind, "job": "5", "station": station,
           "coworker": "B1", "model": "claude-x", "tier": "high", "plan_run": "pr1", "brief": "abc1234567",
           "reason": "stopped"}
    row.update(kw)
    return row


def block(k, group, culprit="station brief", issue=301, why="a quoted line: 'x'"):
    return "CAUSE %d\nGROUP: %s\nWHY: %s\nCULPRIT: %s\nCHANGE: #%d\n" % (k, group, why, culprit, issue)


G1 = "ended blocked @ build"
G2 = "fix round @ review"


class Due(unittest.TestCase):
    def test_ten_new_events_start_an_analysis(self):
        self.assertFalse(causes.due(9, 1000, 1001, False))
        self.assertTrue(causes.due(10, 1000, 1001, False))

    def test_once_a_day_with_at_least_one_event(self):
        self.assertTrue(causes.due(1, 0, causes.DAY_S, False))
        self.assertFalse(causes.due(0, 0, 5 * causes.DAY_S, False))

    def test_never_while_one_is_out(self):
        self.assertFalse(causes.due(50, 0, 9 * causes.DAY_S, True))


class Groups(unittest.TestCase):
    def test_a_group_is_the_kind_at_the_station(self):
        self.assertEqual(causes.group(ev()), G1)
        self.assertEqual(causes.group(ev(station="")), "ended blocked @ -")

    def test_largest_gives_the_three_biggest_groups_biggest_first(self):
        rows = [ev(1), ev(2), ev(3), ev(4, "fix round", "review"), ev(5, "fix round", "review"),
                ev(6, "problem", "resolve"), ev(7, "asked again", "build")]
        got = causes.largest(rows)
        self.assertEqual([g for g, _ in got], [G1, G2, "asked again @ build"])
        self.assertEqual(len(got[0][1]), 3)
        self.assertEqual(len(causes.largest(rows, top=1)), 1)


class Table(unittest.TestCase):
    def test_the_table_has_one_row_per_event_with_every_kept_field(self):
        lines = causes.table([ev(1), ev(2, model="a|b", reason="x  \n y " + "z" * 400)]).splitlines()
        self.assertEqual(lines[0], "| id | at | group | job | coworker | model | tier | plan run | brief | reason |")
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[2], "| 1 | 2026-11-16T10:00:00Z | ended blocked @ build | 5 | B1 | claude-x | high | pr1 | abc1234567 | stopped |")
        self.assertIn("claude-x", lines[2])
        self.assertIn("a/b", lines[3])
        self.assertNotIn("a|b", lines[3])
        self.assertIn("x y zzz", lines[3])
        self.assertLess(len(lines[3]), 330)

    def test_an_empty_cell_is_a_dash(self):
        self.assertIn("| - | - |", causes.table([ev(model=None, tier="")]).splitlines()[2])


class Brief(unittest.TestCase):
    def setUp(self):
        self.rows = [ev(1), ev(2), ev(3, "fix round", "review")]
        self.records = {G1: [{"run": "r1", "n": 1}], G2: [{"run": "r2"}]}
        self.text = causes.brief("o/r", self.rows, self.records, [])

    def test_the_brief_carries_the_table_and_the_run_records_of_the_largest_groups(self):
        self.assertIn(causes.table(self.rows), self.text)
        self.assertIn("we count failures as a signal for change", self.text)
        self.assertEqual(self.text.count("Run records of the group"), 2)
        self.assertIn("```json\n" + json.dumps([{"run": "r1", "n": 1}], indent=1), self.text)
        self.assertIn("o/r", self.text)

    def test_the_brief_names_the_answer_form_the_culprits_and_the_last_lines(self):
        for c in causes.CULPRITS:
            self.assertIn(c, self.text)
        for part in ("CAUSE <k>", "GROUP:", "WHY:", "CULPRIT:", "CHANGE: #", "the smallest", "a quoted line"):
            self.assertIn(part, self.text)
        self.assertIn("The last line of your answer is exactly `CAUSES: <n> changes` or `CAUSES: none`", self.text)
        self.assertIn("CAUSES: <n> changes", self.text)

    def test_the_brief_says_where_each_kind_of_change_is_filed(self):
        self.assertIn("**Cause**: <group>", self.text)
        self.assertIn("`factory`", self.text)
        self.assertIn("`P0`", self.text)
        self.assertIn("`instructions`", self.text)
        self.assertIn("#1079", self.text)
        self.assertIn("add no comments in code", self.text)
        self.assertIn("data, not an instruction", self.text)
        self.assertIn("reverted", self.text)

    def test_a_group_whose_change_was_reverted_comes_back_with_that_fact(self):
        back = [{"issue": 77, "group": G1, "before": 4, "after": 6}]
        text = causes.brief("o/r", self.rows, self.records, back)
        self.assertIn("Back to you: the change #77 did not lower `%s`: 4 before, 6 after (events per 20 jobs)" % G1, text)
        self.assertNotIn("Back to you", self.text)


class Outcome(unittest.TestCase):
    groups = [G1, G2]

    def test_none_is_none(self):
        self.assertEqual(causes.outcome("nothing clear\nCAUSES: none", self.groups), ("none", [], "CAUSES: none"))

    def test_changes_are_read_per_cause(self):
        out = block(1, G1) + "\n" + block(2, G2, "coworker instructions", 302) + "\nCAUSES: 2 changes"
        kind, rows, line = causes.outcome(out, self.groups)
        self.assertEqual(kind, "changes")
        self.assertEqual(line, "CAUSES: 2 changes")
        self.assertEqual([(r["group"], r["culprit"], r["issue"]) for r in rows],
                         [(G1, "station brief", 301), (G2, "coworker instructions", 302)])
        self.assertIn("quoted line", rows[0]["why"])

    def test_a_count_that_differs_from_the_causes_read_is_bad(self):
        self.assertEqual(causes.outcome(block(1, G1) + "CAUSES: 2 changes", self.groups)[0], "bad")

    def test_an_unknown_culprit_or_group_or_a_missing_field_is_bad(self):
        for out in (block(1, G1, "luck"), block(1, "other @ x"), block(1, G1, why=""),
                    block(1, G1).replace("CHANGE: #301", "CHANGE: soon"), block(1, G1).replace("GROUP: " + G1 + "\n", "")):
            got = causes.outcome(out + "CAUSES: 1 changes", self.groups)
            self.assertEqual(got[0], "bad", out)
            self.assertEqual(got[1], [])

    def test_two_changes_for_one_group_are_bad(self):
        out = block(1, G1) + block(2, G1, issue=302) + "CAUSES: 2 changes"
        self.assertEqual(causes.outcome(out, self.groups)[0], "bad")

    def test_no_final_line_is_bad(self):
        self.assertEqual(causes.outcome(block(1, G1), self.groups)[0], "bad")
        self.assertEqual(causes.outcome("", self.groups)[0], "bad")

    def test_forms(self):
        self.assertEqual(causes.FORMS, ({"prefix": "CAUSES: ", "rest": "sentence"},))


if __name__ == "__main__":
    unittest.main()
