import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_dispatch as T


class Stop(T.Base):
    def last(self, n=5):
        return self.d.store.transitions_of(str(n))[-1]

    def stopped_comments(self):
        return [c for c in self.w.gh_calls if c[:2] == ["issue", "comment"] and "taken by the factory" not in c[-1]]

    def test_a_removed_label_stops_a_building_job_at_the_tenth_beat(self):
        self.w.issues.append({"number": 6, "title": "Fix y", "body": T.ready(), "comments": []})
        self.tick(1)
        self.w.unlabelled.add(5)
        self.tick(8)
        self.assertEqual(self.state(5), "building")
        self.assertEqual(self.w.cancels, [])
        self.tick(1)
        self.assertEqual(self.state(5), "returned")
        self.assertEqual(self.last()["reason"], "returned: issue closed or the factory label removed")
        self.assertEqual(self.w.cancels, [("b1", "run1")])
        self.assertEqual(self.state(6), "building")
        self.assertEqual(self.w.edits(5), [])
        self.assertEqual([c for c in self.stopped_comments() if c[2] == "5"], [])

    def test_a_merged_pull_request_ends_a_reviewing_job_merged(self):
        self.to_review()
        self.assertEqual(self.state(), "reviewing")
        self.w.pr_state = "MERGED"
        self.tick(7)
        self.assertEqual(self.state(), "merged")
        self.assertEqual(self.last()["reason"], "merged: merged outside the delegator")
        self.assertEqual(len(self.w.cancels), 1)
        self.assertEqual(self.w.merges, [])
        self.assertEqual(self.stopped_comments(), [])

    def test_a_closed_pull_request_ends_a_reviewing_job_blocked(self):
        self.to_review()
        self.w.pr_state = "CLOSED"
        self.tick(7)
        self.assertEqual(self.state(), "blocked")
        self.assertEqual(self.last()["reason"], "blocked: pull request #42 closed without merge")
        self.assertEqual(len(self.w.cancels), 1)
        self.assertEqual(self.stopped_comments(), [])

    def test_a_merged_pull_request_wins_over_a_removed_label(self):
        self.to_review()
        self.w.pr_state = "MERGED"
        self.w.unlabelled.add(5)
        self.tick(7)
        self.assertEqual(self.state(), "merged")


class NoBuilders(T.Base):
    builders = []

    def test_a_queued_job_without_a_run_ends_returned_with_no_cancel(self):
        self.tick(1)
        self.assertEqual(self.state(), "queued")
        self.w.unlabelled.add(5)
        self.tick(9)
        self.assertEqual(self.state(), "returned")
        self.assertEqual(self.w.cancels, [])


if __name__ == "__main__":
    unittest.main()
