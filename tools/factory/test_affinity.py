import unittest

import affinity


class PickTests(unittest.TestCase):
    def test_last_copy_wins_inside_life(self):
        self.assertEqual(affinity.pick(["a", "b"], "b", 0, 3599, 3600), "b")
        self.assertEqual(affinity.pick(["a", "b"], "b", 0, 299, 300), "b")

    def test_first_free_at_exact_life(self):
        self.assertEqual(affinity.pick(["a", "b"], "b", 0, 3600, 3600), "a")
        self.assertEqual(affinity.pick(["a", "b"], "b", 0, 300, 300), "a")

    def test_busy_last_copy_gives_first_free(self):
        self.assertEqual(affinity.pick(["a", "c"], "b", 0, 10, 3600), "a")

    def test_no_last_copy_and_empty_free(self):
        self.assertEqual(affinity.pick(["a", "b"], None, None, 10, 3600), "a")
        self.assertEqual(affinity.pick(["a", "b"], "b", None, 10, 3600), "a")
        self.assertIsNone(affinity.pick([], "b", 0, 10, 3600))

    def test_free_unchanged(self):
        free = ["a", "b"]
        affinity.pick(free, "b", 0, 10, 3600)
        self.assertEqual(free, ["a", "b"])

    def test_cache_life(self):
        table = {"subscription": 3600, "key": 300}
        self.assertEqual(affinity.cache_life("subscription", table), 3600)
        self.assertEqual(affinity.cache_life("key", table), 300)
        self.assertEqual(affinity.cache_life("other", table), 0)
        self.assertEqual(affinity.cache_life("key", None), 0)

    def test_zero_life_never_keeps_affinity(self):
        self.assertEqual(affinity.pick(["a", "b"], "b", 0, 0, 0), "a")


if __name__ == "__main__":
    unittest.main()
