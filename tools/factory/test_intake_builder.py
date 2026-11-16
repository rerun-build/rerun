import os, tempfile, unittest

import intake
import roster
import store
from test_intake import OK1, OK2, plan
from test_intake_job import META

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "roster.json")) as f:
    RO = roster.load(f.read())

LARRY = OK2.replace("builder: code", "builder: larry")
WHY = LARRY + " | builder-why: needs cargo"
SPLIT = OK2.replace("paths: tools/factory/a.py, tools/factory/test_a.py", "paths: tools/factory/a.py, crates/x/src/lib.rs, tools/factory/test_a.py")


class IntakeBuilder(unittest.TestCase):
    def test_matching_builder_is_kept(self):
        chunks, errors = intake.parse_plan(plan(OK1, OK2), RO)
        self.assertEqual([c["id"] for c in chunks], ["A1", "A2"])
        self.assertEqual(errors, [])

    def test_other_builder_without_why_is_refused(self):
        chunks, errors = intake.parse_plan(plan(OK1, LARRY), RO)
        self.assertEqual([c["id"] for c in chunks], ["A1"])
        self.assertEqual(errors, ["A2: builder larry, the map gives code; use code or add builder-why"])

    def test_other_builder_with_why_is_kept(self):
        chunks, errors = intake.parse_plan(plan(OK1, WHY), RO)
        self.assertEqual([c["id"] for c in chunks], ["A1", "A2"])
        self.assertEqual(errors, [])

    def test_split_paths_refused_without_why(self):
        chunks, errors = intake.parse_plan(plan(OK1, SPLIT), RO)
        self.assertEqual([c["id"] for c in chunks], ["A1"])
        self.assertEqual(errors, ["A2: split the chunk: code: tools/factory/a.py; larry: crates/x/src/lib.rs; or add builder-why"])

    def test_no_roster_no_check(self):
        chunks, errors = intake.parse_plan(plan(OK1, LARRY))
        self.assertEqual([c["id"] for c in chunks], ["A1", "A2"])
        self.assertEqual(errors, [])

    def test_register_passes_the_roster(self):
        with tempfile.TemporaryDirectory() as d:
            st = store.Store(os.path.join(d, "s.db"))
            state, errors = intake.register(st, "71", META, plan(OK1, LARRY), RO)
            self.assertEqual(list(state["chunks"]), ["A1"])
            self.assertEqual(len(errors), 1)
            self.assertEqual([r["chunk"] for r in st.ready_list("71")], ["A1"])
            st.close()


if __name__ == "__main__":
    unittest.main()
