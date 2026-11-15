import json, os, sys, time, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backlog

NOW = 1800000000.0
DAY = 86400


def iso(age_days):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - age_days * DAY))


class Store:
    def __init__(self):
        self.kv = {}

    def get_all(self, job):
        return dict(self.kv.get(job, {}))

    def set(self, job, k, v):
        self.kv.setdefault(job, {})[k] = str(v)


class Gh:
    def __init__(self, candidates, timelines):
        self.candidates = candidates
        self.timelines = timelines
        self.calls = []

    def __call__(self, args):
        self.calls.append(list(args))
        if args[:2] == ["issue", "list"]:
            return json.dumps([{"number": n} for n in self.candidates])
        if args[0] == "api":
            n = int(args[1].split("/")[4])
            return json.dumps(self.timelines(n))
        return ""

    def closes(self):
        return [c for c in self.calls if c[:2] == ["issue", "close"]]

    def reads(self):
        return [c for c in self.calls if c[0] == "api"]


def tl(label_age, comment_age=None, removed=False):
    ev = []
    if comment_age is not None:
        ev.append({"event": "commented", "created_at": iso(comment_age), "html_url": "https://x/c1"})
    if label_age is not None:
        ev.append({"event": "labeled", "created_at": iso(label_age), "label": {"name": "likely-fixed"}})
    if removed:
        ev.append({"event": "unlabeled", "created_at": iso(1), "label": {"name": "likely-fixed"}})
    return ev


class BacklogTest(unittest.TestCase):
    def test_closes_after_7_days_with_a_comment_naming_the_evidence(self):
        gh = Gh([5], lambda n: tl(8, 9))
        out = backlog.close_pass(gh, "o/r", Store(), NOW)
        self.assertEqual(out, [5])
        self.assertEqual(len(gh.closes()), 1)
        c = gh.closes()[0]
        self.assertEqual(c[:5], ["issue", "close", "5", "-R", "o/r"])
        self.assertIn("https://x/c1", c[c.index("--comment") + 1])
        self.assertFalse([x for x in gh.calls if x[:2] == ["issue", "edit"]])

    def test_a_younger_label_or_a_removed_label_or_no_evidence_is_left_open(self):
        cases = {1: tl(6, 9), 2: tl(8, 9, removed=True), 3: tl(8, None), 4: tl(8, 7)}
        gh = Gh([1, 2, 3, 4], lambda n: cases[n])
        out = backlog.close_pass(gh, "o/r", Store(), NOW)
        self.assertEqual(out, [])
        self.assertEqual(gh.closes(), [])
        self.assertEqual(len(gh.reads()), 4)

    def test_one_pass_a_day(self):
        gh = Gh([5], lambda n: tl(8, 9))
        st = Store()
        backlog.close_pass(gh, "o/r", st, NOW)
        n = len(gh.calls)
        self.assertEqual(backlog.close_pass(gh, "o/r", st, NOW + 86399), [])
        self.assertEqual(len(gh.calls), n)
        self.assertEqual(backlog.close_pass(gh, "o/r", st, NOW + 86400), [5])
        self.assertGreater(len(gh.calls), n)

    def test_at_most_20_issues_a_pass(self):
        gh = Gh(list(range(30, 0, -1)), lambda n: tl(8, 9))
        out = backlog.close_pass(gh, "o/r", Store(), NOW)
        self.assertEqual(out, list(range(1, 21)))
        self.assertEqual(len(gh.closes()), 20)
        self.assertEqual(len(gh.reads()), 20)


if __name__ == "__main__":
    unittest.main()
