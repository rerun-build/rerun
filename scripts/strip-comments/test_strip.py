import contextlib
import io
import os
import subprocess
import tempfile
import unittest

import strip

TS_MODULE = os.environ.get("TS_MODULE")


def repo(files):
    root = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    for name, text in files.items():
        path = os.path.join(root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    return root


def check(root, *extra):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = strip.main(["--root", root, "--check"] + list(extra))
    return code, out.getvalue()


class Check(unittest.TestCase):
    def test_a_python_comment_fails_and_names_the_file(self):
        root = repo({"tools/a.py": "x = 1  # why\n", "tools/b.py": "y = 2\n"})
        code, out = check(root)
        self.assertEqual(code, 1)
        self.assertIn("tools/a.py", out)
        self.assertNotIn("tools/b.py", out)

    def test_a_docstring_counts_as_a_comment(self):
        code, _ = check(repo({"a.py": 'def f():\n    """Explain."""\n    return 1\n'}))
        self.assertEqual(code, 1)

    def test_directives_and_shebang_pass(self):
        code, out = check(repo({"a.py": "import os  # noqa\n", "b.sh": "#!/bin/sh\n# shellcheck disable=SC2086\necho $x\n"}))
        self.assertEqual(code, 0, out)

    def test_only_limits_the_check_to_the_named_files(self):
        root = repo({"old.py": "x = 1  # old\n", "new.py": "y = 2\n"})
        self.assertEqual(check(root, "--only", "new.py")[0], 0)

    @unittest.skipUnless(TS_MODULE, "TS_MODULE names a folder with typescript installed")
    def test_typescript_comment_fails_and_a_lint_directive_passes(self):
        root = repo({"a.ts": "export const a = 1\n// why\n", "b.tsx": "export const B = () => (\n    <div>\n        {/* eslint-disable-next-line x */}\n        <a href=\"/\">x</a>\n    </div>\n)\n"})
        code, out = check(root, "--ts-module", TS_MODULE)
        self.assertEqual(code, 1)
        self.assertIn("a.ts", out)
        self.assertNotIn("b.tsx", out)

    @unittest.skipUnless(TS_MODULE, "TS_MODULE names a folder with typescript installed")
    def test_a_comment_at_the_end_of_a_code_line_fails_and_is_cut_but_jsx_text_stays(self):
        root = repo({"a.ts": "export type P = {\n    level: number // why\n    band: string\n}\nexport const V = 1 // why\n",
                     "b.tsx": "export const B = () => <p>// shown text</p>\n"})
        code, out = check(root, "--ts-module", TS_MODULE)
        self.assertEqual(code, 1)
        self.assertIn("a.ts", out)
        self.assertNotIn("b.tsx", out)
        with contextlib.redirect_stdout(io.StringIO()):
            strip.main(["--root", root, "--write", "--ts-module", TS_MODULE])
        with open(os.path.join(root, "a.ts"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "export type P = {\n    level: number\n    band: string\n}\nexport const V = 1\n")
        with open(os.path.join(root, "b.tsx"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "export const B = () => <p>// shown text</p>\n")


if __name__ == "__main__":
    unittest.main()
