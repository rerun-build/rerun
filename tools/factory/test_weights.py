import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import causes
import store as ledger_store
import weights
from test_dispatch import Base

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = ("claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")
KEYS = {"input", "cache_read", "cache_write", "output"}
TABLE = {"models": {"cheap": {"input": 1, "cache_read": 0.1, "cache_write": 1.25, "output": 5},
                    "dear": {"input": 8, "cache_read": 0.2, "cache_write": 10, "output": 40}}}


class File(unittest.TestCase):
    def test_the_file_names_its_source_its_date_and_four_weights_per_model(self):
        with open(os.path.join(HERE, "token-weights.json")) as f:
            data = json.load(f)
        self.assertEqual(data["source"], "https://platform.claude.com/docs/en/about-claude/pricing")
        self.assertEqual(data["read"], "2026-11-16")
        self.assertEqual(data["unit"], "US dollars per million tokens, list price")
        self.assertEqual(tuple(data["models"]), MODELS)
        for row in data["models"].values():
            self.assertEqual(set(row), KEYS)
        self.assertEqual(data["models"]["claude-sonnet-5-5"], {"input": 2, "cache_read": 0.1, "cache_write": 2.5, "output": 10})
        self.assertEqual(weights.load(), data)

    def test_a_missing_or_unreadable_file_loads_as_empty(self):
        self.assertEqual(weights.load("/nonexistent/token-weights.json"), {})


class Units(unittest.TestCase):
    def test_fresh_input_is_input_less_cache_reads_and_writes(self):
        row = {"model": "cheap", "tokens_in": 1000000, "cache_read": 600000, "cache_write": 100000, "tokens_out": 200000}
        got, weighed = weights.units(row, TABLE)
        self.assertAlmostEqual(got, 1.485)
        self.assertTrue(weighed)

    def test_no_cache_counts_are_fresh_input(self):
        got, weighed = weights.units({"model": "cheap", "tokens_in": 2000000, "tokens_out": 0}, TABLE)
        self.assertAlmostEqual(got, 2.0)
        self.assertTrue(weighed)

    def test_a_model_without_a_row_takes_the_dearest_row_and_is_unweighed(self):
        for model in (None, "claude-x"):
            self.assertEqual(weights.units({"model": model, "tokens_in": 1000000, "tokens_out": 1000000}, TABLE), (48.0, False))

    def test_no_table_weighs_nothing(self):
        self.assertEqual(weights.units({"model": "cheap", "tokens_in": 5, "tokens_out": 5}, {}), (0.0, False))


class Ledger(unittest.TestCase):
    def test_an_intent_keeps_the_model_and_thinking_level_of_its_run(self):
        with tempfile.TemporaryDirectory() as d:
            s = ledger_store.Store(os.path.join(d, "l.db"))
            a = s.intent("5", "", "build", model="claude-sonnet-5-5", thinking="high")
            b = s.intent("5", "", "build")
            got = [tuple(r) for r in s.db.execute("SELECT model, thinking FROM fires WHERE id IN (?,?) ORDER BY id", (a, b))]
            s.close()
        self.assertEqual(got, [("claude-sonnet-5-5", "high"), (None, None)])


class Through(Base):
    def shipped(self):
        with open(os.path.join(HERE, "dispatch.json")) as f:
            cfg = json.load(f)
        self.cfg["tiers"] = cfg["tiers"]
        self.cfg["tier_models"] = cfg["tier_models"]
        self.w.issues[0]["body"] = __import__("test_dispatch").ready("**Size**: medium")

    def test_the_fire_of_a_build_keeps_the_model_and_thinking_level_it_was_sent_with(self):
        self.shipped()
        self.tick()
        self.assertEqual(self.w.rows("SELECT stage, model, thinking FROM fires"), [("build", "claude-sonnet-5-5", "medium")])

    def test_a_failure_event_keeps_the_runs_and_cost_units_of_its_job_so_far(self):
        self.shipped()
        self.tick()
        self.w.finish("b1", "tried\nBLOCKED: no")
        rid = [r for r, a in self.w.order if a == "b1"][-1]
        self.w.runs[rid].update(inputTokens=1000000, outputTokens=100000, cachedInputTokens=500000)
        self.tick(2)
        rows = self.w.rows("SELECT kind, runs, cost FROM failures")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:2], ("ended blocked", 1))
        self.assertAlmostEqual(rows[0][2], 2.05)


class Table(unittest.TestCase):
    def test_the_cause_table_shows_the_runs_and_cost_units_of_each_event(self):
        event = {"id": 1, "at": "2026-11-16T10:00:00Z", "kind": "ended blocked", "station": "build", "job": "5",
                 "coworker": "B1", "model": "claude-x", "tier": "high", "plan_run": "pr1", "brief": "abc1234567",
                 "runs": 3, "cost": 1.25, "reason": "stopped"}
        lines = causes.table([event]).splitlines()
        self.assertEqual(lines[0], "| id | at | group | job | coworker | model | tier | plan run | brief | runs | cost | reason |")
        self.assertIn("| abc1234567 | 3 | 1.25 | stopped |", lines[2])


if __name__ == "__main__":
    unittest.main()
