import base64
import json
import os
import stat
import tempfile
import unittest

import apptoken as A


def part(s):
    return json.loads(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)))


class Jwt(unittest.TestCase):
    def test_the_jwt_names_the_app_and_lives_nine_minutes_from_a_minute_ago(self):
        seen = []
        token = A.jwt("5822204", 1000, lambda data: seen.append(data) or b"sig")
        head, body, sig = token.split(".")
        self.assertEqual(part(head), {"alg": "RS256", "typ": "JWT"})
        self.assertEqual(part(body), {"iat": 940, "exp": 1540, "iss": "5822204"})
        self.assertEqual(seen, [(head + "." + body).encode()])
        self.assertEqual(sig, base64.urlsafe_b64encode(b"sig").decode().rstrip("="))


class Mint(unittest.TestCase):
    def test_a_minted_token_comes_back_with_its_expiry(self):
        calls = []

        def post(url, headers):
            calls.append((url, headers))
            return 201, json.dumps({"token": "ghs_abc", "expires_at": "2026-11-18T21:00:00Z"})

        token, exp = A.mint("5822204", "183438800", 1000, lambda d: b"s", post)
        self.assertEqual((token, exp), ("ghs_abc", 1795035600))
        self.assertEqual(calls[0][0], "https://api.github.com/app/installations/183438800/access_tokens")
        self.assertTrue(calls[0][1]["Authorization"].startswith("Bearer "))

    def test_a_refused_mint_names_the_status_and_never_the_body(self):
        with self.assertRaises(A.Error) as e:
            A.mint("1", "2", 1000, lambda d: b"s", lambda u, h: (401, '{"message": "ghs_secret"}'))
        self.assertIn("401", str(e.exception))
        self.assertNotIn("ghs_secret", str(e.exception))


class File(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "token")

    def tearDown(self):
        self.dir.cleanup()

    def test_the_token_file_holds_token_and_expiry_and_is_readable_by_everyone(self):
        A.write(self.path, "ghs_abc", 5000)
        with open(self.path) as f:
            self.assertEqual(f.read(), "ghs_abc\n5000\n")
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o444)
        A.write(self.path, "ghs_def", 9000)
        self.assertEqual(A.read(self.path, 1000), "ghs_def")
        self.assertEqual(os.listdir(self.dir.name), ["token"])

    def test_a_token_is_used_only_until_five_minutes_before_its_expiry(self):
        A.write(self.path, "ghs_abc", 5000)
        self.assertEqual(A.read(self.path, 4699), "ghs_abc")
        self.assertIsNone(A.read(self.path, 4700))

    def test_a_missing_or_broken_file_gives_no_token(self):
        self.assertIsNone(A.read(self.path, 0))
        with open(self.path, "w") as f:
            f.write("ghs_abc\nsoon\n")
        self.assertIsNone(A.read(self.path, 0))


class Loop(unittest.TestCase):
    def test_the_next_mint_comes_fifteen_minutes_before_the_expiry_and_a_failure_retries_in_a_minute(self):
        self.assertEqual(A.wait_after(1000 + 3600, 1000), 2700)
        self.assertEqual(A.wait_after(None, 1000), 60)
        self.assertEqual(A.wait_after(1000 + 100, 1000), 60)

    def test_one_round_writes_the_token_and_a_failed_round_keeps_the_old_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "token")
            logs = []

            def bad():
                raise A.Error("mint refused: HTTP 401")

            self.assertEqual(A.round_once(path, lambda: ("ghs_new", 5000), logs.append), 5000)
            self.assertIsNone(A.round_once(path, bad, logs.append))
            self.assertEqual(A.read(path, 0), "ghs_new")
            self.assertTrue(all("ghs_" not in line for line in logs))


if __name__ == "__main__":
    unittest.main()
