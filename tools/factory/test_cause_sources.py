import os
import tempfile
import unittest

import causes
import failures
import learn
from store import Store
from test_dispatch import Base


class BriefText(Base):
    def test_the_text_of_a_brief_is_kept_once_per_hash(self):
        self.tick()
        h = failures.version("building")
        self.assertEqual(self.d.store.brief_text(h), {"hash": h, "state": "building", "text": self.w.sends[0][1]})
        self.tick(3)
        self.assertEqual(self.d.store.db.execute("SELECT COUNT(*) FROM briefs WHERE hash=?", (h,)).fetchone()[0], 1)


class RunRecord(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.s = Store(os.path.join(self.dir.name, "ledger.db"))
        self.addCleanup(self.s.close)

    def test_the_run_record_carries_the_run_ids_and_the_text_of_the_briefs_of_its_failures(self):
        self.s.keep_brief("abc1234567", "building", "first text")
        self.s.keep_brief("abc1234567", "building", "second text")
        self.s.keep_brief("def7654321", "review", "other")
        self.s.add_failure("ended blocked", "7", station="build", brief="abc1234567")
        self.s.add_failure("fix round", "7", station="review", brief="def7654321")
        self.s.add_failure("fix round", "7", station="review", brief="abc1234567")
        fire = self.s.intent("7", "", "build", coworker="B1")
        self.s.fired(fire, "run7")
        rec = learn.record(self.s, "7")
        self.assertEqual(rec["fires"][0]["run"], "run7")
        self.assertEqual(rec["briefs"], [
            {"hash": "abc1234567", "state": "building", "text": "first text"},
            {"hash": "def7654321", "state": "review", "text": "other"},
        ])

    def test_the_text_of_a_brief_in_the_record_is_cut_to_6000_characters(self):
        self.s.keep_brief("cut0000001", "building", "x" * 7000)
        self.s.add_failure("ended blocked", "8", station="build", brief="cut0000001")
        rec = learn.record(self.s, "8")
        self.assertEqual(len(rec["briefs"][0]["text"]), 6000)


class BriefSources(unittest.TestCase):
    def setUp(self):
        self.text = causes.brief("o/r", [], {}, [])

    def test_the_brief_names_each_source_boss_may_read_and_that_each_is_read_only(self):
        for s in ("includeToolCalls", "/data/tools/bin/gh issue view", "/data/tools/bin/gh pr view", "--comments",
                  "/data/tools/bin/job-cost", "`briefs`", "read only"):
            self.assertIn(s, self.text)

    def test_the_brief_says_a_why_without_a_quoted_line_is_not_accepted(self):
        self.assertIn("A WHY without a quoted line from one of these sources is not accepted", self.text)


class QuotedWhy(unittest.TestCase):
    def test_a_why_without_a_quoted_line_is_refused(self):
        self.assertEqual(causes.read_block("CAUSE 1\nGROUP: G\nWHY: no line quoted here\nCULPRIT: station brief\nCHANGE: #301\n", ["G"]),
                         (None, "block for G has a WHY without a quoted line"))
        self.assertEqual(causes.outcome("CAUSE 1\nGROUP: G\nWHY: no line quoted here\nCULPRIT: station brief\nCHANGE: #301\nCAUSES: 1 changes\n", ["G"])[0], "bad")

    def test_a_why_quoting_a_line_in_double_quotes_or_backticks_is_read(self):
        for why in ('"the dispatcher merges only when" is it', '`the dispatcher merges only when` is it'):
            row, why_bad = causes.read_block("CAUSE 1\nGROUP: G\nWHY: %s\nCULPRIT: station brief\nCHANGE: #301\n" % why, ["G"])
            self.assertEqual(why_bad, "")
            self.assertEqual(row["group"], "G")

    def test_a_quote_of_fewer_than_eight_characters_is_no_quoted_line(self):
        row, why_bad = causes.read_block('CAUSE 1\nGROUP: G\nWHY: "1234567" is short\nCULPRIT: station brief\nCHANGE: #301\n', ["G"])
        self.assertIsNone(row)
        self.assertEqual(why_bad, "block for G has a WHY without a quoted line")
        row, why_bad = causes.read_block('CAUSE 1\nGROUP: G\nWHY: "12345678" is enough\nCULPRIT: station brief\nCHANGE: #301\n', ["G"])
        self.assertEqual(why_bad, "")


if __name__ == "__main__":
    unittest.main()
