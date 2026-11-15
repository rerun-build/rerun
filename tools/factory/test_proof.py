import unittest

import proof

HEAD = "abcdef1234567890"

BODY = (
    "intro\r\n"
    "**Change**\r\n"
    "- first ask,\r\n"
    "  continuation line\r\n"
    "  - nested sub-bullet\r\n"
    "* second ask\r\n"
    "**Corrections**\r\n"
    "- a correction\r\n"
    "**Depends on**: none\r\n"
    "**Done-test** (written first)\r\n"
    "- one\r\n"
    "- two\r\n"
    "**Run**\r\n"
    "```\r\n"
    "cd a && run1\r\n"
    "\r\n"
    "cd b && run2\r\n"
    "```\r\n"
    "```\r\n"
    "ignored fence\r\n"
    "```\r\n"
)


def met(n):
    return "ASK %d: MET f.py:%d test_x" % (n, n)


class Asks(unittest.TestCase):
    def test_reads_all_sections(self):
        self.assertEqual(
            proof.asks(BODY),
            ["first ask,", "second ask", "a correction", "Done-test", "cd a && run1", "cd b && run2"],
        )

    def test_empty(self):
        self.assertEqual(proof.asks("no sections here\n- a bullet"), [])
        self.assertEqual(proof.asks(None), [])


class Judge(unittest.TestCase):
    def test_pass(self):
        out = "\n".join([met(1), met(2), met(3), "PROOF: PASS @abcdef1"])
        self.assertEqual(proof.judge(out, 3, HEAD), ("pass", None))
        out = "\n".join([met(1), "PROOF: PASS @" + HEAD])
        self.assertEqual(proof.judge(out, 1, HEAD), ("pass", None))

    def test_count_mismatch(self):
        two = "\n".join([met(1), met(2), "PROOF: PASS @abcdef1"])
        four = "\n".join([met(1), met(2), met(3), met(4), "PROOF: PASS @abcdef1"])
        self.assertEqual(proof.judge(two, 3, HEAD), ("fail", "PASS names 2 of the 3 asks"))
        self.assertEqual(proof.judge(four, 3, HEAD), ("fail", "PASS names 4 of the 3 asks"))
        bare = "ASK 1: MET\nPROOF: PASS @abcdef1"
        self.assertEqual(proof.judge(bare, 1, HEAD), ("fail", "PASS names 0 of the 1 asks"))

    def test_not_met_and_fail(self):
        out = "\n".join([met(1), "ASK 2: NOT MET no test", met(3), "PROOF: PASS @abcdef1"])
        self.assertEqual(proof.judge(out, 3, HEAD), ("fail", "PASS with asks not met: 2"))
        self.assertEqual(proof.judge("PROOF: FAIL @abcdef1: 1, 3", 3, HEAD), ("fail", "1, 3"))

    def test_wrong_commit(self):
        self.assertEqual(
            proof.judge("PROOF: PASS @1234567", 1, HEAD),
            ("none", "proof names 1234567, the head is abcdef1"),
        )

    def test_missing_line(self):
        self.assertEqual(proof.judge("nothing", 1, HEAD), ("none", "no PROOF line"))
        self.assertEqual(
            proof.judge("PROOF: PASS", 1, HEAD),
            ("none", "proof names no commit, the head is abcdef1"),
        )
        self.assertEqual(proof.judge("PROOF: nothing to say", 1, HEAD), ("none", "no PROOF line"))

    def test_at_names_the_commit(self):
        self.assertEqual(proof.judge(met(1) + "\nPROOF: PASS at abcdef1", 1, HEAD), ("pass", None))
        self.assertEqual(proof.judge("PROOF: FAIL at abcdef1: 1, 3", 3, HEAD), ("fail", "1, 3"))
        self.assertEqual(
            proof.judge("PROOF: PASS at 1234567", 1, HEAD),
            ("none", "proof names 1234567, the head is abcdef1"),
        )
        self.assertEqual(
            proof.judge("PROOF: FAIL", 1, HEAD),
            ("none", "proof names no commit, the head is abcdef1"),
        )


if __name__ == "__main__":
    unittest.main()
