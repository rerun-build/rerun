import json
import os
import tempfile
import unittest

import control
import store as S

BOUNDS = {
    "settable": ["copies", "wip"],
    "copies": {"code": 8, "LARRY": 2, "LINUS": 4},
    "wip": {"building": 12},
}


def make_cfg():
    return {
        "repo": "o/r",
        "types": {
            "coder": {"coworkers": [
                {"id": "a", "name": "code", "runs": 6},
                {"id": "b", "name": "LARRY", "runs": 1},
            ]},
            "reviewer": {"coworkers": [{"id": "c", "name": "LINUS", "runs": 3}]},
        },
    }


def body_of(block):
    return "Settings\n```json\n" + json.dumps(block) + "\n```\n"


class Fake:
    def __init__(self, rows=None, fail=False):
        self.rows = rows if rows is not None else []
        self.fail = fail
        self.calls = []

    def __call__(self, args):
        self.calls.append(list(args))
        if args[:2] == ["issue", "list"]:
            if self.fail:
                raise RuntimeError("down")
            return json.dumps(self.rows)
        return ""

    def reads(self):
        return [c for c in self.calls if c[:2] == ["issue", "list"]]

    def comments(self):
        return [c for c in self.calls if c[:2] == ["issue", "comment"]]


def runs(cfg):
    return {c["name"]: c["runs"] for t in cfg["types"].values() for c in t["coworkers"]}


class Read(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.store = S.Store(os.path.join(self.d.name, "ledger.db"))
        self.cfg = make_cfg()

    def tearDown(self):
        self.store.close()
        self.d.cleanup()

    def control(self, gh):
        return control.Control(self.cfg, gh, self.store, BOUNDS)

    def row(self, block, title="Factory control", number=12):
        return {"number": number, "title": title, "body": body_of(block)}

    def test_the_issue_is_searched_by_its_title_and_no_issue_leaves_the_settings(self):
        gh = Fake()
        self.control(gh).tick(1)
        self.assertEqual(gh.calls, [[
            "issue", "list", "-R", "o/r", "--state", "open", "--search", "Factory control in:title",
            "--json", "number,title,body,author", "--limit", "20",
        ]])
        self.assertEqual(runs(self.cfg), {"code": 6, "LARRY": 1, "LINUS": 3})
        self.assertEqual(self.store.events(), [])

    def test_valid_values_set_the_copies_and_each_change_is_an_event(self):
        gh = Fake([self.row({"copies": {"code": 4, "LINUS": 4}})])
        self.control(gh).tick(1)
        self.assertEqual(runs(self.cfg), {"code": 4, "LARRY": 1, "LINUS": 4})
        events = self.store.events()
        self.assertEqual([(e["key"], e["from"], e["to"]) for e in events],
                         [("copies.LINUS", 3, 4), ("copies.code", 6, 4)])
        for e in events:
            self.assertRegex(e["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d.*Z$")

    def test_the_issue_is_read_on_beat_one_and_then_every_fifth_beat(self):
        gh = Fake([self.row({"copies": {"code": 4}})])
        c = self.control(gh)
        for beat in range(1, 11):
            c.tick(beat)
        self.assertEqual(len(gh.reads()), 3)
        self.assertEqual(len(self.store.events()), 1)

    def test_an_issue_with_another_title_is_ignored(self):
        gh = Fake([self.row({"copies": {"code": 4}}, title="Factory controls"), {"number": 3, "body": "x"}])
        self.control(gh).tick(1)
        self.assertEqual(runs(self.cfg), {"code": 6, "LARRY": 1, "LINUS": 3})
        self.assertEqual(self.store.events(), [])
        self.assertEqual(gh.comments(), [])

    def test_an_issue_by_an_untrusted_author_is_ignored(self):
        r = dict(self.row({"copies": {"code": 4}}), author={"login": "random-stranger"})
        gh = Fake([r])
        self.control(gh).tick(1)
        self.assertEqual(runs(self.cfg), {"code": 6, "LARRY": 1, "LINUS": 3})
        self.assertEqual(self.store.events(), [])
        self.assertEqual(gh.comments(), [])

    def test_an_invalid_value_keeps_the_last_valid_one_and_is_answered_by_one_comment(self):
        gh = Fake([self.row({"copies": {"code": 4}})])
        c = self.control(gh)
        c.tick(1)
        gh.rows = [self.row({"copies": {"code": 9}})]
        c.tick(5)
        c.tick(10)
        self.assertEqual(runs(self.cfg)["code"], 4)
        self.assertEqual(len(gh.comments()), 1)
        call = gh.comments()[0]
        self.assertEqual(call[:5], ["issue", "comment", "12", "-R", "o/r"])
        self.assertEqual(call[5], "--body")
        self.assertIn("copies.code: 9 is not a whole number from 0 to 8", call[6])
        self.assertTrue(call[6].startswith("Factory control: these values were refused and the last valid values stay.\n- "))
        gh.rows = [self.row({"weights": {"code": 1}})]
        c.tick(15)
        self.assertEqual(len(gh.comments()), 2)

    def test_a_refused_value_comments_again_after_the_block_was_valid_in_between(self):
        gh = Fake([self.row({"copies": {"code": 9}})])
        c = self.control(gh)
        c.tick(1)
        gh.rows = [self.row({"copies": {"code": 4}})]
        c.tick(5)
        gh.rows = [self.row({"copies": {"code": 9}})]
        c.tick(10)
        self.assertEqual(len(gh.comments()), 2)

    def test_a_removed_block_returns_the_pool_to_the_settings(self):
        gh = Fake([self.row({"copies": {"code": 4}})])
        c = self.control(gh)
        c.tick(1)
        gh.rows = [{"number": 12, "title": "Factory control", "body": "nothing here"}]
        c.tick(5)
        self.assertEqual(runs(self.cfg)["code"], 6)
        self.assertEqual([(e["key"], e["from"], e["to"]) for e in self.store.events()],
                         [("copies.code", 6, 4), ("copies.code", 4, 6)])

    def test_a_failing_read_changes_nothing_and_raises_nothing(self):
        gh = Fake([self.row({"copies": {"code": 4}})], fail=True)
        c = self.control(gh)
        c.tick(1)
        self.assertEqual(runs(self.cfg)["code"], 6)
        self.assertEqual(self.store.events(), [])
        gh.fail = False
        c.tick(2)
        self.assertEqual(runs(self.cfg)["code"], 4)

    def test_wip_values_are_recorded_and_do_not_touch_the_pools(self):
        gh = Fake([self.row({"wip": {"building": 8}})])
        self.control(gh).tick(1)
        self.assertEqual(runs(self.cfg), {"code": 6, "LARRY": 1, "LINUS": 3})
        self.assertEqual([(e["key"], e["from"], e["to"]) for e in self.store.events()],
                         [("wip.building", None, 8)])


if __name__ == "__main__":
    unittest.main()
