import json, os, re, sys, time, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import snapshot
import store as ledger_store
from test_dispatch import Base, ready, HEAD, wf
from test_dispatch_proof import ProofBase

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "dispatch.json")) as f:
    SHIPPED = json.load(f)
CONTRACT = os.path.join(HERE, "..", "..", "packages", "contracts", "src", "factory-snapshot.ts")
FINAL = "The factory could not resolve this. It is not sent again unless the issue text changes and the factory label is put back."


def senior_briefs(w):
    return [s for s in w.sends if "senior fix round" in s[1]]


def app_states():
    text = open(CONTRACT, encoding="utf8").read()
    return re.findall(r"'([a-z_]+)'", re.search(r"factoryJobStateSchema = z\.enum\(\[([\s\S]*?)\]\)", text).group(1))


class LadderBase(Base):
    def setUp(self):
        super().setUp()
        self.args = []
        real = self.w.account

        def spy(tool, args):
            if tool == "send_message":
                self.args.append(dict(args))
            return real(tool, args)

        self.w.account = spy

    def data(self, n=5):
        return json.loads(self.w.rows("SELECT data FROM jobs WHERE job=?", str(n))[0][0])

    def moves(self, n=5):
        return [r[0] for r in self.w.rows("SELECT to_state FROM transitions WHERE job=? ORDER BY id", str(n))]

    def no_refused_move(self):
        self.assertNotIn("refused move", self.out.getvalue())

    def two_rejects(self):
        self.to_review()
        self.w.finish("r1", "bad\nVERDICT: REJECT @abcdef1: wrong sum")
        self.tick(2)
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick(2)
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: still wrong")
        self.tick()


class Ladder(LadderBase):
    def test_a_second_review_reject_at_level_0_goes_to_a_senior_fix_round(self):
        self.two_rejects()
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual((self.data()["level"], self.data()["round"]), (1, 1))
        self.assertNotIn("rejected", self.moves())
        self.no_refused_move()

    def test_the_senior_fix_goes_to_the_same_builder_at_the_senior_model_and_names_both_findings(self):
        self.cfg["tiers"] = SHIPPED["tiers"]
        self.cfg["tier_models"] = SHIPPED["tier_models"]
        self.two_rejects()
        self.tick()
        self.assertEqual(self.state(), "fixing")
        self.assertEqual(self.w.sends[-1][0], "b1")
        self.assertEqual((self.args[-1]["model"], self.args[-1]["thinkingLevel"]), ("claude-opus-5-5", "high"))
        brief = self.w.sends[-1][1]
        for part in ("failed twice with another builder", "wrong sum", "still wrong", "Run lines", "in one change"):
            self.assertIn(part, brief)
        self.assertEqual(len(senior_briefs(self.w)), 1)
        self.no_refused_move()

    def test_a_level_1_job_rejected_again_ends_rejected(self):
        self.two_rejects()
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.w.finish("r1", "VERDICT: REJECT @abcdef1: wrong again")
        self.tick(2)
        self.assertEqual(self.state(), "rejected")
        self.assertEqual(len(senior_briefs(self.w)), 1)
        self.no_refused_move()

    def test_a_senior_job_that_merges_is_counted_in_the_digest(self):
        self.two_rejects()
        m = digest.measures(self.d.store, time.time())
        self.assertEqual((m["escalated"], m["escalatedMerged"]), (1, 0))
        self.tick()
        self.w.finish("b1", "PUSHED: 2345678")
        self.tick(2)
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick(3)
        self.assertEqual(self.state(), "merged")
        m = digest.measures(self.d.store, time.time())
        self.assertEqual((m["escalated"], m["escalatedMerged"]), (1, 1))


class ProofLadder(ProofBase):
    def test_a_second_failed_proof_at_level_0_goes_to_a_senior_fix_round(self):
        self.to_proving()
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4, 5")
        self.tick()
        self.tick()
        self.w.finish("b1", "PUSHED: fix")
        self.tick(2)
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.tick(2)
        self.tick()
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        data = json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])
        self.assertEqual((data["level"], data["round"]), (1, 1))
        self.tick()
        brief = senior_briefs(self.w)[-1][1]
        self.assertIn("proof failed: 4, 5", brief)
        self.assertIn("proof failed: 4\n", brief)
        self.assertNotIn("refused move", self.out.getvalue())


