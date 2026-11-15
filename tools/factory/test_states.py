import os, re, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import states

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

ALLOWED = (
    ("waiting", "queued"), ("waiting", "review_wait"), ("queued", "building"), ("building", "review_wait"),
    ("building", "queued"), ("review_wait", "reviewing"), ("review_wait", "fix_wait"), ("reviewing", "checks"),
    ("reviewing", "fix_wait"), ("reviewing", "review_wait"), ("fix_wait", "fixing"), ("fixing", "review_wait"),
    ("fixing", "fix_wait"), ("checks", "fix_wait"), ("checks", "proof_wait"), ("proof_wait", "proving"),
    ("proving", "checks"), ("proving", "fix_wait"), ("proving", "proof_wait"), ("checks", "merged"),
    ("building", "blocked"), ("queued", "failed"), ("blocked", "merged"), ("failed", "merged"),
    ("returned", "merged"), ("merged", "queued"), ("rejected", "waiting"),
)
REFUSED = (
    ("queued", "checks"), ("merged", "blocked"), ("queued", "nowhere"), ("nowhere", "queued"), ("merged", "merged"),
    ("rejected", "merged"), ("building", "checks"), ("waiting", "building"), ("fixing", "checks"), ("waiting", "proving"),
)


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf8") as f:
        return f.read()


class States(unittest.TestCase):
    def test_every_state_has_kind_deadline_and_handler(self):
        for name, row in states.TABLE.items():
            self.assertIn(row["kind"], states.KINDS, name)
            self.assertIn(row["deadline"], states.DEADLINES, name)
            if row["kind"] == "end":
                self.assertEqual(row["deadline"], "none", name)
                self.assertIsNone(row["handler"], name)
            else:
                self.assertIn(row["handler"], states.HANDLERS, name)

    def test_moves_and_running_rows_are_consistent(self):
        for name, row in states.TABLE.items():
            for n in row["next"]:
                self.assertIn(n, states.TABLE, name)
        for name in states.RUNNING:
            row = states.TABLE[name]
            self.assertEqual(states.TABLE[row["back"]]["kind"], "wait", name)
            self.assertIn(row["back"], row["next"], name)
            self.assertTrue(row["goal"], name)

    def test_states_with_no_clock_of_their_own(self):
        quiet = sorted(n for n, r in states.TABLE.items() if r["deadline"] == "reason_only")
        self.assertEqual(quiet, ["fix_wait", "proof_wait", "queued", "review_wait", "waiting"])

    def test_allowed_moves(self):
        self.assertEqual(len(ALLOWED), 27)
        self.assertEqual(len(REFUSED), 10)
        for old, new in ALLOWED:
            self.assertTrue(states.allowed(old, new), (old, new))
        for old, new in REFUSED:
            self.assertFalse(states.allowed(old, new), (old, new))

    def test_proof_states(self):
        names = list(states.NAMES)
        self.assertLess(names.index("checks"), names.index("proof_wait"))
        self.assertLess(names.index("proving"), names.index("merged"))
        self.assertEqual(states.TABLE["proof_wait"]["kind"], "wait")
        self.assertIn("proof_wait", states.QUEUE)
        self.assertEqual(states.TABLE["proving"]["kind"], "running")
        self.assertEqual(states.BACK["proving"], "proof_wait")
        self.assertEqual(states.GOALS["proving"], [{"prefix": "PROOF: ", "rest": "sentence"}])

    def test_names_follow_the_contract_schema(self):
        text = read("packages", "contracts", "src", "factory-snapshot.ts")
        block = re.search(r"factoryJobStateSchema = z\.enum\(\[([\s\S]*?)\]\)", text)
        self.assertIsNotNone(block)
        self.assertEqual(list(states.NAMES), re.findall(r"'([a-z_]+)'", block.group(1)))

    def test_every_state_has_a_screen_entry(self):
        text = read("apps", "ui", "components", "factory", "factory-state.ts")
        block = re.search(r"JOB_STATE_VIEW[^=]*=\s*\{([\s\S]*?)\n\}", text)
        self.assertIsNotNone(block)
        keys = re.findall(r"^    ([a-z_]+): \{", block.group(1), re.M)
        self.assertEqual(sorted(keys), sorted(states.NAMES))

    def test_derived_lists(self):
        self.assertEqual(states.RUNNING, ("building", "reviewing", "fixing", "proving"))
        self.assertEqual(states.END, ("merged", "rejected", "blocked", "failed", "returned"))
        self.assertEqual(states.PROBLEM, ("rejected", "blocked", "failed", "returned"))


if __name__ == "__main__":
    unittest.main()
