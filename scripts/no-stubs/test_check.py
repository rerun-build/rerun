import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check

DIFF = """diff --git a/a.py b/a.py
--- a/a.py
+++ b/a.py
@@ -1,2 +1,4 @@
 def f():
+    raise NotImplementedError
+    return 1
-    old = 1
diff --git a/b.test.ts b/b.test.ts
--- a/b.test.ts
+++ b/b.test.ts
@@ -3 +3,2 @@
+it.only('runs alone', () => {})
+describe.skip('off', () => {})
diff --git a/c.rs b/c.rs
--- a/c.rs
+++ b/c.rs
@@ -1 +1 @@
+fn g() -> u8 { todo!() }
"""


class Check(unittest.TestCase):
    def test_finds_stubs_and_switched_off_tests_on_added_lines_only(self):
        got = [(h["path"], h["kind"]) for h in check.find(DIFF)]
        self.assertEqual(got, [("a.py", "stub"), ("b.test.ts", "focused test"), ("b.test.ts", "skipped test"), ("c.rs", "stub")])

    def test_a_removed_stub_is_not_flagged(self):
        diff = "+++ b/a.py\n-    raise NotImplementedError\n"
        self.assertEqual(check.find(diff), [])

    def test_conditional_and_runtime_skips_are_allowed(self):
        diff = ("+++ b/t.py\n+    @unittest.skipIf(sys.platform == 'win32', 'posix only')\n"
                "+        self.skipTest('no sh')\n+    @pytest.mark.skipif(not HAVE_X, reason='x')\n"
                "+++ b/t.test.ts\n+it.skipIf(isWindows)('posix', () => {})\n")
        self.assertEqual(check.find(diff), [])

    def test_unconditional_python_skips_are_flagged(self):
        diff = "+++ b/t.py\n+@unittest.skip('later')\n+@pytest.mark.skip(reason='later')\n+xit('x', () => {})\n"
        self.assertEqual([h["kind"] for h in check.find(diff)], ["skipped test"] * 3)

    def test_the_check_and_its_own_tests_are_left_out(self):
        diff = "+++ b/scripts/no-stubs/test_check.py\n+raise NotImplementedError\n"
        self.assertEqual(check.find(diff), [])

    def test_each_hit_names_its_line_number_in_the_new_file(self):
        self.assertEqual(check.find(DIFF)[0]["line"], 2)
    def test_catches_vitest_it_todo(self):
        diff = "+++ b/t.test.ts\n+  it.todo('later')\n+  test.todo('tomorrow')\n+  describe.todo('suite')\n"
        hits = check.find(diff)
        self.assertEqual(len(hits), 3)
        self.assertTrue(all(h["kind"] == "skipped test" for h in hits))



if __name__ == "__main__":
    unittest.main()
