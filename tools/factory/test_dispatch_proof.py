import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T

HEAD = T.HEAD
BODY = "\n".join([
    "PLAN READY (facts read on dev 4296d1f)",
    "**Depends on**: none",
    "**Worker**: coder",
    "**Files**",
    "- `a/b.py`",
    "- `a/test_b.py`",
    "**Test file**: `a/test_b.py`",
    "**Change**",
    "- first ask",
    "- second ask",
    "**Done-test**",
    "- t",
    "**Run**",
    "```",
    "cd a && run1",
    "cd b && run2",
    "```",
])
MET = "\n".join("ASK %d: MET a/b.py:%d test_%d" % (n, n, n) for n in range(1, 6))


def met(missing=(), notmet=()):
    lines = []
    for n in range(1, 6):
        if n in missing:
            continue
        lines.append("ASK %d: NOT MET no test" % n if n in notmet else "ASK %d: MET a/b.py:%d test_%d" % (n, n, n))
    return "\n".join(lines)


class ProofBase(T.Base):
    def setUp(self):
        super().setUp()
        self.cfg["proof"] = True
        self.w.issues[0]["body"] = BODY
        self.w.workflows[HEAD] = [T.wf("ci", "success")]

    def to_proof_wait(self):
        self.to_checks()
        self.tick()

    def to_proving(self):
        self.to_proof_wait()
        self.tick()


