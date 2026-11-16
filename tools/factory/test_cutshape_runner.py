import unittest

import cutshape
import planning

FORM = """PLAN READY (cut of #1; facts read on dev 4296d1f)

**Worker**: coder
**Test file**: `tools/factory/test_cutshape.py`

**Files** (allowed paths; nothing else)
- `tools/factory/cutshape.py`
- `tools/factory/test_cutshape.py`

**Change**
text

**Run**
```
%s
```

**Depends on**: none
"""

UVX_ERROR = "run line: uvx is not on the CI runner; ruff runs in the Factory tools CI job, take the line out"


def errors_for(run):
    return cutshape.check([{"number": 7, "body": FORM % run}])[7]


class RunnerLines(unittest.TestCase):
    def test_a_uvx_run_line_is_refused(self):
        run = "cd tools/factory && python3 -I -m unittest discover -s . -p \"test_x.py\" -v\nuvx ruff@0.17.5 check tools/factory"
        self.assertIn(UVX_ERROR, errors_for(run))

    def test_a_cd_then_uvx_run_line_is_refused(self):
        self.assertIn(UVX_ERROR, errors_for("cd tools/factory && uvx ruff check ."))

    def test_python_run_lines_pass(self):
        run = "\n".join([
            'cd tools/factory && python3 -I -m unittest discover -s . -p "test_cutshape_runner.py" -v',
            'cd tools/factory && python3 -I -m unittest discover -s . -p "test_*.py"',
        ])
        self.assertEqual([e for e in errors_for(run) if e.startswith("run line:")], [])

    def test_the_brief_says_the_runner_has_no_uvx(self):
        text = planning.brief({"number": 5, "title": "t"}, "o/rerun")
        self.assertIn("uvx", text)
        self.assertIn("Factory tools", text)


if __name__ == "__main__":
    unittest.main()
