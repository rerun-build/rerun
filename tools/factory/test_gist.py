import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gist import gist


class Gist(unittest.TestCase):
    def test_a_text_within_the_limit_is_kept_whole(self):
        self.assertEqual(gist("short", 200), "short")
        self.assertEqual(gist(None, 200), "")

    def test_a_long_text_keeps_its_start_and_its_end_within_the_limit(self):
        text = "BLOCKED: the build cannot go on " + "x " * 400 + "because test_propen_preflight.py is not in Files"
        got = gist(text, 200)
        self.assertLessEqual(len(got), 200)
        self.assertTrue(got.startswith("BLOCKED: the build cannot go on"))
        self.assertTrue(got.endswith("because test_propen_preflight.py is not in Files"))
        self.assertIn(" ... ", got)


if __name__ == "__main__":
    unittest.main()
