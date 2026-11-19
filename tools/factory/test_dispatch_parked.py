import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T


class Parked(T.Base):
    def test_a_parked_issue_is_not_taken_in(self):
        self.w.issues[0]["labels"] = ["factory-paused"]
        self.tick(3)
        self.assertEqual(self.job_ids(), [])
        self.assertEqual(self.w.sends, [])
        self.w.issues[0]["labels"] = []
        self.tick()
        self.assertEqual(self.state(), "building")

    def test_a_job_parked_after_it_was_queued_is_not_built_until_the_park_comes_off(self):
        real = self.w.gh

        def gh(args):
            if args[:2] == ["issue", "list"] and "--label" in args and args[args.index("--label") + 1] == "factory":
                got = T.json.loads(real(args))
                return T.json.dumps([dict(i, labels=[]) for i in got])
            return real(args)
        self.w.gh = gh
        self.w.issues[0]["labels"] = ["factory-paused"]
        self.tick(3)
        self.assertEqual(self.state(), "queued")
        self.assertEqual(self.w.sends, [])
        self.assertEqual(self.out.getvalue().count("parked: not built while factory-paused"), 1)
        self.w.issues[0]["labels"] = []
        self.tick()
        self.assertEqual(self.state(), "building")

    def test_no_build_starts_while_the_parked_list_cannot_be_read(self):
        real = self.w.gh
        fails = [1]

        def gh(args):
            if args[:2] == ["issue", "list"] and "--label" in args and args[args.index("--label") + 1] == "factory-paused" and fails:
                fails.pop()
                raise T.D.Error("HTTP 502")
            return real(args)
        self.w.gh = gh
        self.tick()
        self.assertEqual(self.state(), "queued")
        self.assertIn("parked list not read", self.out.getvalue())
        self.tick()
        self.assertEqual(self.state(), "building")

    def test_an_unparked_job_is_built(self):
        self.tick()
        self.assertEqual(self.state(), "building")


if __name__ == "__main__":
    unittest.main()
