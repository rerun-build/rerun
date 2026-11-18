import json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import factory as F
import toolsupdate


class RepoName(unittest.TestCase):
    def test_the_factory_names_the_repository_by_the_name_search_finds(self):
        with open(os.path.join(HERE, "dispatch.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["repo"], "special-place-ai-heaven/moldwright")
        self.assertEqual(F.home(), "special-place-ai-heaven/moldwright")
        self.assertEqual(toolsupdate.FULL, "special-place-ai-heaven/moldwright")

    def test_both_names_keep_the_folders_they_had_before_the_rename(self):
        self.assertEqual(F.short("special-place-ai-heaven/moldwright"), "rerun")
        self.assertEqual(F.short("special-place-ai-heaven/rerun"), "rerun")
        self.assertEqual(F.short("special-place-ai-heaven/testpilot"), "testpilot")


if __name__ == "__main__":
    unittest.main()
