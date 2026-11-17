from test_dispatch import Base, World

TYPES = {
    "coder": {"coworkers": [{"id": "b1", "name": "B1", "runs": 1}, {"id": "b2", "name": "B2", "runs": 1}], "max_jobs": 8},
    "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}, {"id": "r2", "name": "R2", "runs": 1}]},
    "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}]},
}
PLAN_TIER = {"plan": "high"}
PLAN_MODELS = {"plan": {"high": {"model": "claude-fable-5-2", "thinkingLevel": "medium"}}}
DAY = 86400
G1 = "fix round @ review"


def block(k, group, culprit="station brief", issue=301):
    return "CAUSE %d\nGROUP: %s\nWHY: a quoted line: 'stopped'\nCULPRIT: %s\nCHANGE: #%d\n" % (k, group, culprit, issue)


class Causes(Base):
    def setUp(self):
        super().setUp()
        self.w = World(issues=[])
        self.w.ledger = self.cfg["ledger_file"]
        self.cfg["types"] = TYPES
        self.cfg["planning"] = {"auto": False}

    def fail(self, n=1, job="#100", kind="fix round", station="review"):
        for _ in range(n):
            self.d.store.add_failure(kind, job, station=station, coworker="B1", reason="stopped")

    def first(self):
        self.tick()
        self.fail(10)
        self.tick(5)

    def boss(self):
        return [s for s in self.w.sends if s[0] == "p1"]

    def kv(self, k):
        rows = self.w.rows("SELECT v FROM kv WHERE job='causes' AND k=?", k)
        return rows[0][0] if rows else None

    def changes(self):
        return self.w.rows("SELECT issue, grp, kind, before, after FROM changes ORDER BY id")

    def test_nine_events_send_nothing_and_the_tenth_sends_the_table_to_boss(self):
        self.tick()
        self.fail(9)
        self.tick(5)
        self.assertEqual(self.boss(), [])
        self.fail()
        self.tick(5)
        self.assertEqual(len(self.boss()), 1)
        self.assertIn("| fix round @ review | #100 |", self.boss()[0][1])
        self.assertEqual(self.w.rows("SELECT job, coworker FROM fires WHERE job='causes'"), [("causes", "Boss")])

    def test_one_event_is_sent_after_a_day(self):
        self.tick()
        self.fail()
        self.tick(5)
        self.assertEqual(self.boss(), [])
        self.w.clock += DAY
        self.tick(5)
        self.assertEqual(len(self.boss()), 1)

    def test_never_a_second_analysis_while_one_is_out(self):
        self.first()
        self.assertEqual(len(self.boss()), 1)
        self.fail(10)
        self.tick(5)
        self.assertEqual(len(self.boss()), 1)
        self.assertEqual(self.kv("state"), "running")

    def test_the_run_goes_out_at_the_plan_tier_model_when_the_settings_name_one(self):
        self.cfg["tiers"] = PLAN_TIER
        self.cfg["tier_models"] = PLAN_MODELS
        self.first()
        self.assertEqual(self.w.send_args[-1]["model"], "claude-fable-5-2")
        self.assertEqual(self.w.send_args[-1]["thinkingLevel"], "medium")

    def test_without_tier_models_the_args_name_no_model(self):
        self.first()
        self.assertNotIn("model", self.w.send_args[-1])
        self.assertNotIn("thinkingLevel", self.w.send_args[-1])

    def test_a_tier_table_that_raises_names_no_model(self):
        self.cfg["tiers"] = PLAN_TIER
        self.cfg["tier_models"] = {"plan": "oops"}
        self.first()
        self.assertEqual(len(self.boss()), 1)
        self.assertNotIn("model", self.w.send_args[-1])

    def test_changes_become_rows_of_the_change_log_with_the_rate_before(self):
        self.first()
        self.w.finish("p1", block(1, G1) + "CAUSES: 1 changes")
        self.tick(12)
        self.assertEqual(self.changes(), [(301, G1, "repo", None, None)])
        self.assertEqual(self.kv("state"), "idle")
        self.assertEqual(len(self.boss()), 1)

    def test_a_change_to_a_coworkers_instructions_is_of_kind_instructions(self):
        self.first()
        self.w.finish("p1", block(1, G1, culprit="coworker instructions", issue=302) + "CAUSES: 1 changes")
        self.tick(1)
        self.assertEqual(self.changes(), [(302, G1, "instructions", None, None)])

    def test_causes_none_closes_the_batch_without_a_row(self):
        self.first()
        self.w.finish("p1", "CAUSES: none")
        self.tick(1)
        self.assertEqual(self.changes(), [])
        self.assertEqual(self.kv("last_id"), "10")
        self.assertEqual(self.kv("state"), "idle")

    def test_a_bad_answer_is_asked_once_more_and_then_the_batch_is_closed(self):
        self.first()
        self.w.finish("p1", "no answer")
        self.tick(5)
        self.assertEqual(len(self.boss()), 2)
        self.w.finish("p1", "still none")
        self.tick(5)
        self.assertEqual(len(self.boss()), 2)
        self.assertEqual(self.kv("last_id"), "10")
        self.assertEqual(self.kv("state"), "idle")

    def test_the_three_largest_groups_carry_run_records(self):
        self.tick()
        self.fail(4, job="7", kind="fix round", station="review")
        self.fail(3, job="8", kind="ended blocked", station="build")
        self.fail(2, job="9", kind="ended failed", station="merge")
        self.fail(1, job="10", kind="ended blocked", station="review")
        self.tick(5)
        text = self.boss()[0][1]
        self.assertEqual(text.count("Run records of the group"), 3)
        self.assertIn('"transitions"', text)
        self.assertIn('"fires"', text)

    def test_without_a_coworker_named_boss_nothing_is_sent(self):
        self.cfg["types"] = {"coder": TYPES["coder"], "reviewer": TYPES["reviewer"]}
        self.tick()
        self.fail(10)
        self.tick(5)
        self.assertEqual(self.w.sends, [])
