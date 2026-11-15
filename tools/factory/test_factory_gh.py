import importlib, os, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory as F


class FactoryGh(unittest.TestCase):
    def load(self, env):
        with mock.patch.dict(os.environ, env):
            os.environ.pop("FACTORY_GH", None) if "FACTORY_GH" not in env else None
            return importlib.reload(F).GH

    def test_gh_path_from_environment(self):
        try:
            self.assertEqual(self.load({"FACTORY_GH": "gh"}), "gh")
            self.assertEqual(self.load({}), "/data/tools/bin/gh")
        finally:
            importlib.reload(F)


if __name__ == "__main__":
    unittest.main()
