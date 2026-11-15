import copy
import json
import os
import unittest

import roster

HERE = os.path.dirname(os.path.abspath(__file__))
TEXT = open(os.path.join(HERE, "roster.json")).read()

PR73 = [
    "apps/engine/Dockerfile", "apps/engine/docker-entrypoint.sh", "apps/engine/src/cli/bin.ts",
    "apps/engine/src/config/env.ts", "apps/engine/src/config/key-descriptor.test.ts",
    "apps/engine/src/config/key-intake.ts", "apps/engine/src/config/key-launcher.test.ts",
    "apps/engine/src/desktop/panels.test.ts", "apps/engine/src/desktop/panels.ts",
    "apps/engine/src/desktop/session.test.ts", "apps/engine/src/desktop/session.ts",
    "apps/engine/src/http/auth.desktop-token.test.ts", "apps/engine/src/http/auth.ts",
    "apps/engine/src/http/routes/update.test.ts", "apps/engine/src/http/routes/update.ts",
    "apps/engine/src/tools/builtin/browser.test.ts", "apps/engine/src/tools/builtin/browser.ts",
    "deploy/vps/dev-engine-status.sh",
]

NAMES = """advisor boss ike scope_shaper idea_partner ada devils_advocate code larry hopper martin house kent
codd dana changelog_writer margaret jez junio bill grace leslie brendan charity holmes search prior_art_scout
dieter linus bruce barbara fred botsitter warden box_janitor agent_smith plugin_scout issue_triage""".split()


def data():
    return json.loads(TEXT)


class TestRoster(unittest.TestCase):
    def setUp(self):
        self.r = roster.load(TEXT)

    def test_pr73_files_map_to_areas(self):
        got = set(roster.areas(self.r, PR73))
        self.assertEqual(got, {"tests", "engine-start", "auth-secrets", "default"})
        self.assertEqual(roster.required(self.r, PR73), {"MARGARET", "BRUCE", "LINUS"})
        self.assertEqual(roster.required(self.r, PR73, builder="margaret"), {"LINUS", "BRUCE"})

    def test_migration_path_builder_codd_reviewer_linus(self):
        p = ["db/migrations/001_init.sql"]
        self.assertEqual(roster.builder(self.r, p), "codd")
        self.assertEqual(roster.required(self.r, p, builder="codd"), {"LINUS"})
        self.assertEqual(roster.required(self.r, p), {"CODD"})

    def test_rust_path_builder_larry(self):
        p = ["crates/core/src/auth.rs"]
        self.assertEqual(roster.builder(self.r, p), "larry")
        self.assertEqual(roster.required(self.r, p, builder="larry"), {"LINUS", "BRUCE"})

    def test_unknown_path_defaults(self):
        p = ["apps/engine/src/tools/builtin/browser.ts"]
        self.assertEqual(roster.areas(self.r, p), {"default": p})
        self.assertEqual(roster.builder(self.r, p), "code")
        self.assertEqual(roster.required(self.r, p), {"LINUS"})

    def test_tests_and_docs_never_drop_a_sensitive_area(self):
        self.assertEqual(set(roster.areas(self.r, ["deploy/test/x.sh"])), {"tests", "engine-start"})
        self.assertIn("MARGARET", roster.required(self.r, ["deploy/test/x.sh"]))
        self.assertIn("BRUCE", roster.required(self.r, ["deploy/test/x.sh"]))
        self.assertEqual(set(roster.areas(self.r, ["docs/migration-plan.md"])), {"docs"})
        self.assertEqual(roster.required(self.r, ["src/auth.test.ts"]), {"LINUS", "BRUCE"})

    def test_tests_and_docs_only_builders(self):
        self.assertEqual(roster.builder(self.r, ["src/a.test.ts"]), "kent")
        self.assertEqual(roster.builder(self.r, ["docs/a.md"]), "dana")
        self.assertEqual(roster.builder(self.r, ["src/a.test.ts", "tools/factory/x.py"]), "code")

    def test_glob_rules(self):
        g = roster.glob_re
        self.assertTrue(g("**/Dockerfile*").fullmatch("Dockerfile"))
        self.assertTrue(g("**/Dockerfile*").fullmatch("a/b/dockerfile.dev"))
        self.assertFalse(g("*.md").fullmatch("a/b.md"))
        self.assertTrue(g("a/**").fullmatch("a/b/c"))
        self.assertTrue(g("a/?.x").fullmatch("a/b.x"))

    def test_missing_owner_or_builder_fails(self):
        d = data()
        d["areas"][0]["owner"] = "nobody"
        with self.assertRaises(ValueError):
            roster.load(json.dumps(d))
        d = data()
        d["areas"][0]["builder"] = "nobody"
        with self.assertRaises(ValueError):
            roster.load(json.dumps(d))
        d = data()
        d["areas"][0]["owner"] = "stack"
        with self.assertRaises(ValueError):
            roster.load(json.dumps(d))
        d = data()
        d["areas"][0]["builder"] = "linus"
        with self.assertRaises(ValueError):
            roster.load(json.dumps(d))
        d = data()
        del d["default"]["builder"]
        with self.assertRaises(ValueError):
            roster.load(json.dumps(d))

    def test_every_coworker_row_has_every_field(self):
        d = data()
        self.assertEqual(sorted(d["coworkers"]), sorted(NAMES))
        for h, row in d["coworkers"].items():
            self.assertEqual(sorted(row), ["class", "github", "wake"], h)
            self.assertTrue(row["wake"], h)
        d2 = copy.deepcopy(d)
        del d2["coworkers"]["ike"]["wake"]
        with self.assertRaises(ValueError):
            roster.load(json.dumps(d2))

    def test_mixed_builders_raise_split(self):
        with self.assertRaises(ValueError) as cm:
            roster.builder(self.r, ["db/migrations/001.sql", "crates/core/src/lib.rs"])
        self.assertIn("split the chunk", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
