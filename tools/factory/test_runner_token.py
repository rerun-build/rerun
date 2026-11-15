import os, sys, tempfile, unittest, unittest.mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_loop as R


class RunnerToken(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.addCleanup(self.d.cleanup)
        self.path = os.path.join(self.d.name, "gh_token")

    def test_token_read_from_key_file_at_start(self):
        with open(self.path, "w") as f:
            f.write("tok-abc\n")
        with unittest.mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GH_TOKEN", None); os.environ.pop("FACTORY_GIT_TOKEN", None)
            R.load_token({"gh_token_file": self.path})
            self.assertEqual(os.environ["GH_TOKEN"], "tok-abc")
            self.assertEqual(os.environ["FACTORY_GIT_TOKEN"], "tok-abc")

    def test_missing_or_empty_file_stops_without_token(self):
        with self.assertRaises(RuntimeError) as c:
            R.load_token({"gh_token_file": self.path})
        self.assertIn(self.path, str(c.exception))
        open(self.path, "w").write(" \n")
        with self.assertRaises(RuntimeError) as c:
            R.load_token({"gh_token_file": self.path})
        self.assertIn("empty", str(c.exception))

    def test_default_path(self):
        with unittest.mock.patch("builtins.open", side_effect=FileNotFoundError(2, "No such file")) as o:
            with self.assertRaises(RuntimeError):
                R.load_token({})
        self.assertEqual(o.call_args[0][0], "/run/secrets/gh_token")


if __name__ == "__main__":
    unittest.main()
