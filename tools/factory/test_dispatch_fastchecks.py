import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_dispatch import Base, HEAD, PR_LINE

HERE = os.path.dirname(os.path.abspath(__file__))
FAST_NAMES = ("Typecheck and lint", "No comments in code", "Factory tools tests")


def run(name, status="completed", conclusion="success"):
    return {"name": name, "status": status, "conclusion": conclusion}


def green():
    return [run(n) for n in FAST_NAMES]


def fix_sends(w):
    return [s for s in w.sends if "One fix round" in s[1]]


class FastChecks(Base):
    def setUp(self):
        super().setUp()
        with open(os.path.join(HERE, "dispatch.json"), encoding="utf-8") as f:
            self.cfg["fast_checks"] = json.load(f)["fast_checks"]
        self.w.check_runs = green()

    def to_review_wait(self):
        self.tick()
        self.w.finish("b1", PR_LINE)
        self.tick()
        self.assertEqual(self.state(), "review_wait")

    def fix_push(self):
        self.tick()
        self.w.finish("b1", "PUSHED: 1234567")
        self.tick()

    def reviewer_sends(self):
        return [s for s in self.w.sends if s[0] in ("r1", "r2")]

    def test_red_fast_check_goes_to_builder_without_review(self):
        self.to_review_wait()
        self.w.check_runs = [run("No comments in code", conclusion="failure")] + green()[1:]
        self.tick()
        j = self.d.store.get_job("5")
        self.assertEqual(self.state(), "fix_wait")
        self.assertEqual(j["round"], 1)
        self.assertEqual(self.reviewer_sends(), [])
        self.assertIn("No comments in code", j["review"])
        self.tick()
        self.assertEqual(self.state(), "fixing")
        self.assertIn("No comments in code", fix_sends(self.w)[-1][1])

    def test_pending_typecheck_waits_then_reviews_when_green(self):
        self.to_review_wait()
        self.w.check_runs = [run("Typecheck and lint", status="in_progress", conclusion=None)] + green()[1:]
        self.tick()
        self.w.clock += 60
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertEqual(self.reviewer_sends(), [])
        self.w.check_runs = green()
        self.tick()
        self.assertEqual(self.state(), "reviewing")

    def test_no_fast_check_yet_waits_start_s_then_reviews(self):
        self.to_review_wait()
        self.w.check_runs = []
        self.tick()
        self.w.clock += 60
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.w.clock += 70
        self.tick()
        self.assertEqual(self.state(), "reviewing")

    def test_pending_past_wait_s_reviews_anyway(self):
        self.to_review_wait()
        self.w.check_runs = [run("Factory tools tests", status="queued", conclusion=None)] + green()[:2]
        self.tick()
        self.w.clock += 901
        self.tick()
        self.assertEqual(self.state(), "reviewing")
        self.assertIn("fast checks not done", self.out.getvalue())

    def test_second_red_after_two_fixes_ends_failed(self):
        self.to_review_wait()
        self.w.check_runs = [run("No comments in code", conclusion="failure")] + green()[1:]
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.fix_push()
        self.tick()
        self.assertEqual(self.state(), "fix_wait")
        self.fix_push()
        self.tick()
        self.assertEqual(self.state(), "failed")
        self.assertEqual(self.reviewer_sends(), [])

    def test_no_fast_checks_setting_reviews_at_once(self):
        del self.cfg["fast_checks"]
        self.to_review_wait()
        self.w.check_runs = [run("No comments in code", conclusion="failure")]
        self.tick()
        self.assertEqual(self.state(), "reviewing")


if __name__ == "__main__":
    unittest.main()
