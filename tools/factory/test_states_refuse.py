import contextlib, io, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as TD


class Refuse(TD.Base):
    def seed(self, state, **kw):
        self.d = self.new()
        j = {"issue": 5, "title": "t", "worker": "coder"}
        j.update(kw)
        if state == "nowhere":
            self.d.store.put_job("5", "queued", j, "seeded")
            self.d.store.db.execute("UPDATE jobs SET state=? WHERE job=?", (state, "5"))
        else:
            self.d.store.put_job("5", state, j, "seeded")
        return self.d.store.get_job("5")

    def run_to(self, fn, *args, **kw):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            fn(*args, **kw)
        return out.getvalue()

    def moves(self):
        return [(t["from_state"], t["to_state"]) for t in self.d.store.transitions_of("5")]

    def test_refused_move_blocks_the_job(self):
        j = self.seed("queued")
        out = self.run_to(self.d.to, j, "checks", "accepted", checks_since=1)
        got = self.d.store.get_job("5")
        self.assertEqual(got["state"], "blocked")
        self.assertEqual(got["reason"], "refused move queued -> checks: accepted")
        self.assertNotIn("checks_since", got)
        self.assertIn("refused move queued -> checks", out)
        self.assertEqual(self.moves()[-1], ("queued", "blocked"))

    def test_ended_job_is_left_as_it_is(self):
        j = self.seed("merged")
        before = self.moves()
        out = self.run_to(self.d.end, j, "failed", "late")
        self.assertEqual(self.d.store.get_job("5")["state"], "merged")
        self.assertEqual(self.moves(), before)
        self.assertIn("refused move merged -> failed", out)

    def test_allowed_moves_are_made(self):
        j = self.seed("building")
        self.run_to(self.d.to, j, "review_wait", "built")
        self.assertEqual(self.d.store.get_job("5")["state"], "review_wait")
        self.run_to(self.d.end, j, "failed", "gave up")
        self.assertEqual(self.d.store.get_job("5")["state"], "failed")

    def test_unknown_stored_state_is_blocked(self):
        j = self.seed("nowhere")
        self.run_to(self.d.end, j, "failed", "x")
        got = self.d.store.get_job("5")
        self.assertEqual(got["state"], "blocked")
        self.assertIn("refused move nowhere -> failed", got["reason"])


if __name__ == "__main__":
    unittest.main()
