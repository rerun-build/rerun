import os, tempfile, unittest
import store


class Attempts(unittest.TestCase):
    def setUp(self):
        self.p = os.path.join(tempfile.mkdtemp(), "s.db")
        self.s = store.Store(self.p)

    def test_refires_and_bump_share_counter(self):
        self.assertEqual(self.s.refires("j", "A", "build"), 0)
        self.assertEqual(self.s.bump_attempt("j", "A"), 1)
        self.assertEqual(self.s.refires("j", "A", "build"), 1)
        self.s.intent("j", "A", "build")
        self.s.intent("j", "A", "build")
        self.assertEqual(self.s.refires("j", "A", "build"), 1)
        self.assertEqual(self.s.attempts("j", "A"), 1)
        self.assertEqual(self.s.ready_list("j"), [])

    def test_plain_stages_count_refires_per_stage(self):
        self.s.intent("j", "", "plan")
        self.s.intent("j", "", "plan")
        self.s.intent("j", "", "release")
        self.assertEqual(self.s.refires("j", "", "plan"), 1)
        self.assertEqual(self.s.refires("j", "", "release"), 0)

    def test_add_ready_after_fire_keeps_chunk_listed(self):
        self.s.intent("j", "A", "build")
        self.s.add_ready("j", "A", paths=["x"], builder="b", deps=["B"])
        r = self.s.ready_list("j")
        self.assertEqual([(c["chunk"], c["builder"], c["paths"], c["deps"]) for c in r], [("A", "b", ["x"], ["B"])])


if __name__ == "__main__":
    unittest.main()
