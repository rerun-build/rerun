import unittest

import cutshape
import test_dispatch

FORM = """PLAN READY (cut of #1; facts read on dev 4296d1f)

**Worker**: coder
**Test file**: `tools/factory/test_cutshape.py`

**Files** (allowed paths; nothing else)
- `tools/factory/cutshape.py`
- `tools/factory/test_cutshape.py`

**Change**
text

**Depends on**: none
"""


def issue(n, deps_line, extra=""):
    body = FORM.replace("**Depends on**: none", deps_line) + extra
    return {"number": n, "body": body}


class CutShape(unittest.TestCase):
    def test_the_narrower_worker_types_are_read_and_others_refused(self):
        body = test_dispatch.ready()
        for w in ("security", "data", "contracts"):
            p = cutshape.parse({"number": 5, "body": body.replace("**Worker**: coder", "**Worker**: " + w)})
            self.assertEqual(p["worker"], w)
            self.assertEqual([e for e in p["errors"] if e.startswith("worker:")], [])
        p = cutshape.parse({"number": 5, "body": body.replace("**Worker**: coder", "**Worker**: tester")})
        self.assertIn("worker: 'tester' is not one of coder, reviewer, researcher, designer, security, data, contracts", p["errors"])

    def test_number_on_the_next_line_is_unreadable(self):
        p = cutshape.parse(issue(5, "**Depends on**:\n#3"))
        self.assertEqual(p["deps"], [])
        self.assertTrue(any("dependency line" in e for e in p["errors"]))

    def test_this_issue_form_reads(self):
        p = cutshape.parse({"number": 206, "body": FORM})
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["worker"], "coder")
        self.assertEqual(p["paths"], ["tools/factory/cutshape.py", "tools/factory/test_cutshape.py"])
        self.assertEqual(p["test"], "tools/factory/test_cutshape.py")
        self.assertEqual(p["deps"], [])

    def test_plan_line_names_the_dev_commit(self):
        p = cutshape.parse({"number": 206, "body": FORM})
        self.assertEqual(p["dev"], "4296d1f")
        self.assertEqual(p["errors"], [])
        upper = FORM.replace("4296d1f", "A" * 40, 1)
        q = cutshape.parse({"number": 206, "body": upper})
        self.assertEqual(q["dev"], "a" * 40)
        self.assertEqual(q["errors"], [])

    def test_plan_line_without_a_dev_commit_is_refused(self):
        for first in ["PLAN READY", "PLAN READY dev 4296d1", "PLAN READY dev xyz1234", "PLAN READY dev " + "a" * 41, "PLAN READY device 4296d1f"]:
            body = FORM.replace(FORM.splitlines()[0], first, 1)
            p = cutshape.parse({"number": 206, "body": body})
            self.assertIsNone(p["dev"], first)
            self.assertTrue(any(e.startswith("plan line:") for e in p["errors"]), first)

    def test_a_body_without_a_plan_line_is_not_refused_for_it(self):
        body = FORM.replace(FORM.splitlines()[0], "SMALL FIX", 1)
        p = cutshape.parse({"number": 206, "body": body})
        self.assertIsNone(p["dev"])
        self.assertEqual(p["errors"], [])

    def test_cycle_is_named_on_both_issues(self):
        res = cutshape.check([
            issue(1, "**Depends on**: #2"),
            issue(2, "**Depends on**: #1"),
            issue(3, "**Depends on**: #99"),
        ])
        self.assertTrue(any(e.startswith("in a cycle: #1 -> #2 -> #1") for e in res[1]))
        self.assertTrue(any(e.startswith("in a cycle: #") and "#2" in e for e in res[2]))
        self.assertEqual(res[3], [])

    def test_deps_sorted_without_self(self):
        p = cutshape.parse(issue(4, "**Depends on**: #9, #4, #2"))
        self.assertEqual(p["deps"], [2, 9])

    def test_missing_or_double_dependency_line(self):
        self.assertTrue(cutshape.parse({"number": 1, "body": "**Worker**: coder"})["errors"])
        two = FORM + "**Depends on**: none\n"
        self.assertTrue(cutshape.parse({"number": 1, "body": two})["errors"])

    def test_bad_worker_and_paths(self):
        bad = FORM.replace("**Worker**: coder", "**Worker**: wizard")
        self.assertTrue(any("worker" in e.lower() for e in cutshape.parse({"number": 1, "body": bad})["errors"]))
        for path in ("/etc/x", "C:/x", "a/../b", "\\x"):
            b = FORM.replace("`tools/factory/cutshape.py`", "`%s`" % path)
            self.assertTrue(cutshape.parse({"number": 1, "body": b})["errors"], path)

    def test_a_files_bullet_may_carry_a_note_with_code_after_its_path(self):
        b = FORM.replace(
            "- `tools/factory/test_cutshape.py`\n",
            "- `tools/factory/test_cutshape.py`\n- `tools/factory/test_planning_cut.py` (:16 `BRIEF_SHA256` pins the brief's hash)\n",
        )
        p = cutshape.parse({"number": 1, "body": b})
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["paths"], ["tools/factory/cutshape.py", "tools/factory/test_cutshape.py", "tools/factory/test_planning_cut.py"])

    def test_a_test_file_line_may_carry_a_note_with_code_after_its_path(self):
        b = FORM.replace(
            "**Test file**: `tools/factory/test_cutshape.py`",
            "**Test file**: `tools/factory/test_cutshape.py` (existing tests, driven by the fake in `tools/factory/test_dispatch.py`)",
        )
        p = cutshape.parse({"number": 1, "body": b})
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["test"], "tools/factory/test_cutshape.py")

    def test_a_test_file_line_that_does_not_start_with_its_path_is_still_accepted(self):
        b = FORM.replace("**Test file**: `tools/factory/test_cutshape.py`", "**Test file**: see `tools/factory/test_cutshape.py`")
        p = cutshape.parse({"number": 1, "body": b})
        self.assertEqual(p["errors"], [])
        self.assertEqual(p["test"], "tools/factory/test_cutshape.py")

    def test_a_bullet_that_does_not_start_with_its_path_is_still_refused(self):
        b = FORM.replace("- `tools/factory/cutshape.py`\n", "- see `a.py` and `b.py`\n")
        self.assertTrue(any(e.startswith("files: bullet needs exactly one path") for e in cutshape.parse({"number": 1, "body": b})["errors"]))

    def test_test_file_must_be_listed(self):
        b = FORM.replace("**Test file**: `tools/factory/test_cutshape.py`", "**Test file**: `other.py`")
        self.assertTrue(cutshape.parse({"number": 1, "body": b})["errors"])

    def test_part_of_line_gives_the_parent(self):
        for line in ("**Part of**: #312", "**Part of:** #312"):
            p = cutshape.parse({"number": 9, "body": line + "\n" + FORM})
            self.assertEqual(p["parent"], 312)
            self.assertEqual(p["errors"], [])

    def test_no_part_of_line_gives_none_and_no_error(self):
        p = cutshape.parse({"number": 206, "body": FORM})
        self.assertIsNone(p["parent"])
        self.assertEqual(p["errors"], [])

    def test_two_part_of_lines_is_an_error(self):
        p = cutshape.parse({"number": 9, "body": "**Part of**: #1\n**Part of**: #2\n" + FORM})
        self.assertIsNone(p["parent"])
        self.assertTrue(any(e.startswith("part of line") for e in p["errors"]))

    def test_part_of_self_or_without_number_is_none(self):
        for line in ("**Part of**: #9", "**Part of**: nothing"):
            p = cutshape.parse({"number": 9, "body": line + "\n" + FORM})
            self.assertIsNone(p["parent"])
            self.assertEqual(p["errors"], [])

    def test_comment(self):
        c = cutshape.comment(["a", "b"])
        self.assertEqual(c.splitlines()[0], "The factory delegator cannot read this issue, so it is not started:")
        self.assertIn("- a\n- b", c)
        self.assertTrue(c.rstrip().endswith("the next beat reads it again."))
        self.assertNotIn("@", c)

    def test_cycles_ignore_outside_edges(self):
        a = cutshape.parse(issue(1, "**Depends on**: #99"))
        self.assertEqual(cutshape.cycles([a]), [])


if __name__ == "__main__":
    unittest.main()
