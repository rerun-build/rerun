import unittest

import planning

SENTENCE = "The first job of a feature crosses every layer"


class FirstSlice(unittest.TestCase):
    def text(self):
        return planning.brief({"number": 9, "title": "t"}, "o/rerun")

    def test_rule(self):
        self.assertIn(SENTENCE, self.text())

    def test_order(self):
        text = self.text()
        self.assertIn(SENTENCE, text)
        self.assertLess(text.index(SENTENCE), text.index("Do not label a child"))


if __name__ == "__main__":
    unittest.main()
