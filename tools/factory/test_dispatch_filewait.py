import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D
from test_dispatch import Base, ready


def body(path="a/b.py"):
    return ready("PLAN READY (facts read on dev 4296d1f)").replace("a/b.py", path).replace("a/test_b.py", path.replace(".py", "_test.py"))


class FileWait(Base):
    def setUp(self):
        super().setUp()
        self.cfg["one_file_one_job"] = True
        self.cfg["max_jobs"] = 8
        self.compare = "[]"
        real = self.w.gh

        def gh(args):
            a = list(args)
            if a[0] == "api" and "/compare/" in a[1]:
                self.w.gh_calls.append(a)
                return self.compare
            return real(args)

        self.w.gh = gh

    def put(self, other="a/b.py"):
        self.w.issues = [{"number": 5, "title": "Fix 5", "body": body(), "comments": []},
                         {"number": 6, "title": "Fix 6", "body": body(other), "comments": []}]

    def reasons(self, n):
        return [t["reason"] for t in self.d.store.transitions_of(str(n))]

    def test_a_job_naming_a_file_of_a_live_job_waits_for_it(self):
        self.put()
        self.tick()
        self.assertEqual(self.state(5), "building")
        self.assertEqual(self.state(6), "waiting")
        self.assertEqual(len(self.w.sends), 1)
        self.assertIn("waits for #5, same file a/b.py", self.reasons(6))

    def test_the_wait_is_written_once(self):
        self.put()
        self.tick(4)
        self.assertEqual(len([r for r in self.reasons(6) if str(r).startswith("waits for #5")]), 1)

    def test_jobs_on_other_files_run_side_by_side(self):
        self.put("c/d.py")
        self.tick()
        self.assertEqual(self.state(5), "building")
        self.assertEqual(self.state(6), "building")
        self.assertEqual(len(self.w.sends), 2)

    def test_the_setting_off_keeps_today_s_behaviour(self):
        self.cfg["one_file_one_job"] = False
        self.put()
        self.tick()
        self.assertEqual(self.state(5), "building")
        self.assertEqual(self.state(6), "building")

    def test_a_released_job_is_checked_against_dev_before_it_is_built(self):
        self.compare = json.dumps(["a/b.py"])
        self.put()
        self.tick()
        self.w.finish("b1", "Stuck.\nBLOCKED: cannot do it")
        self.tick(2)
        self.assertEqual(self.state(5), "blocked")
        self.assertEqual(self.state(6), "building")
        self.assertIn("DONE ELSEWHERE", self.w.sends[-1][1])

    def test_the_shipped_settings_turn_it_on(self):
        self.assertIs(D.settings()["one_file_one_job"], True)


if __name__ == "__main__":
    unittest.main()
