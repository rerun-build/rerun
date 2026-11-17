import json
import os
import unittest

import plancheck
import planning
from test_dispatch import Base, ready

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "plans")

BODY = """PLAN READY (cut of #594; facts read on dev at 591ca77)

**Part of**: #594
**Worker**: coder
**Test file**: `tools/factory/test_x.py`

**Files**
- `tools/factory/x.py`
- `tools/factory/test_x.py`

**Change**
- do it

**Done-test**
- passes

**Run**
```
cd tools/factory && python3 -I -m unittest discover -s . -p "test_x.py" -v
```

**Depends on**: none
"""

RUN_X = 'cd tools/factory && python3 -I -m unittest discover -s . -p "test_x.py" -v'
RUN_Y = 'cd tools/factory && python3 -I -m unittest discover -s . -p "test_y.py" -v'


def fixture(n):
    with open(os.path.join(FIXTURES, "%d.md" % n), encoding="utf-8") as f:
        return {"number": n, "body": f.read()}


def issue_with(body):
    return {"number": 1, "body": body}


def tree_of(*paths):
    return set(paths)


def replaced(body, old, new):
    assert body.count(old) == 1, old
    return body.replace(old, new)


class Parts(unittest.TestCase):
    def test_sections_and_run_block(self):
        sections, run = plancheck.parts(BODY)
        self.assertEqual(sections["files"], ["- `tools/factory/x.py`", "- `tools/factory/test_x.py`"])
        self.assertEqual(sections["change"], ["- do it"])
        self.assertEqual(run, [RUN_X])
        self.assertNotIn("run", sections)

    def test_run_lines_are_in_no_section(self):
        sections, run = plancheck.parts(BODY)
        self.assertFalse(any("unittest" in line for line in sections.get("done-test", [])))
        self.assertEqual(len(run), 1)


class Fixtures(unittest.TestCase):
    def test_536_is_caught_by_the_own_test_rule(self):
        issue = fixture(536)
        tree = tree_of(
            "apps/engine/src/db/schema.ts", "apps/engine/src/db/systemDb.ts", "apps/engine/src/runtime/loop.ts",
            "apps/engine/src/db/repos/telemetry.test.ts", "apps/engine/src/db/ladder.test.ts",
            "apps/engine/src/db/__snapshots__/ladder.test.ts.snap", "apps/engine/src/runtime/loop.paths.test.ts",
            "apps/engine/src/db/systemDb.test.ts", "apps/engine/src/db/repos/stats.test.ts")
        found = plancheck.faults(issue, tree, own_tests=True)
        self.assertEqual(len(found), 1)
        self.assertIn("systemDb.test.ts", found[0])
        self.assertEqual(plancheck.faults(issue, tree, own_tests=False), [])

    def test_575_is_caught_by_the_run_line_outside_the_block(self):
        issue = fixture(575)
        tree = tree_of("tools/factory/dispatch.py", "tools/factory/dispatch.json", "tools/factory/test_dispatch_filewait.py",
                       "tools/factory/test_dispatch.py", "tools/factory/test_dispatch_waits.py", "tools/factory/test_dispatch_types.py")
        found = plancheck.faults(issue, tree)
        self.assertEqual(len(found), 1)
        self.assertIn("test_dispatch_types.py", found[0])
        block = replaced(issue["body"], 'test_dispatch_waits.py" -v\n```',
                         'test_dispatch_waits.py" -v\ncd tools/factory && python3 -I -m unittest discover -s . -p "test_dispatch_types.py" -v\n```')
        self.assertEqual(plancheck.faults({"number": 1, "body": block}, tree), [])

    def test_581_and_590_pass_the_check(self):
        tree = tree_of("tools/factory/digest.py", "tools/factory/control-bounds.json", "tools/factory/test_digest_stations.py")
        for n in (581, 590):
            self.assertEqual(plancheck.faults(fixture(n), tree), [], n)
            self.assertEqual(plancheck.faults(fixture(n), tree, own_tests=True), [], n)


