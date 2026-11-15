import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate as G

HEAD = "c" * 40


class GateStatus(unittest.TestCase):
    def test_posts_status_at_head(self):
        calls = []
        G.LAST.update(full="o/r", head=HEAD)
        G.post_status(0, lambda *a: calls.append(a))
        G.post_status(3, lambda *a: calls.append(a))
        self.assertEqual(calls[0], ("o/r", HEAD, "success", "factory/review", "gate PASS @cccccccc"))
        self.assertEqual(calls[1][2], "failure")
        G.LAST.clear()
        G.post_status(0, lambda *a: calls.append(a))
        self.assertEqual(len(calls), 2)
        G.post_status(0, lambda *a: 1 / 0)
        G.post_status(1, lambda *a: calls.append(a))
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
