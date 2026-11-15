import os
import unittest

VPS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "vps")


def code():
    with open(os.path.join(VPS, "dev-engine-status.sh"), encoding="utf-8") as f:
        return "\n".join(l for l in f.read().splitlines() if not l.lstrip().startswith("#"))


class ProcessScanWithoutMask(unittest.TestCase):
    def test_scan_runs_in_the_plain_container_environment(self):
        c = code()
        self.assertNotIn("docker exec -e", c)
        self.assertIn("P8=$(docker exec \"$DEV\" sh -c '", c)


if __name__ == "__main__":
    unittest.main()
