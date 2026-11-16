import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, HEAD, wf

MOVED = "9999999999999999"


class HeadMoved(Base):
    def new(self):
        def gh(args):
            a = list(args)
            if a[:2] == ["pr", "view"] and "headRefOid" in a[-1] and getattr(self, "head", None):
                self.w.gh_calls.append(a)
                return json.dumps({"headRefOid": self.head})
            return self.w.gh(args)
        return D.Dispatcher(self.cfg, self.w.account, gh, now=lambda: self.w.clock)

    def test_a_head_that_moved_after_the_review_goes_back_to_review_and_is_not_merged(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.head = MOVED
        self.tick()
        self.assertEqual(self.state(), "review_wait")
        self.assertEqual(self.w.merges, [])
        self.assertIn("head moved from abcdef1 to 9999999", self.out.getvalue())
        self.tick()
        self.assertEqual(self.state(), "reviewing")
        self.assertEqual(self.d.store.get_job("5")["head"], MOVED)
        self.assertIn(MOVED[:7], self.w.sends[-1][1])

    def test_the_moved_head_is_reviewed_again_and_merged_at_its_own_commit(self):
        self.to_checks()
        self.head = MOVED
        self.tick(2)
        self.w.finish("r1", "ok\nVERDICT: ACCEPT @%s" % MOVED[:7])
        self.tick()
        self.assertEqual(self.state(), "checks")
        self.w.workflows[MOVED] = [wf("ci", "success")]
        self.tick()
        self.assertEqual(self.state(), "merged")
        self.assertIn(MOVED, self.w.merges[-1])

    def test_a_head_that_did_not_move_still_merges(self):
        self.to_checks()
        self.w.workflows[HEAD] = [wf("ci", "success")]
        self.tick()
        self.assertEqual(self.state(), "merged")

    def test_a_head_that_moved_does_not_use_the_fix_round_or_the_update(self):
        self.to_checks()
        self.head = MOVED
        self.tick()
        j = self.d.store.get_job("5")
        self.assertEqual(j["round"], 1)
        self.assertFalse(j.get("updated"))
        self.assertFalse(j.get("checks_fixed"))


if __name__ == "__main__":
    unittest.main()
