import unittest

import cutshape


def body(run, files=("tools/factory/x.py", "tools/factory/test_x.py"), extra=""):
    bullets = "\n".join("- `%s`" % f for f in files)
    return ("PLAN READY (cut of #1; facts read on dev 1234567)\n**Depends on**: none\n**Worker**: coder\n"
            "**Files**\n%s\n**Test file**: `%s`\n%s\n**Run**\n```\n%s\n```\n" % (bullets, files[-1], extra, run))


def errors(run, **kw):
    return cutshape.parse({"number": 9, "body": body(run, **kw)})["errors"]


class RunFaults(unittest.TestCase):
    def test_a_plain_run_line_passes(self):
        self.assertEqual(errors("cd tools/factory && python3 -I -m unittest test_x"), [])

    def test_a_line_in_parentheses_is_refused(self):
        self.assertIn("arithmetic", " ".join(errors("(cd tools/factory && python3 -I -m unittest test_x)")))

    def test_discover_with_a_path_pattern_is_refused_but_mkdir_p_is_not(self):
        self.assertIn("exits 5", " ".join(errors('python3 -I -m unittest discover -s . -p "tools/factory/test_*.py"')))
        self.assertEqual(errors("mkdir -p tools/out/ && python3 -I -m unittest discover -s tools/factory -p 'test_x.py'"), [])

    def test_a_server_path_command_is_refused_but_a_grep_for_it_is_not(self):
        self.assertIn("factory server", " ".join(errors("/data/tools/bin/uvx ruff check tools/factory")))
        self.assertEqual(errors('grep -q "/data/tools" tools/factory/install.sh'), [])

    def test_pytest_is_refused(self):
        self.assertIn("no pytest", " ".join(errors("python3 -m pytest tools/factory/test_x.py")))

    def test_the_same_folder_twice_is_refused(self):
        line = "cd tools/factory && python3 -I -m unittest test_x && cd tools/factory && python3 -I -m unittest test_y"
        self.assertIn("same folder twice", " ".join(errors(line)))
        self.assertEqual(errors("cd apps/ui && pnpm vitest run x && cd ../.. && git status"), [])


class TestOnly(unittest.TestCase):
    def test_only_test_files_without_the_line_is_refused(self):
        found = errors("true", files=("tools/factory/test_a.py", "tools/factory/test_x.py"))
        self.assertIn(cutshape.TEST_ONLY_ERROR, found)

    def test_only_test_files_with_the_line_passes(self):
        found = errors("true", files=("tools/factory/test_a.py", "tools/factory/test_x.py"),
                       extra="**Red before green**: not applicable: the test only pins today's behaviour")
        self.assertNotIn(cutshape.TEST_ONLY_ERROR, found)

    def test_the_gate_reads_the_same_pattern(self):
        import gate
        self.assertIs(gate.TESTF, cutshape.TESTF)


if __name__ == "__main__":
    unittest.main()
