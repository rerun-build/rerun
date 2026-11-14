import os
import subprocess
import tempfile
import unittest

import redgreen as RG

BODY = """PLAN READY

**Test file**: `apps/ui/components/factory/factory-tasks.test.tsx`

**Run**
```
cd packages/contracts && pnpm build
cd apps/ui && pnpm vitest run components/factory/factory-tasks.test.tsx
```
Run once on dev.
"""


def sh(root, *args):
    subprocess.run(list(args), cwd=root, check=True, capture_output=True)


class Parsing(unittest.TestCase):
    def test_issue_number_from_branch_then_body(self):
        self.assertEqual(RG.issue_number("chunk/427-main", ""), 427)
        self.assertEqual(RG.issue_number("fix/x", "Closes #12"), 12)
        self.assertIsNone(RG.issue_number("fix/x", "no link"))

    def test_run_lines_of_the_cut_format(self):
        self.assertEqual(RG.run_lines(BODY), ["cd packages/contracts && pnpm build",
                                              "cd apps/ui && pnpm vitest run components/factory/factory-tasks.test.tsx"])
        self.assertEqual(RG.run_lines("no run block"), [])

    def test_run_lines_of_a_body_with_windows_line_endings(self):
        self.assertEqual(len(RG.run_lines(BODY.replace("\n", "\r\n"))), 2)

    def test_exempt_only_with_the_marker(self):
        self.assertEqual(RG.exempt("**Red before green**: not applicable: a pure rename"), "a pure rename")
        self.assertIsNone(RG.exempt(BODY))

    def test_split_changes_keeps_test_files_out(self):
        restore, remove = RG.split_changes("M\tsrc/a.ts\nA\tsrc/new.ts\nM\tsrc/a.test.ts\nD\tsrc/old.ts\nA\ttools/factory/test_x.py\n")
        self.assertEqual(restore, ["src/a.ts", "src/old.ts"])
        self.assertEqual(remove, ["src/new.ts"])


class Prove(unittest.TestCase):
    def repo(self, head_files):
        root = tempfile.mkdtemp()
        sh(root, "git", "init", "-q")
        sh(root, "git", "config", "user.email", "t@t")
        sh(root, "git", "config", "user.name", "t")
        with open(os.path.join(root, "lib.txt"), "w") as f:
            f.write("old\n")
        sh(root, "git", "add", "-A")
        sh(root, "git", "commit", "-qm", "base")
        base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True).stdout.strip()
        for name, text in head_files.items():
            with open(os.path.join(root, name), "w") as f:
                f.write(text)
        sh(root, "git", "add", "-A")
        sh(root, "git", "commit", "-qm", "head")
        return root, base

    def test_red_on_base_green_at_head_is_proved_and_the_tree_is_restored(self):
        root, base = self.repo({"lib.txt": "new\n", "extra.txt": "x\n", "test_lib.py": "pass\n"})
        ok, why, _ = RG.prove(root, base, ["grep -q new lib.txt", "test -f extra.txt"])
        self.assertTrue(ok, why)
        self.assertIn("red on dev's code", why)
        with open(os.path.join(root, "lib.txt")) as f:
            self.assertEqual(f.read(), "new\n")
        self.assertTrue(os.path.exists(os.path.join(root, "extra.txt")))

    def test_a_done_test_that_passes_on_base_is_refused(self):
        root, base = self.repo({"lib.txt": "new\n", "test_lib.py": "pass\n"})
        ok, why, _ = RG.prove(root, base, ["true"])
        self.assertFalse(ok)
        self.assertIn("pass on dev's code too", why)

    def test_a_done_test_that_fails_at_head_is_refused(self):
        root, base = self.repo({"lib.txt": "new\n"})
        ok, why, _ = RG.prove(root, base, ["grep -q nothing lib.txt"])
        self.assertFalse(ok)
        self.assertIn("fail at the head", why)

    def test_a_pull_request_of_only_test_files_has_nothing_to_catch(self):
        root, base = self.repo({"test_lib.py": "pass\n"})
        ok, why, _ = RG.prove(root, base, ["true"])
        self.assertFalse(ok)
        self.assertIn("only test files", why)

    def test_prepare_runs_before_each_phase(self):
        root, base = self.repo({"lib.txt": "new\n", "test_lib.py": "pass\n"})
        ok, why, _ = RG.prove(root, base, ["test -f built.txt", "grep -q new lib.txt"], prepare=["touch built.txt"])
        self.assertTrue(ok, why)

    def test_lines_each_start_at_the_root(self):
        root, base = self.repo({"lib.txt": "new\n"})
        os.makedirs(os.path.join(root, "sub"))
        code, _ = RG.run(["cd sub", "grep -q new lib.txt"], root)
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
