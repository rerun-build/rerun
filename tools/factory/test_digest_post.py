import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digest
import limits as L
import store as ledger_store

NOW = L.ts("2026-11-15T12:00:00Z")
LIST = [{"number": 700, "title": "Factory control"}, {"number": 9, "title": "x"}]


class Gh:
    def __init__(self, listing=LIST, new_id=9001, fail_patch=False, fail_list=False):
        self.calls = []
        self.listing = listing
        self.new_id = new_id
        self.fail_patch = fail_patch
        self.fail_list = fail_list

    def __call__(self, args):
        self.calls.append(list(args))
        if args[0] == "issue":
            if self.fail_list:
                raise RuntimeError("down")
            return json.dumps(self.listing)
        if "PATCH" in args and self.fail_patch:
            raise RuntimeError("gone")
        return json.dumps({"id": self.new_id})


class Post(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.st = ledger_store.Store(os.path.join(self.tmp.name, "l.db"))
        self.addCleanup(self.st.db.close)

    def test_first_post_then_throttle_then_edit(self):
        gh = Gh()
        d = {"stations": []}
        self.assertTrue(digest.post(gh, self.st, "o/r", d, NOW))
        self.assertEqual(len(gh.calls), 2)
        self.assertEqual(gh.calls[0][0], "issue")
        self.assertEqual(gh.calls[1][:4], ["api", "-X", "POST", "repos/o/r/issues/700/comments"])
        body = gh.calls[1][-1]
        self.assertTrue(body.startswith("body="))
        self.assertEqual(body[5:].split("\n"), [digest.MARK, "```json", '{"stations": []}', "```"])
        self.assertEqual(self.st.get_all("-")["digest_comment"], "700:9001")
        gh.calls.clear()
        self.assertFalse(digest.post(gh, self.st, "o/r", d, NOW + 599))
        self.assertEqual(gh.calls, [])
        self.assertTrue(digest.post(gh, self.st, "o/r", d, NOW + 600))
        self.assertEqual(gh.calls[0][0], "issue")
        self.assertEqual(gh.calls[1][:4], ["api", "-X", "PATCH", "repos/o/r/issues/comments/9001"])

    def test_no_control_issue_writes_nothing_and_looks_again_after_ten_minutes(self):
        gh = Gh(listing=[])
        d = {"stations": []}
        self.assertFalse(digest.post(gh, self.st, "o/r", d, NOW))
        self.assertEqual(len(gh.calls), 1)
        self.assertFalse(digest.post(gh, self.st, "o/r", d, NOW + 599))
        self.assertEqual(len(gh.calls), 1)
        self.assertFalse(digest.post(gh, self.st, "o/r", d, NOW + 600))
        self.assertEqual(len(gh.calls), 2)

    def test_a_failed_edit_posts_a_new_comment(self):
        gh = Gh()
        d = {"stations": []}
        digest.post(gh, self.st, "o/r", d, NOW)
        gh.fail_patch = True
        gh.new_id = 9002
        gh.calls.clear()
        self.assertTrue(digest.post(gh, self.st, "o/r", d, NOW + 600))
        self.assertEqual(gh.calls[-1][:4], ["api", "-X", "POST", "repos/o/r/issues/700/comments"])
        self.assertEqual(self.st.get_all("-")["digest_comment"], "700:9002")

    def test_a_failing_lookup_returns_false_and_does_not_raise(self):
        gh = Gh(fail_list=True)
        self.assertFalse(digest.post(gh, self.st, "o/r", {"stations": []}, NOW))

    def test_none_digest_does_nothing(self):
        gh = Gh()
        self.assertFalse(digest.post(gh, self.st, "o/r", None, NOW))
        self.assertEqual(gh.calls, [])


if __name__ == "__main__":
    unittest.main()