class Rules(unittest.TestCase):
    def test_change_subject_on_dev_or_called_new_must_be_in_files(self):
        body = BODY.replace("- do it", "- `tools/factory/other.py`: the helper\n- `tools/factory/fresh.py`: a new module")
        found = plancheck.faults(issue_with(body), tree_of("tools/factory/other.py"))
        self.assertEqual(found, ["change: tools/factory/other.py is on dev and is not in Files",
                                 "change: tools/factory/fresh.py is called new and is not in Files"])

    def test_a_path_named_later_in_a_bullet_is_no_fault(self):
        body = BODY.replace("- do it", "- `tools/factory/x.py`: the helper, read from `tools/factory/other.py` on dev")
        self.assertEqual(plancheck.faults(issue_with(body), tree_of("tools/factory/other.py")), [])

    def test_a_new_test_file_in_a_run_line_must_be_in_files(self):
        body = BODY.replace(RUN_X, RUN_Y)
        found = plancheck.faults(issue_with(body), tree_of("tools/factory/x.py"))
        self.assertEqual(found, ["run: test file tools/factory/test_y.py is not on dev and is not in Files"])

    def test_an_existing_test_file_only_run_is_no_fault(self):
        body = BODY.replace(RUN_X, RUN_Y)
        self.assertEqual(plancheck.faults(issue_with(body), tree_of("tools/factory/x.py", "tools/factory/test_y.py")), [])

    def test_a_done_test_subject_with_an_issue_number_is_no_fault(self):
        body = BODY.replace("- passes", "- `tools/factory/test_y.py` as #594 already has it")
        self.assertEqual(plancheck.faults(issue_with(body), tree_of("tools/factory/x.py")), [])

    def test_a_done_test_subject_not_in_files_is_a_fault(self):
        body = BODY.replace("- passes", "- `tools/factory/test_y.py` passes")
        found = plancheck.faults(issue_with(body), tree_of("tools/factory/x.py"))
        self.assertEqual(found, ["done-test: test file tools/factory/test_y.py is not on dev and is not in Files"])

    def test_missing_dependency(self):
        found = plancheck.faults(issue_with(BODY), None, missing=(9, 12))
        self.assertEqual(found, ["depends on: #9 does not exist", "depends on: #12 does not exist"])

    def test_without_a_tree_only_rules_3_and_4_speak(self):
        body = BODY.replace("- do it", "- `tools/factory/other.py` changes").replace(RUN_X, RUN_Y)
        self.assertEqual(plancheck.faults(issue_with(body), None), [])
        outside = replaced(BODY, "**Depends on**: none", "**Depends on**: none\n\nRun it: `%s`" % RUN_Y)
        self.assertEqual(plancheck.faults(issue_with(outside), None), [
            "run: this line is outside the Run block, so the factory does not run it: %s" % RUN_Y])

    def test_faults_are_listed_once(self):
        body = BODY.replace("- do it", "- `tools/factory/other.py` a\n- `tools/factory/other.py` b")
        found = plancheck.faults(issue_with(body), tree_of("tools/factory/other.py"))
        self.assertEqual(found, ["change: tools/factory/other.py is on dev and is not in Files"])

    def test_needs(self):
        self.assertFalse(plancheck.needs(issue_with(BODY)))
        self.assertTrue(plancheck.needs(issue_with(BODY.replace("- do it", "- `tools/factory/other.py` a"))))
        self.assertTrue(plancheck.needs(issue_with(BODY.replace(RUN_X, RUN_Y))))

    def test_tree_is_none_when_gh_raises(self):
        def gh(args):
            raise RuntimeError("boom")
        self.assertIsNone(plancheck.tree(gh, "o/r"))

    def test_tree_is_the_listed_paths(self):
        calls = []

        def gh(args):
            calls.append(args)
            return "a.py\nb/c.py\n"
        self.assertEqual(plancheck.tree(gh, "o/r"), {"a.py", "b/c.py"})
        self.assertIn("repos/o/r/git/trees/dev?recursive=1", calls[0])

    def test_comment(self):
        text = plancheck.comment(["one", "two"])
        self.assertEqual(text.split("\n"), [
            "The factory dispatcher does not take this issue: the plan check found faults.",
            "- one", "- two",
            "Fix the issue text; the label stays and the next beat reads it again."])


