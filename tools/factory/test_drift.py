import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drift

BODY = """PLAN READY (cut of #1; facts read on dev at 1234567)
**Files**
- `tools/factory/x.py`
- `tools/factory/test_x.py`
**Test file**: `tools/factory/test_x.py`
**Change**
- `send_review()` in tools/factory/x.py posts the note; tools/factory/dispatch.json keeps its tier
- call render_all(notes) once
**Done-test**
- `test_review_posts_once` asserts one comment
**Run**
```
cd tools/factory && python3 -I -m unittest tools/factory/test_x.py
```
"""


def compare(*files, count=None):
    return {"count": len(files) if count is None else count, "files": list(files)}


class Facts(unittest.TestCase):
    def test_names_come_from_change_test_through_and_done_test(self):
        found = drift.names(BODY)
        self.assertTrue({"send_review", "render_all", "test_review_posts_once"} <= found)
        self.assertNotIn("x.py", found)

    def test_fact_paths_take_files_test_and_paths_named_in_the_text(self):
        facts = drift.fact_paths(BODY, ["tools/factory/x.py"], "tools/factory/test_x.py")
        self.assertTrue({"tools/factory/x.py", "tools/factory/test_x.py", "tools/factory/dispatch.json"} <= facts)

    def test_the_query_is_valid_json_inside_jq(self):
        text = drift.query({"a/b.py"})
        self.assertTrue(text.startswith('{"a/b.py": true} as $want'))
        json.loads(text.split(" as $want")[0])


class Hits(unittest.TestCase):
    facts = {"tools/factory/x.py", "tools/factory/dispatch.json"}
    names = {"send_review"}

    def test_a_change_to_a_named_function_is_a_hit(self):
        got = drift.hits(compare({"filename": "tools/factory/x.py", "status": "modified",
                                  "patch": "@@ -1 +1 @@\n-def send_review():\n+def send_review(force):"}), self.facts, self.names)
        self.assertEqual(got, ["tools/factory/x.py changed on dev where it names send_review"])

    def test_a_change_elsewhere_in_a_fact_file_is_no_hit(self):
        got = drift.hits(compare({"filename": "tools/factory/x.py", "status": "modified", "patch": "@@\n+LIMIT = 3"}), self.facts, self.names)
        self.assertEqual(got, [])

    def test_a_file_outside_the_facts_is_no_hit(self):
        got = drift.hits(compare({"filename": "apps/ui/a.ts", "status": "removed", "patch": "-send_review"}), self.facts, self.names)
        self.assertEqual(got, [])

    def test_removed_renamed_and_unreadable_fact_files_are_hits(self):
        got = drift.hits(compare({"filename": "tools/factory/y.py", "previous_filename": "tools/factory/x.py", "status": "renamed"},
                                 {"filename": "tools/factory/dispatch.json", "status": "modified"}), self.facts, self.names)
        self.assertEqual(got, ["tools/factory/x.py was renamed on dev",
                               "tools/factory/dispatch.json changed on dev and its diff is too large to read"])

    def test_too_many_changed_files_is_one_hit(self):
        self.assertEqual(len(drift.hits(compare(count=drift.MAX_FILES), self.facts, self.names)), 1)


if __name__ == "__main__":
    unittest.main()
