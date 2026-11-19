import unittest

from test_dispatch import Base

LONG = "The merge retry in `tools/factory/dispatch.py` fails twice after a refused merge. " * 10
FU = "In `tools/factory/gate.py` split the output on newlines." + "From the review of #929." + "<!-- followup:#929-1 -->"
FU2 = "In `tools/factory/gate.py` keep the exit code on failure." + "From the review of #929." + "<!-- followup:#929-2 -->"
SHARED_ONLY = "Work in tools/factory on `dev` and `factory.py`, then check `main`. " * 10
SAME_FILE = "In tools/factory/gate.py the call `gate.split` drops a line. " * 10


class ClassifyJoin(Base):
    def setUp(self):
        super().setUp()
        self.cfg["classify"] = {"on": True}
        self.w.issues = []

    def seed(self, n, title, body=LONG, labels=()):
        self.w.problems.append({"number": n, "title": title, "body": body, "comments": [],
                                "labels": list(labels), "state": "OPEN"})

    def prob(self, n):
        return next(p for p in self.w.problems if p["number"] == n)

    def group(self, title):
        return [p for p in self.w.problems if p["title"] == title]

    def test_a_follow_up_is_joined_whole_into_a_new_group_and_closed(self):
        self.seed(301, "Split gate output on newlines", body=FU)
        self.tick()
        g = self.group("Follow-ups: factory, P1")
        self.assertEqual(len(g), 1)
        self.assertEqual(g[0]["labels"], ["P1"])
        self.assertEqual(g[0]["comments"], ["### From #301: Split gate output on newlines\n\n" + FU])
        self.assertEqual(self.prob(301)["state"], "CLOSED")
        self.assertEqual(self.prob(301)["comments"], ["Consolidated into #%d" % g[0]["number"]])
        self.assertEqual(self.prob(301)["labels"], [])

    def test_a_second_follow_up_goes_to_the_open_group(self):
        self.seed(301, "Split gate output on newlines", body=FU)
        self.seed(302, "Keep gate exit codes on failure", body=FU2)
        self.tick()
        g = self.group("Follow-ups: factory, P1")
        self.assertEqual(len(g), 1)
        self.assertEqual(len(g[0]["comments"]), 2)
        self.assertEqual(self.prob(302)["state"], "CLOSED")
        self.assertEqual(self.prob(302)["comments"], ["Consolidated into #%d" % g[0]["number"]])

    def test_a_follow_up_too_long_for_one_comment_is_labelled_not_closed(self):
        self.seed(303, "Split gate output on newlines", body=FU + "x" * 60000)
        self.tick()
        self.assertEqual(self.prob(303)["state"], "OPEN")
        self.assertEqual(self.prob(303)["labels"], ["P1", "area:factory"])
        self.assertEqual(self.group("Follow-ups: factory, P1"), [])

    def test_similar_issues_are_named_on_each_other_and_labelled_once(self):
        self.seed(401, "Merge retry fails twice", labels=["P1"])
        self.seed(402, "Merge retry fails twice on refusal", labels=["P1"])
        self.tick()
        self.assertEqual(self.prob(401)["labels"], ["P1", "similar"])
        self.assertEqual(self.prob(402)["labels"], ["P1", "similar"])
        self.assertEqual(self.prob(401)["comments"], ["Similar to #402: their titles share most words."])
        self.assertEqual(self.prob(402)["comments"], ["Similar to #401: their titles share most words."])
        self.tick()
        creates = [c for c in self.w.gh_calls if c[:2] == ["label", "create"]]
        self.assertEqual(len(creates), 1)
        self.assertEqual(self.prob(401)["comments"], ["Similar to #402: their titles share most words."])

    def test_an_owner_issue_is_never_named_similar(self):
        self.seed(501, "Merge retry fails twice", labels=["owner"])
        self.seed(502, "Merge retry fails twice on refusal", labels=["P1"])
        self.tick()
        self.assertEqual(self.prob(501)["labels"], ["owner"])
        self.assertEqual(self.prob(501)["comments"], [])
        self.assertEqual(self.prob(502)["labels"], ["P1"])
        self.assertEqual(self.prob(502)["comments"], [])
        self.assertEqual([c for c in self.w.gh_calls if c[:2] == ["label", "create"]], [])

    def test_a_folder_and_a_branch_name_alone_do_not_make_issues_similar(self):
        self.seed(701, "Dispatcher stalls on a held job", body=SHARED_ONLY + "One.", labels=["P1"])
        self.seed(702, "Rename the planning label", body=SHARED_ONLY + "Two.", labels=["P1"])
        self.seed(703, "Gate output keeps newlines", body=SAME_FILE + "One.", labels=["P1"])
        self.seed(704, "Cover the gate splitter", body=SAME_FILE + "Two.", labels=["P1"])
        self.tick()
        self.assertEqual(self.prob(701)["comments"], [])
        self.assertEqual(self.prob(701)["labels"], ["P1"])
        self.assertEqual(self.prob(702)["comments"], [])
        self.assertEqual(self.prob(703)["comments"], ["Similar to #704: both cite tools/factory/gate.py and gate.split."])

    def test_each_issue_is_named_similar_to_at_most_three_others(self):
        for n in range(601, 607):
            self.seed(n, "Merge retry fails twice", labels=["P1"])
        self.tick(4)
        self.assertEqual([len(self.prob(n)["comments"]) for n in range(601, 607)], [3, 3, 3, 3, 1, 1])

    def test_a_comment_refused_mid_pair_is_not_posted_again(self):
        self.seed(801, "Merge retry fails twice", labels=["P1"])
        self.seed(802, "Merge retry fails twice on refusal", labels=["P1"])
        inner = self.w.gh

        def refusing(args):
            if args[:3] == ["issue", "comment", "802"] and not getattr(self, "refused", False):
                self.refused = True
                self.w.gh_calls.append(list(args))
                raise RuntimeError("GraphQL: was submitted too quickly (addComment)")
            return inner(args)

        self.w.gh = refusing
        self.tick(2)
        self.assertEqual(self.prob(801)["comments"], ["Similar to #802: their titles share most words."])
        self.assertEqual(self.prob(802)["comments"], [])


if __name__ == "__main__":
    unittest.main()
