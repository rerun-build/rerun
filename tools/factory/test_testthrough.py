import unittest

import cutshape
import planning
import proof

BASE = """PLAN READY (cut of #1; facts read on dev 4296d1f)

**Worker**: coder
**Test file**: `tools/factory/test_testthrough.py`
%s
**Files** (allowed paths; nothing else)
- `tools/factory/cutshape.py`
- `tools/factory/test_testthrough.py`

**Change**
- first ask

**Done-test**
- one

**Run**
```
cd tools/factory && run1
```

**Depends on**: none
"""

LINE = "**Test through**: `cutshape.parse`, called as it is\n"


def body(line):
    return BASE % line


def issue(line):
    return {"number": 7, "body": body(line)}


class TestThrough(unittest.TestCase):
    def test_read(self):
        p = cutshape.parse(issue(LINE))
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["through"], "`cutshape.parse`, called as it is")

    def test_old_issue(self):
        p = cutshape.parse(issue(""))
        self.assertEqual(p["errors"], [])
        self.assertIsNone(p["through"])

    def test_twice_and_empty(self):
        twice = cutshape.parse(issue(LINE + LINE))
        self.assertTrue(any("more than one Test through line" in e for e in twice["errors"]))
        empty = cutshape.parse(issue("**Test through**:\n"))
        self.assertTrue(any("names no interface" in e for e in empty["errors"]))

    def test_planner_text(self):
        text = planning.brief({"number": 7, "title": "t"}, "special-place-ai-heaven/rerun")
        self.assertIn("**Test through**", text)
        self.assertIn("mock nothing of the module's own internals", text)

    def test_proof_ask(self):
        got = proof.asks(body(LINE))
        want = "Test through: the done-test calls only `cutshape.parse`, called as it is and mocks none of the module's own internals"
        self.assertEqual(got[-1], want)
        plain = proof.asks(body(""))
        self.assertFalse(any(a.startswith("Test through") for a in plain))


if __name__ == "__main__":
    unittest.main()