class Wiring(unittest.TestCase):
    def test_label_comments_the_faults_and_does_not_label(self):
        bad = BODY.replace(RUN_X, RUN_Y)
        issues = {601: {"number": 601, "title": "T", "body": bad, "labels": []},
                  602: {"number": 602, "title": "T", "body": BODY, "labels": []}}
        comments, adds = [], []

        def gh(args):
            if args[:2] == ["issue", "view"]:
                return json.dumps(issues[int(args[2])])
            if args[:2] == ["issue", "comment"]:
                comments.append((int(args[2]), args[args.index("--body") + 1]))
                return ""
            if args[:2] == ["issue", "edit"]:
                adds.append(int(args[2]))
                return ""
            if args[0] == "api" and "git/trees" in args[1]:
                return "tools/factory/x.py\ntools/factory/test_x.py\n"
            if args[0] == "api" and "/compare/" in args[1]:
                return json.dumps({"status": "ahead", "files": []})
            raise AssertionError(args)

        cfg = {"repo": "o/r", "planning": {"auto": True}}
        station = planning.Station(cfg, None, None, gh, lambda: 0.0)
        station.label([601, 602])
        self.assertEqual([n for n, _ in comments], [601])
        self.assertIn("test_y.py", comments[0][1])
        self.assertEqual(adds, [602])


class Intake(Base):
    def bad_body(self):
        return ready() + '\ncd tools/factory && python3 -I -m unittest discover -s . -p "test_x.py" -v\n'

    def plan_comments(self, n=5):
        return [c for c in self.w.issue(n)["comments"] if c.startswith("The factory dispatcher does not take this issue")]

    def test_a_hand_labelled_issue_with_a_fault_is_commented_once_and_not_taken(self):
        self.w.issues = [{"number": 5, "title": "Fix x", "body": self.bad_body(), "comments": []}]
        self.tick(2)
        self.assertEqual(len(self.plan_comments()), 1)
        self.assertNotIn("5", self.job_ids())

    def test_a_ready_issue_reads_no_tree(self):
        self.tick()
        self.assertFalse(any("git/trees" in " ".join(c) for c in self.w.gh_calls))
        self.assertIn("5", self.job_ids())

    def needs_dep_file(self):
        return BODY.replace('-p "test_x.py"', '-p "test_dep.py"')

    def with_tree(self, paths):
        real = plancheck.tree
        self.addCleanup(setattr, plancheck, "tree", real)
        self.tree = set(paths)
        plancheck.tree = lambda gh, repo: self.tree

    def test_a_refused_issue_is_taken_once_dev_has_the_file_it_named(self):
        self.with_tree(["tools/factory/x.py"])
        self.w.issues = [{"number": 5, "title": "Fix x", "body": self.needs_dep_file(), "comments": []}]
        self.tick(2)
        self.assertEqual(len(self.plan_comments()), 1)
        self.assertNotIn("5", self.job_ids())
        self.tree.add("tools/factory/test_dep.py")
        self.tick()
        self.assertIn("5", self.job_ids())
        self.assertEqual(len(self.plan_comments()), 1)

    def test_an_issue_that_waits_on_another_is_not_judged_before_that_one_is_done(self):
        self.with_tree(["tools/factory/x.py"])
        self.w.issues = [{"number": 5, "title": "Fix x", "body": self.needs_dep_file().replace("**Depends on**: none", "**Depends on**: #7"), "comments": []}]
        self.tick()
        self.assertEqual(self.plan_comments(), [])
        self.assertEqual(self.d.store.get_job("5")["state"], "waiting")

    def test_a_changed_text_is_checked_again(self):
        self.w.issues = [{"number": 5, "title": "Fix x", "body": self.bad_body(), "comments": []}]
        self.tick()
        self.assertEqual(len(self.plan_comments()), 1)
        self.w.issues[0]["body"] = ready()
        self.tick()
        self.assertIn("5", self.job_ids())
        self.assertEqual(len(self.plan_comments()), 1)


if __name__ == "__main__":
    unittest.main()
