import gc, os, unittest, warnings

import test_factory as T

F = T.F


class Exclude(T.FactoryCase):
    def test_wt_new_leaves_no_open_handle_on_the_exclude_list(self):
        with warnings.catch_warnings(record=True) as seen:
            warnings.simplefilter("always")
            with T.clone_fakes(self):
                c1, _ = self.call(F.cmd_wt, ["new", "rerun", "7", "1"])
                c2, _ = self.call(F.cmd_wt, ["new", "rerun", "7", "2"])
            gc.collect()
        self.assertEqual((c1, c2), (0, 0))
        bad = [str(w.message) for w in seen if issubclass(w.category, ResourceWarning) and "exclude" in str(w.message)]
        self.assertEqual(bad, [])
        for chunk in ("1", "2"):
            with open(os.path.join(F.WT, T.REPO, "7-" + chunk, ".git", "info", "exclude")) as f:
                self.assertEqual(f.read().splitlines().count(".symforge/"), 1)
        path = os.path.join(self.clone, ".git", "info", "exclude")
        shared = open(path).read().splitlines() if os.path.exists(path) else []
        self.assertEqual(shared.count(".symforge/"), 0)


if __name__ == "__main__":
    unittest.main()