class Unsolvable(LadderBase):
    def capped(self, body=None, state="blocked"):
        self.w.issues.append({"number": 7, "title": "T7", "body": body or ready(), "comments": []})
        self.d = self.new()
        self.d.store.put_job("7", state, {"issue": 7, "title": "T7", "body": ready(), "relabelled": True, "commented": True,
                                          "take": 3, "reason": "VERDICT: REJECT @abc: wrong"})

    def test_the_take_limit_ends_unsolvable_with_one_verdict_and_the_unsolvable_label(self):
        self.capped()
        self.tick(3)
        self.assertEqual(self.state(7), "unsolvable")
        comments = self.w.issue(7)["comments"]
        self.assertEqual(len(comments), 1)
        self.assertIn(FINAL, comments[0])
        self.assertIn("3 takes", comments[0])
        self.assertNotIn("Rob decides", comments[0])
        self.assertNotIn("does not take this issue again", comments[0])
        edit = [c for c in self.w.edits(7) if "--add-label" in c][-1]
        self.assertEqual(edit[edit.index("--add-label") + 1], "factory-unsolvable")
        self.assertIn("factory-blocked", edit)
        self.no_refused_move()

    def test_an_unsolvable_job_with_the_same_text_is_not_taken_again(self):
        self.capped(state="unsolvable")
        self.tick(2)
        self.assertEqual(self.state(7), "unsolvable")
        self.assertEqual(self.w.issue(7)["comments"], [])

    def test_a_changed_issue_text_takes_an_unsolvable_job_again(self):
        self.capped(body=ready("new plan"), state="unsolvable")
        self.tick()
        self.assertNotEqual(self.state(7), "unsolvable")
        self.assertEqual(self.d.store.get_job("7")["takes"], 1)
        self.no_refused_move()

    def test_the_replan_limit_ends_unsolvable(self):
        self.cfg["types"] = {
            "coder": {"max_jobs": 8, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
            "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]},
            "planner": {"coworkers": [{"id": "p1", "name": "Boss", "runs": 1}]},
        }
        for _ in range(3):
            self.tick()
            self.w.finish("b1", "BLOCKED: plan: a file outside its paths")
            self.tick()
            self.w.unlabelled.clear()
        self.assertEqual(self.state(), "unsolvable")
        self.tick(2)
        self.assertEqual(len([s for s in self.w.sends if s[0] == "p1"]), 2)
        verdicts = [c for c in self.w.issue(5)["comments"] if FINAL in c]
        self.assertEqual(len(verdicts), 1)
        self.assertIn("2 re-plans", verdicts[0])
        self.assertIn("plan: a file outside its paths", verdicts[0])
        self.no_refused_move()

    def test_the_snapshot_maps_an_unsolvable_job_to_a_state_the_app_knows(self):
        self.capped()
        self.tick()
        snap = snapshot.build_snapshot(self.d.store, self.cfg, time.time(), None, beat=1)
        job = next(j for j in snap["jobs"] if j["issue"] == 7)
        known = app_states()
        self.assertIn(job["state"], known)
        self.assertTrue(all(h["state"] in known for h in job["history"]))
        self.assertEqual(snap["digest"]["measures"]["blocks"]["unsolvable"], 1)


class ResolverSpent(Base):
    def setUp(self):
        super().setUp()
        cw = lambda ids: [{"id": i, "name": i.upper(), "runs": 1} for i in ids]
        self.cfg["types"] = {"coder": {"max_jobs": 8, "coworkers": cw(["b1", "b2"])}, "reviewer": {"coworkers": cw(["r1", "r2"])},
                             "resolver": {"coworkers": [{"id": "h1", "name": "HOUSE", "runs": 2}]}}
        self.cfg["resolver"] = {"detect": True, "resolve": True}
        self.w.issues = [{"number": 8, "title": "T8", "body": ready(), "comments": []}]
        self.w.unlabelled.add(8)
        self.w.open_numbers.add(8)

    def test_a_job_whose_resolver_attempts_are_spent_ends_unsolvable(self):
        self.tick()
        self.d.store.put_job("8", "blocked", {"issue": 8, "title": "T8", "body": ready(), "relabelled": True, "commented": True,
                                              "reason": "cannot", "ended_at": ledger_store.now()})
        self.tick()
        self.w.finish("h1", "ESCALATE: Rob runs a step")
        self.tick(2)
        self.assertEqual(self.state(8), "unsolvable")
        verdicts = [c for c in self.w.issue(8)["comments"] if FINAL in c]
        self.assertEqual(len(verdicts), 1)
        self.assertNotIn("refused move", self.out.getvalue())


if __name__ == "__main__":
    unittest.main()
