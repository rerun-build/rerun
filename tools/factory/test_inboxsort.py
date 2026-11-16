import calendar, json, os, sys, time, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import followups as F
import inboxsort as S
from test_dispatch import Base

NOW = calendar.timegm(time.strptime("2026-11-16T01:00:00Z", "%Y-%m-%dT%H:%M:%SZ"))
HOUR = 3600
DAY = 86400


def comment(job, *texts):
    verdict = "\n".join("Follow-up: " + t for t in texts)
    parts = ["%s\n\n%s" % (title, body) for _, title, body in F.notes(verdict, job)]
    return "\n\n".join(["From %s, pull request #42:" % job] + parts)


def factory(n):
    return ["the dispatcher logs step %s twice in tools/factory/dispatch.py" % w for w in ("one", "two", "three", "four", "five")[:n]]


def ui(n):
    return ["the screen %s shows a stale count" % w for w in ("alpha", "beta", "gamma", "delta")[:n]]


def engine(n):
    return ["the engine run %s keeps an old error" % w for w in ("red", "blue", "green")[:n]]


class Store:
    def __init__(self):
        self.kv = {}

    def get_all(self, job):
        return dict(self.kv.get(job, {}))

    def set(self, job, k, v):
        self.kv.setdefault(job, {})[k] = str(v)


class Hub:
    def __init__(self, comments, open_issues=()):
        self.inbox = {"number": 1, "title": "Factory follow-ups inbox", "body": "", "comments": list(comments)}
        self.issues = [dict(i, labels=[]) for i in open_issues]
        self.calls, self.search = [], {}

    def __call__(self, args):
        a = list(args)
        self.calls.append(a)
        opt = lambda k: a[a.index(k) + 1] if k in a else None
        if a[:2] == ["issue", "view"]:
            return json.dumps({"comments": [{"body": c} for c in self.inbox["comments"]]})
        if a[:2] == ["issue", "list"] and "--search" in a:
            return json.dumps(self.search.get(opt("--search").split(":")[0], []))
        if a[:2] == ["issue", "list"]:
            return json.dumps([{"number": i["number"], "title": i["title"], "body": i["body"]} for i in [self.inbox] + self.issues])
        if a[:2] == ["issue", "create"]:
            n = 100 + len(self.issues)
            labels = [a[i + 1] for i, x in enumerate(a) if x == "--label"]
            self.issues.append({"number": n, "title": opt("--title"), "body": opt("--body"), "labels": labels})
            return "https://github.com/o/r/issues/%d\n" % n
        if a[:2] == ["issue", "comment"]:
            self.inbox["comments"].append(opt("--body"))
            return ""
        raise AssertionError("unexpected gh call %r" % a)

    def minted(self):
        return [i for i in self.issues if i["number"] >= 100]


class D:
    def __init__(self, hub, now=NOW):
        self.gh, self.repo, self.store, self.clock, self.lines = hub, "o/r", Store(), now, []
        self.store.set("-", "inbox", 1)

    def now(self):
        return self.clock

    def beat(self):
        S.beat(self, lambda n, msg: self.lines.append((n, msg)))


class Notes(unittest.TestCase):
    def test_a_comment_gives_each_note_its_key_text_and_job(self):
        got = S.notes([comment("#5", "add a retry test", "rename x to y")])
        self.assertEqual([(n["text"], n["job"]) for n in got], [("add a retry test", "#5"), ("rename x to y", "#5")])
        self.assertEqual([n["key"] for n in got], [k for k, _, _ in F.notes("Follow-up: add a retry test\nFollow-up: rename x to y", "#5")])

    def test_the_same_key_twice_is_one_note(self):
        got = S.fresh(S.notes([comment("#5", "add a retry test"), comment("#5", "add a retry test")]), [])
        self.assertEqual(len(got), 1)

    def test_the_same_text_after_case_digits_hex_and_spaces_is_one_note(self):
        got = S.fresh(S.notes([comment("#5", "Retry the call 3 times at abc1234f"),
                               comment("#9", "retry  the CALL 5 times at 9f8e7d6c")]), [])
        self.assertEqual([n["job"] for n in got], ["#5"])

    def test_a_note_already_in_an_open_issue_is_dropped_by_key_or_by_sentence(self):
        notes = S.notes([comment("#5", "add a retry test", "log the sum at step 4")])
        issues = [{"number": 7, "title": "x", "body": "see <!-- followup:%s -->" % notes[0]["key"]},
                  {"number": 8, "title": "Log the sum at step 12", "body": ""}]
        self.assertEqual(S.fresh(notes, issues), [])


def flow_hub(opened, closed, mine=()):
    hub = Hub([])
    hub.search = {"created": [{"number": n, "labels": [{"name": "factory-problem"}] if n in mine else []} for n in range(opened)],
                  "closed": [{"number": n} for n in range(closed)]}
    return hub


