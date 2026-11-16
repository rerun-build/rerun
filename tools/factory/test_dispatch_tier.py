import json
import unittest

import test_dispatch as T


TABLE = {
    "build": {"small": "low", "medium": "medium", "large": "high"},
    "fix": "medium",
    "review": {"small": "high", "medium": "high", "large": "high"},
    "proof": "high",
}


class Tier(T.Base):
    def data(self):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job=?", "5")[0][0])

    def test_no_tiers_in_the_config_writes_no_tier(self):
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertNotIn("tier", self.data())

    def test_a_small_job_build_is_written_low(self):
        self.cfg["tiers"] = TABLE
        self.w.issues[0]["body"] = T.ready("**Size**: small")
        self.tick()
        self.assertEqual(self.data()["tier"], "low")

    def test_a_job_without_a_size_line_is_written_medium(self):
        self.cfg["tiers"] = TABLE
        self.tick()
        self.assertEqual(self.data()["tier"], "medium")

    def test_the_same_small_job_in_review_is_written_high(self):
        self.cfg["tiers"] = TABLE
        self.w.issues[0]["body"] = T.ready("**Size**: small")
        self.to_review()
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual(self.data()["tier"], "high")

    def test_a_table_lacking_the_station_logs_and_the_job_still_builds(self):
        self.cfg["tiers"] = {"review": "high"}
        self.tick()
        self.assertEqual(self.state(), "building")
        self.assertNotIn("tier", self.data())
        self.assertIn("no tier written: station without a tier: build", self.out.getvalue())


if __name__ == "__main__":
    unittest.main()
