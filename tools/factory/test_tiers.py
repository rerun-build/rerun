import unittest

from tiers import size_of, tier_for

TABLE = {
    "plan": "high",
    "build": {"small": "low", "medium": "medium", "large": "high"},
    "review": "high",
    "proof": "medium",
    "research": "low",
}


class SizeOfTests(unittest.TestCase):
    def test_reads_each_size(self):
        for size in ("small", "medium", "large"):
            body = "intro\n**Size**: " + size + "\nmore"
            self.assertEqual(size_of(body), size)
        self.assertEqual(size_of("**size**: LARGE"), "large")

    def test_no_line_gives_medium(self):
        self.assertEqual(size_of("nothing here"), "medium")
        self.assertEqual(size_of(None), "medium")

    def test_bad_size_and_double_line_raise(self):
        with self.assertRaises(ValueError):
            size_of("**Size**: huge")
        with self.assertRaises(ValueError):
            size_of("**Size**: small\n**Size**: large")


class TierForTests(unittest.TestCase):
    def test_string_entry_ignores_size(self):
        for size in ("small", "medium", "large"):
            self.assertEqual(tier_for("plan", size, TABLE), "high")

    def test_object_entry_follows_size(self):
        got = [tier_for("build", s, TABLE) for s in ("small", "medium", "large")]
        self.assertEqual(got, ["low", "medium", "high"])

    def test_unknown_station_and_missing_size_raise(self):
        with self.assertRaises(ValueError):
            tier_for("deploy", "small", TABLE)
        with self.assertRaises(ValueError):
            tier_for("build", "small", {"build": {"large": "high"}})

    def test_bad_tier_raises(self):
        with self.assertRaises(ValueError):
            tier_for("plan", "small", {"plan": "max"})

    def test_no_table_gives_none(self):
        self.assertIsNone(tier_for("plan", "small", None))
        self.assertIsNone(tier_for("plan", "small", {}))


if __name__ == "__main__":
    unittest.main()
