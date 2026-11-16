import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fakegh, ghclient

SINCE = "2026-11-16T10:00:00Z"


def pull(number, base, updated, merged, sha):
    day = "2026-11-16T%s:00Z"
    return {"number": number, "base": {"ref": base}, "updated_at": day % updated,
            "merged_at": day % merged if merged else None, "merge_commit_sha": sha}


class Events(unittest.TestCase):
    def setUp(self):
        pulls = [pull(40, "dev", "11:00", "10:30", "m40"), pull(41, "dev", "10:50", None, "x41"),
                 pull(42, "dev", "10:40", "09:00", "m42"), pull(43, "dev", "09:30", "09:20", "m43"),
                 pull(44, "main", "10:10", "10:05", "m44")]
        issues = {50: {"number": 50, "created_at": "2026-11-16T10:20:00Z"},
                  51: {"number": 51, "created_at": "2026-11-15T08:00:00Z"},
                  52: {"number": 52, "created_at": "2026-11-16T10:25:00Z", "pull_request": {}}}
        self.f = fakegh.Fake(issues=issues, pulls=pulls, files={40: ["a.py", "docs/b.md"], 44: ["c.py"]})
        self.f.start()
        os.environ["GH_TEST_TOKEN"] = "t"
        self.c = ghclient.Client(self.f.url, "o/r", token_env="GH_TEST_TOKEN")

    def tearDown(self):
        self.f.stop()
        os.environ.pop("GH_TEST_TOKEN", None)

    def test_merged_prs_since(self):
        self.assertEqual(self.c.merged_prs("dev", SINCE),
                         [{"number": 40, "base": "dev", "sha": "m40", "files": ["a.py", "docs/b.md"]}])
        self.assertEqual(self.c.merged_prs("main", SINCE),
                         [{"number": 44, "base": "main", "sha": "m44", "files": ["c.py"]}])
        self.assertEqual(len([c for c in self.f.calls if c[1].endswith("/files")]), 2)

    def test_issues_since_keeps_new_ones(self):
        self.assertEqual([i["number"] for i in self.c.issues_since(SINCE)], [50, 52])

    def test_pages_keeps_the_query(self):
        list(self.c.pages("/pulls?state=closed&base=dev", per_page=7))
        self.assertTrue(self.f.calls[-1][1].endswith("/pulls"))
        self.assertEqual(self.f.queries[-1]["per_page"], ["7"])
        self.assertEqual(self.f.queries[-1]["base"], ["dev"])


if __name__ == "__main__":
    unittest.main()
