import unittest
import limits


class PacketCap(unittest.TestCase):
    def test_oversized_detected(self):
        self.assertFalse(limits.packet_oversize("a" * 4096))
        self.assertTrue(limits.packet_oversize("a" * 4097))
        self.assertTrue(limits.packet_oversize("a" * 101, {"packet_cap": 100}))
        self.assertTrue(limits.packet_oversize("a" * 51, None, 50))
        self.assertFalse(limits.packet_oversize("a" * 50, {"packet_cap": 100}, 50))

    def test_multibyte(self):
        s = "\u00e9" * 2049
        self.assertEqual(len(s), 2049)
        self.assertTrue(limits.packet_oversize(s))
        self.assertFalse(limits.packet_oversize("\u00e9" * 2048))


if __name__ == "__main__":
    unittest.main()
