import contextlib
import io
import os
import subprocess
import tempfile
import types
import unittest
from unittest import mock

import factory as F


class Install(unittest.TestCase):
    def install(self, *files, code=0, raises=None):
        ran, out = [], io.StringIO()

        def fake(cmd, cwd="/tmp", check=True, timeout=300):
            ran.append((cmd, cwd, check))
            if raises:
                raise raises
            return types.SimpleNamespace(returncode=code, stdout="", stderr="boom\nmore" if code else "")

        with tempfile.TemporaryDirectory() as d:
            for name in files:
                open(os.path.join(d, name), "w").close()
            with mock.patch.object(F, "run", fake), contextlib.redirect_stdout(out):
                F.install_deps(d)
            return [(c, w == d, k) for c, w, k in ran], out.getvalue().strip()

    def test_a_pnpm_project_installs_as_before(self):
        ran, said = self.install("pnpm-lock.yaml", "package-lock.json")
        self.assertEqual(ran, [(["pnpm", "install", "--frozen-lockfile", "--prefer-offline"], True, False)])
        self.assertRegex(said, r"^dependencies installed in \d+ s$")

    def test_npm_yarn_and_uv_projects_install_with_their_own_tool_from_the_lockfile(self):
        for name, cmd in (("package-lock.json", ["npm", "ci", "--prefer-offline"]), ("yarn.lock", ["yarn", "install", "--frozen-lockfile"]),
                          ("uv.lock", ["uv", "sync", "--frozen"])):
            ran, said = self.install(name)
            self.assertEqual(ran, [(cmd, True, False)])
            self.assertRegex(said, r"^dependencies installed in \d+ s$")

    def test_a_project_with_no_known_lockfile_says_so_in_one_line_and_runs_nothing(self):
        ran, said = self.install("README.md")
        self.assertEqual((ran, said), ([], "nothing installed here: none of pnpm-lock.yaml, package-lock.json, yarn.lock, uv.lock is here"))

    def test_a_rust_project_is_left_to_the_checks(self):
        ran, said = self.install("Cargo.lock")
        self.assertEqual((ran, said), ([], "nothing installed here: Cargo.lock is built by the checks only"))

    def test_a_failed_or_missing_tool_is_one_line_and_never_stops_the_worktree(self):
        self.assertEqual(self.install("package-lock.json", code=1)[1], "dependencies NOT installed: boom")
        self.assertEqual(self.install("yarn.lock", raises=FileNotFoundError("No such file: yarn"))[1], "dependencies NOT installed: No such file: yarn")
        self.assertEqual(self.install("uv.lock", raises=subprocess.TimeoutExpired("uv", 300))[1][:27], "dependencies NOT installed:")


if __name__ == "__main__":
    unittest.main()