class Mint(unittest.TestCase):
    def test_a_group_below_three_notes_stays_in_the_inbox(self):
        hub = Hub([comment("#5", *factory(2)), comment("#6", *ui(1))])
        D(hub).beat()
        self.assertEqual(hub.minted(), [])
        self.assertEqual(len(hub.inbox["comments"]), 2)

    def test_the_minted_issue_holds_every_note_in_full_with_its_marks_and_labels(self):
        hub = Hub([comment("#5", *factory(3)), comment("#6", *ui(2))])
        D(hub).beat()
        [issue] = hub.minted()
        keys = [n["key"] for n in S.notes(hub.inbox["comments"][:1])]
        for text in factory(3):
            self.assertIn("### From #5: %s\n\n%s" % (text[:80], text), issue["body"])
        self.assertTrue(issue["body"].rstrip().endswith("\n".join("<!-- followup:%s -->" % k for k in keys)), issue["body"])
        self.assertEqual(sorted(issue["labels"]), ["P1", "area:factory"])
        self.assertEqual(hub.inbox["comments"][-1], "Minted #%d from 3 notes: %s" % (issue["number"], ", ".join(keys)))
        self.assertEqual(len(hub.inbox["comments"]), 3)

    def test_a_group_with_no_rule_label_gets_p3_and_no_area_label(self):
        hub = Hub([comment("#6", *ui(3))])
        D(hub).beat()
        [issue] = hub.minted()
        self.assertEqual(issue["labels"], ["P3"])

    def test_two_a_day_largest_first_and_two_more_the_next_day(self):
        hub = Hub([comment("#5", *factory(5)), comment("#6", *ui(4)), comment("#7", *engine(3))])
        d = D(hub)
        d.beat()
        self.assertEqual([len(S.MARK.findall(i["body"])) for i in hub.minted()], [5, 4])
        d.clock += 2 * HOUR
        d.beat()
        self.assertEqual(len(hub.minted()), 2)
        d.clock += DAY
        d.beat()
        self.assertEqual([len(S.MARK.findall(i["body"])) for i in hub.minted()], [5, 4, 3])
        d.clock += DAY
        d.beat()
        self.assertEqual(len(hub.minted()), 3)

    def test_notes_named_in_a_minted_comment_are_never_minted_again(self):
        hub = Hub([comment("#5", *factory(3))])
        d = D(hub)
        d.beat()
        hub.issues = []
        d.clock += DAY
        d.beat()
        self.assertEqual(hub.minted(), [])

    def test_the_sort_runs_at_most_once_an_hour(self):
        hub = Hub([])
        d = D(hub)
        d.beat()
        made = len(hub.calls)
        d.clock += HOUR - 1
        d.beat()
        self.assertEqual(len(hub.calls), made)
        d.clock += 1
        d.beat()
        self.assertGreater(len(hub.calls), made)


class Flow(unittest.TestCase):
    def test_opened_and_closed_for_a_day_and_a_week_are_kept_and_logged(self):
        hub = flow_hub(5, 3, mine={1})
        d = D(hub)
        d.beat()
        lists = [c for c in hub.calls if "--search" in c]
        self.assertEqual(len(lists), 4)
        self.assertEqual({c[c.index("--state") + 1] for c in lists}, {"all"})
        self.assertEqual(sorted(c[c.index("--search") + 1] for c in lists),
                         ["closed:>=2026-11-09T01:00:00Z", "closed:>=2026-11-15T01:00:00Z",
                          "created:>=2026-11-09T01:00:00Z", "created:>=2026-11-15T01:00:00Z"])
        flow = json.loads(d.store.get_all("-")["issue_flow"])
        self.assertEqual(flow, {"opened_day": 5, "closed_day": 3, "opened_week": 5, "closed_week": 3, "mine_day": 1})
        self.assertIn("issues opened 5, closed 3 in 24 hours; opened 5, closed 3 in 7 days", [m for _, m in d.lines])

    def test_the_alarm_needs_more_opened_than_closed_and_one_of_them_ours(self):
        self.assertEqual(S.alarm({}), {})
        line = S.alarm({"issue_flow": json.dumps({"opened_day": 5, "closed_day": 3, "opened_week": 9, "closed_week": 9, "mine_day": 1})})
        self.assertEqual(list(line), ["backlog growing"])
        self.assertIn("opened 5, closed 3", line["backlog growing"])
        self.assertEqual(S.alarm({"issue_flow": json.dumps({"opened_day": 5, "closed_day": 3, "opened_week": 9, "closed_week": 9, "mine_day": 0})}), {})
        self.assertEqual(S.alarm({"issue_flow": json.dumps({"opened_day": 3, "closed_day": 3, "opened_week": 9, "closed_week": 9, "mine_day": 2})}), {})


class Alarm(Base):
    def setUp(self):
        super().setUp()
        self.cfg["resolver"] = {"detect": True, "resolve": False}

    def flow(self, opened, closed):
        self.d.store.set("-", "issue_flow", json.dumps({"opened_day": opened, "closed_day": closed, "opened_week": opened,
                                                        "closed_week": closed, "mine_day": 1}))

    def test_the_backlog_alarm_opens_one_problem_and_clears_by_itself(self):
        self.d = self.new()
        self.d.store.set("-", "inboxsort_at", self.w.clock + 10 * DAY)
        self.flow(5, 3)
        self.tick(2)
        [p] = [p for p in self.w.problems if p["title"] == "Factory problem: backlog growing"]
        self.assertIn("opened 5, closed 3", p["body"])
        self.flow(3, 4)
        self.tick(3)
        self.assertEqual(p["state"], "CLOSED")


if __name__ == "__main__":
    unittest.main()