class Proof(ProofBase):
    def reasons(self):
        return [r[0] for r in self.w.rows("SELECT reason FROM transitions WHERE job=5 ORDER BY id")]

    def test_green_checks_wait_for_a_prover_and_do_not_merge(self):
        self.to_proof_wait()
        self.assertEqual(self.state(), "proof_wait")
        self.assertEqual(self.w.merges, [])

    def test_the_prover_reads_the_pull_request_with_packet_and_takes_run_lines_from_ci(self):
        self.to_proving()
        _, msg, _ = self.w.sends[-1]
        self.assertIn("/data/tools/bin/packet rerun ", msg)
        self.assertIn("Done-test red before green", msg)
        self.assertIn("Red before green**: not applicable", msg)
        self.assertNotIn("only when you ran it", msg)
        self.assertIn("the Run lines pass at the head", msg)
        self.assertNotIn("that check ran nothing", msg)

    def test_prover_is_neither_builder_nor_reviewer_and_gets_the_asks(self):
        self.to_proving()
        self.assertEqual(self.state(), "proving")
        agent, msg, _ = self.w.sends[-1]
        self.assertEqual(agent, "r2")
        for want in ("ASK 1: first ask", "ASK 2: second ask", "ASK 3: Done-test", "ASK 4: cd a && run1", "ASK 5: cd b && run2",
                     "PROOF: PASS @<first 7 characters of the commit>"):
            self.assertIn(want, msg)
        self.assertNotIn("ASK 6", msg)
        data = json.loads(self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])
        self.assertEqual(data["prover"], "r2")

    def test_a_job_two_reviewers_judged_is_proved_by_neither_of_them(self):
        self.cfg["types"] = {"coder": {"coworkers": [{"id": "b1", "name": "B1"}]},
                             "reviewer": {"coworkers": [{"id": "r1", "name": "R1"}, {"id": "r2", "name": "R2"}]},
                             "acceptor": {"coworkers": [{"id": "a1", "name": "A1"}]}}
        d = self.d = self.new()
        j = {"builder": "b1", "reviewer": "r2", "first_accept": {"head": HEAD, "by": "r1"}}
        self.assertEqual(d.free_prover(j)[0], "a1")
        self.assertEqual(d.free_prover({**j, "first_accept": None})[0], "r1")
        del d.cfg["types"]["acceptor"]
        self.assertIsNone(d.free_prover(j))

    def test_without_a_free_prover_the_job_keeps_waiting(self):
        self.cfg["reviewers"] = [{"id": "r1", "name": "R1"}]
        self.to_proof_wait()
        sent = len(self.w.sends)
        self.tick(3)
        self.assertEqual(self.state(), "proof_wait")
        self.assertEqual(len(self.w.sends), sent)

    def test_pass_with_every_ask_met_goes_back_to_checks_and_merges(self):
        self.to_proving()
        self.w.finish("r2", MET + "\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")
        self.tick()
        self.assertEqual(self.state(), "merged")
        self.assertEqual(len(self.w.merges), 1)

    def test_pass_naming_four_of_five_asks_is_asked_again_not_sent_to_a_fix(self):
        self.to_proving()
        self.w.finish("r2", met(missing=(5,)) + "\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "proof_wait")
        self.assertIn("proof lines name 4 of the 5 asks: asked again", self.reasons())

    def test_the_brief_says_the_lines_go_into_the_answer_the_dispatcher_reads(self):
        self.to_proving()
        _, msg, _ = self.w.sends[-1]
        self.assertIn("write the same lines in your answer", msg)
        self.assertIn("the dispatcher reads your answer, not the pull request", msg)

    def test_a_proof_asked_again_is_told_why_its_answer_could_not_be_read(self):
        self.to_proving()
        self.w.finish("r2", "All 5 asks are MET, I posted the lines on the pull request.\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "proof_wait")
        self.tick()
        self.assertEqual(self.state(), "proving")
        _, msg, _ = self.w.sends[-1]
        self.assertIn("Your last answer could not be read: proof lines name 0 of the 5 asks.", msg)

    def test_the_reason_of_an_unread_answer_is_not_repeated_for_a_later_commit(self):
        job = {"issue": 5, "title": "t", "proof_why": "proof lines name 0 of the 5 asks", "proof_why_head": "abcdef1234"}
        self.assertIn("Your last answer could not be read", T.D.proof_brief(job, 9, "abcdef1234", ["x"]))
        self.assertNotIn("Your last answer could not be read", T.D.proof_brief(job, 9, "1234567890", ["x"]))

    def test_lines_posted_on_the_pull_request_count_when_the_answer_has_only_the_last_line(self):
        self.to_proving()
        self.w.pr_comments = ["Review ACCEPT @abcdef12: BRUCE ACCEPT @abcdef12: " + MET]
        self.w.finish("r2", "All 5 asks are MET, I posted the lines on the pull request.\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "checks")

    def test_posted_lines_of_another_commit_do_not_count(self):
        self.to_proving()
        self.w.pr_comments = ["Review ACCEPT @1234567a: BRUCE ACCEPT @1234567a: " + MET]
        self.w.finish("r2", "I posted the lines.\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "proof_wait")

    def test_a_posted_ask_not_met_under_a_pass_line_goes_to_a_fix(self):
        self.to_proving()
        self.w.pr_comments = ["Review ACCEPT @abcdef12: BRUCE ACCEPT @abcdef12: " + met(notmet=(5,))]
        self.w.finish("r2", "I posted the lines.\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")

    def test_pass_with_an_ask_not_met_goes_to_fix(self):
        self.to_proving()
        self.w.finish("r2", met(notmet=(5,)) + "\nPROOF: PASS @abcdef1")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.assertIn("PASS with asks not met: 5", self.w.rows("SELECT data FROM jobs WHERE job='5'")[0][0])

    def test_a_second_failed_proof_goes_to_the_senior_round(self):
        self.to_proving()
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4, 5")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.tick()
        self.w.finish("b1", "PUSHED: fix")
        self.tick(2)
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @abcdef1")
        self.tick(2)
        self.assertEqual(self.state(), "proof_wait")
        self.tick()
        self.w.finish("r2", "PROOF: FAIL @abcdef1: 4")
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual(self.w.merges, [])

    def test_a_proof_naming_another_commit_is_asked_again_then_blocks(self):
        self.to_proving()
        self.w.finish("r2", MET + "\nPROOF: PASS @1234567")
        self.tick()
        self.assertEqual(self.state(), "proof_wait")
        self.assertIn("proof names 1234567, the head is abcdef1: asked again", self.reasons())
        self.tick()
        self.w.finish("r2", MET + "\nPROOF: PASS @1234567")
        self.tick()
        self.assertEqual(self.state(), "blocked")
        self.assertIn("blocked: proof names 1234567, the head is abcdef1: asked again", self.reasons())
        self.assertEqual(self.w.merges, [])

    def test_a_proof_naming_no_commit_is_asked_again(self):
        self.to_proving()
        self.w.finish("r2", MET + "\nPROOF: PASS")
        self.tick()
        self.assertEqual(self.state(), "proof_wait")
        self.assertIn("proof names no commit, the head is abcdef1: asked again", self.reasons())

    def test_a_proof_with_at_merges_after_the_second_ask(self):
        self.to_proving()
        self.w.finish("r2", MET + "\nPROOF: PASS @1234567")
        self.tick(2)
        self.w.finish("r2", MET + "\nPROOF: PASS at abcdef1")
        self.tick(2)
        self.assertEqual(self.state(), "merged")
        self.assertEqual(len(self.w.merges), 1)

    def test_an_output_without_a_proof_line_is_asked_again(self):
        self.to_proving()
        self.w.finish("r2", "done, looks fine")
        self.tick()
        self.assertEqual(self.state(), "proof_wait")
        self.assertIn("no PROOF line: asked again", self.reasons())


class Deployed(unittest.TestCase):
    def test_dispatch_json_turns_the_step_on(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch.json")) as f:
            self.assertIs(json.load(f).get("proof"), True)


class ProofOff(T.Base):
    def test_without_the_key_green_checks_still_merge(self):
        self.w.workflows[HEAD] = [T.wf("ci", "success")]
        self.to_checks()
        self.tick()
        self.assertEqual(self.state(), "merged")
        self.assertEqual(len(self.w.merges), 1)


if __name__ == "__main__":
    unittest.main()
