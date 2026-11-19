import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planning
import test_planning_start as T

OLD = {"agent": T.P1, "intent": "1970-01-01T00:00:00Z", "resent": '["plan"]', "run": "run9", "copy": "0",
       "started": T.STAMP, "review_round": "3", "revisions": "2", "retried": "1", "open_notes": '["old"]'}


class Rig(T.Rig):
    def __init__(self, refuse=(), **kw):
        super().__init__(**kw)
        self.refuse = set(refuse)

    def gh(self, args):
        if args[:2] == ["issue", "edit"] and "--remove-label" in args and args[args.index("--remove-label") + 1] in self.refuse:
            self.calls.append(list(args))
            raise RuntimeError("HTTP 502")
        return super().gh(args)


def rig(labels, state, refuse=(), children=None):
    T.BACKLOG[:] = [{"number": 12, "title": "T12", "labels": [{"name": n} for n in labels], "createdAt": "2026-11-05T00:00:00Z"}]
    r = Rig(refuse=refuse, children=children)
    for k, v in dict(OLD, state=state).items():
        r.store.set("plan:12", k, v)
    return r


def removed(r):
    return [c[c.index("--remove-label") + 1] for c in r.calls if c[:2] == ["issue", "edit"] and "--remove-label" in c]


class Replan(unittest.TestCase):
    def setUp(self):
        self.saved = list(T.BACKLOG)

    def tearDown(self):
        T.BACKLOG[:] = self.saved

    def test_finished_plan_is_not_sent_again_without_the_label(self):
        r = rig(["P0"], "blocked")
        r.station.once(1)
        self.assertEqual(r.sends, [])

    def test_the_label_plans_a_finished_issue_again_from_a_clean_record(self):
        for state in planning.ENDED:
            r = rig(["P0", planning.REPLAN, "factory-blocked", "likely-fixed"], state)
            r.station.once(1)
            self.assertEqual(r.numbers(), [12], state)
            rec = r.store.get_all("plan:12")
            for stale in ("review_round", "revisions", "retried", "open_notes", "resent"):
                self.assertNotIn(stale, rec)
            self.assertEqual(removed(r)[:3], ["factory-blocked", "likely-fixed", planning.REPLAN])

    def test_a_reset_plan_does_not_take_over_the_old_run(self):
        r = rig(["P0", planning.REPLAN], "blocked")
        r.runs.append({"runId": "run9", "agentId": T.P1, "startedAt": "1970-01-01T00:00:05Z"})
        r.station.once(1)
        self.assertEqual(len(r.sends), 1)
        self.assertNotEqual(r.store.get_all("plan:12")["run"], "run9")

    def test_a_failed_label_removal_changes_nothing(self):
        r = rig(["P0", planning.REPLAN], "blocked", refuse=[planning.REPLAN])
        r.station.once(1)
        self.assertEqual(r.sends, [])
        self.assertEqual(r.store.get_all("plan:12")["review_round"], "3")

    def test_the_label_waits_while_a_plan_is_in_progress(self):
        for state in ("running", "asked", "repair", "planned"):
            r = rig(["P0", planning.REPLAN, "factory-plan"], state)
            r.station.once(1)
            self.assertNotIn(planning.REPLAN, removed(r), state)
            self.assertEqual(r.store.get_all("plan:12")["review_round"], "3", state)

    def test_the_label_waits_behind_other_skip_labels(self):
        for label in ("factory", "factory-question", "factory-done", "duplicate"):
            r = rig(["P0", planning.REPLAN, label], "blocked")
            r.station.once(1)
            self.assertEqual(r.sends, [], label)
            self.assertNotIn(planning.REPLAN, removed(r), label)

    def test_the_label_waits_while_children_are_open(self):
        r = rig(["P0", planning.REPLAN], "cut", children={12: [{"number": 101, "body": "**Part of**: #12"}]})
        r.station.once(1)
        self.assertEqual(r.sends, [])
        self.assertNotIn(planning.REPLAN, removed(r))

    def test_a_failed_removal_of_another_label_keeps_the_record(self):
        r = rig(["P0", planning.REPLAN, "factory-blocked"], "blocked", refuse=["factory-blocked"])
        r.station.once(1)
        self.assertEqual(r.sends, [])
        self.assertNotIn(planning.REPLAN, removed(r))
        self.assertEqual(r.store.get_all("plan:12")["review_round"], "3")

    def test_an_unsent_record_keeps_its_takeover_check(self):
        r = rig(["P0", planning.REPLAN], "unsent")
        r.runs.append({"runId": "run9", "agentId": T.P1, "startedAt": "1970-01-01T00:00:05Z"})
        r.station.once(1)
        self.assertEqual(removed(r), [planning.REPLAN])
        self.assertEqual(r.sends, [])
        self.assertEqual(r.store.get_all("plan:12")["run"], "run9")


if __name__ == "__main__":
    unittest.main()
