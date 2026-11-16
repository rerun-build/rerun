import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COLUMNS = ["Id", "Date", "Who decided", "Owner's words", "Replaces", "Enforced in", "Status"]


def read_table():
    with open(os.path.join(HERE, "DECISIONS.md"), encoding="utf-8") as handle:
        lines = [line.rstrip("\n") for line in handle if line.startswith("|")]
    cells = [[c.strip() for c in line.strip().strip("|").split(" | ")] for line in lines]
    return cells[0], cells[2:]


class Decisions(unittest.TestCase):
    def test_the_table_has_the_seven_columns(self):
        header, rows = read_table()
        self.assertEqual(header, COLUMNS)
        for row in rows:
            self.assertEqual(len(row), 7, row)

    def test_ids_run_from_d1_and_dates_never_go_back(self):
        _, rows = read_table()
        self.assertGreaterEqual(len(rows), 2)
        self.assertEqual([r[0] for r in rows], ["D%d" % (i + 1) for i in range(len(rows))])
        dates = [r[1] for r in rows]
        for date in dates:
            self.assertRegex(date, r"^\d{4}-\d\d-\d\d$")
        self.assertEqual(dates, sorted(dates))

    def test_the_words_of_a_rule_in_force_stand_in_every_file_that_enforces_it(self):
        _, rows = read_table()
        for row in rows:
            match = re.match(r'^"(.+)"$', row[3])
            self.assertIsNotNone(match, row[0])
            paths = re.findall(r"`([^`]+)`", row[5])
            self.assertTrue(paths, row[0])
            for path in paths:
                full = os.path.join(ROOT, path)
                self.assertTrue(os.path.isfile(full), path)
                if row[6] == "in force":
                    with open(full, encoding="utf-8") as handle:
                        self.assertIn(match.group(1), handle.read(), row[0] + " " + path)

    def test_a_replaced_rule_is_marked_replaced_the_same_day(self):
        _, rows = read_table()
        by_id = {r[0]: r for r in rows}
        for row in rows:
            self.assertRegex(row[6], r"^(in force|replaced by D\d+ on \d{4}-\d\d-\d\d)$")
            old = re.match(r"^(D\d+)(?!\d)", row[4])
            if old:
                self.assertIn(old.group(1), by_id)
                self.assertEqual(by_id[old.group(1)][6], "replaced by %s on %s" % (row[0], row[1]))
            marked = re.match(r"^replaced by (D\d+) on (\d{4}-\d\d-\d\d)$", row[6])
            if marked:
                new = by_id.get(marked.group(1))
                self.assertIsNotNone(new)
                self.assertTrue(re.match(r"^%s(?!\d)" % re.escape(row[0]), new[4]))
                self.assertEqual(new[1], marked.group(2))
