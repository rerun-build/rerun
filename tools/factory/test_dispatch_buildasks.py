import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D

BODY = "\n".join([
    "**Change** (one bullet per ask)",
    "- Add the first thing.",
    "- Add the second thing.",
    "- Add the third thing.",
    "",
    "**Done-test**",
    "- `test_x`",
])


class BuildAsks(unittest.TestCase):
    def brief(self):
        return D.build_brief({"issue": 9, "title": "Fix y", "round": 1, "body": BODY})

    def test_the_build_brief_lists_every_ask_in_order(self):
        b = self.brief()
        self.assertIn("The asks of the Change, in order:", b)
        lines = [l for l in b.split("\n") if l.startswith("ASK ")]
        self.assertEqual(lines, ["ASK 1: Add the first thing.", "ASK 2: Add the second thing.", "ASK 3: Add the third thing."])

    def test_the_build_brief_asks_for_one_diff_line_per_ask_in_the_body(self):
        b = self.brief()
        self.assertIn("git diff origin/dev...HEAD", b)
        self.assertIn("ASK <n>: <file>:<line>", b)

    def test_an_ask_without_a_hunk_gets_an_ask_none_line(self):
        b = D.build_brief({"issue": 9, "title": "Fix y", "round": 1, "body": "\n".join([
            "**Change** (one bullet per ask)",
            "- Add no comments in code.",
            "- Add the first thing.",
        ])})
        self.assertIn(
            "A bullet with no hunk of its own (one that only forbids something, or states a fact about dev) "
            "gets the line `ASK <n>: none, <why>`; never point it at an unrelated line.",
            b,
        )
        self.assertNotIn("end with `BLOCKED: plan: ask <n>", b)


if __name__ == "__main__":
    unittest.main()
