import unittest

import renewal


WEEK = 7 * 86400


class Pace(unittest.TestCase):
    def test_behind_or_on_the_week_runs_at_full_speed(self):
        self.assertEqual(renewal.pace(30, 95, 0.5 * WEEK, 0), 1.0)
        self.assertEqual(renewal.pace(0, 95, 0.1 * WEEK, 0), 1.0)

    def test_ahead_of_the_week_spreads_what_is_left_over_the_time_left(self):
        self.assertAlmostEqual(renewal.pace(68, 95, 0.694 * WEEK, 0), (27 / 95) / 0.694, places=6)

    def test_at_or_past_the_mark_it_is_zero(self):
        self.assertEqual(renewal.pace(95, 95, 0.5 * WEEK, 0), 0.0)
        self.assertEqual(renewal.pace(99, 95, 0.5 * WEEK, 0), 0.0)

    def test_without_a_reading_it_does_not_pace(self):
        for used, mark, resets in ((None, 95, WEEK), (50, None, WEEK), (50, 95, None), (50, 95, -1)):
            self.assertEqual(renewal.pace(used, mark, resets, 0), 1.0)


class Renewal(unittest.TestCase):
    def test_only_the_default_connection_decides_and_a_bad_answer_never_holds(self):
        def c(minutes, default, i="x"):
            sign_in = None if minutes is None else {
                "minutesLeft": minutes, "renewalDue": minutes < 60}
            return {"id": i, "provider": "claude", "isDefault": default,
                    "signIn": sign_in}

        a = {"connections": [c(200, True, "a"), c(0, False, "b")]}
        self.assertEqual(renewal.left(a), 200)
        self.assertFalse(renewal.due(a, 50))
        for minutes, expect in ((40, True), (50, True), (51, False)):
            a = {"connections": [c(minutes, True, "a"), c(200, False, "b")]}
            self.assertEqual(renewal.left(a), minutes)
            self.assertEqual(renewal.due(a, 50), expect)
        a = {"connections": [c(None, True, "a"), c(10, False, "b")]}
        self.assertIsNone(renewal.left(a))
        self.assertFalse(renewal.due(a, 50))
        a = {"connections": [c(10, False, "a"), c(5, False, "b")]}
        self.assertIsNone(renewal.left(a))
        self.assertFalse(renewal.due(a, 50))
        for bad in (None, [], {}, {"connections": "x"}):
            self.assertIsNone(renewal.left(bad))
            self.assertFalse(renewal.due(bad, 50))


if __name__ == "__main__":
    unittest.main()
