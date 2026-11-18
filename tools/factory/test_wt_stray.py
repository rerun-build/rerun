import os, unittest

import test_factory as T

F = T.F


class Stray(T.FactoryCase):
    def strays(self):
        wt = self.wt(chunk="1")
        a = os.path.join(F.WT, "rerun", "pr-289.md")
        b = os.path.join(F.WT, "notes.txt")
        for p in (a, b):
            with open(p, "w") as f:
                f.write("x\n")
        return wt, a, b

    def test_a_file_in_the_worktree_root_is_passed_over_and_listed(self):
        wt, a, b = self.strays()
        self.assertEqual(F.wt_dirs(), [("rerun", "7-1", wt)])
        self.assertEqual(F.wt_strays(), sorted([a, b]))

    def test_wt_list_and_wt_new_run_with_a_stray_file_and_list_names_it(self):
        wt, a, b = self.strays()
        with T.clone_fakes(self):
            code, out = self.call(F.cmd_wt, ["list"])
            self.assertEqual(code, 0, out)
            self.assertIn("stray, not a worktree: " + a, out.splitlines())
            code, out = self.call(F.cmd_wt, ["new", "rerun", "7", "2"])
            self.assertEqual(code, 0, out)
            self.assertTrue(os.path.isdir(os.path.join(F.WT, "rerun", "7-2")))


if __name__ == "__main__":
    unittest.main()
