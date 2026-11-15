import unittest
import tokenstats


def fire(job, stage, who, tin, tout, cr, chunk="A"):
    return {"job": job, "chunk": chunk, "stage": stage, "coworker": who, "tokens_in": tin, "tokens_out": tout, "cache_read": cr}


FIRES = [
    fire(1, "build", "code", 1000, 100, 800),
    fire(2, "build", "code", 1000, 100, 800),
    fire(2, "build", "code", 1000, 100, None),
    fire(1, "fix", "code", 600, 50, 300),
    fire(1, "review", "LARRY", 400, 40, 100),
    fire(3, "build", "code", 9000, 900, 9000),
]
MERGED = [(1, "A"), (2, "A")]


class PerMerged(unittest.TestCase):
    def test_by_stage(self):
        out = tokenstats.per_merged(FIRES, MERGED, "stage")
        self.assertEqual(out["build"], {"changes": 2, "tokens_in": 1500, "tokens_out": 150, "cache_read": 800, "cache_share": 0.8})
        self.assertEqual(out["review"]["cache_share"], 0.25)
        self.assertEqual(out["fix"]["cache_share"], 0.5)

    def test_by_coworker(self):
        out = tokenstats.per_merged(FIRES, MERGED, "coworker")
        self.assertEqual(out["code"]["changes"], 2)
        self.assertEqual(out["code"]["tokens_in"], 1800)
        self.assertEqual(out["LARRY"]["cache_share"], 0.25)

    def test_null_cache(self):
        out = tokenstats.per_merged([fire(1, "build", "code", 100, 10, None)], [(1, "A")], "stage")
        self.assertIsNone(out["build"]["cache_read"])
        self.assertIsNone(out["build"]["cache_share"])

    def test_nothing_merged(self):
        self.assertEqual(tokenstats.per_merged(FIRES, [], "stage"), {})


if __name__ == "__main__":
    unittest.main()
