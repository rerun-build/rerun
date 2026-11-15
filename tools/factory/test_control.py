import unittest

import control

BOUNDS = {"settable": ["copies", "wip"], "copies": {"code": 8, "LARRY": 2}, "wip": {"building": 12}}
BASE = {"copies": {"code": 6, "LARRY": 1}, "wip": {}}


class Parse(unittest.TestCase):
    def test_first_block_is_read(self):
        body = 'text\n```json\n{"a": 1}\n```\nmore\n```json\n{"b": 2}\n```\n'
        self.assertEqual(control.parse(body), ({"a": 1}, []))

    def test_no_block(self):
        self.assertEqual(control.parse("plain text"), (None, []))
        self.assertEqual(control.parse(None), (None, []))

    def test_does_not_parse(self):
        self.assertEqual(
            control.parse("```json\n{oops\n```"),
            (None, ["the json block does not parse"]),
        )

    def test_not_an_object(self):
        self.assertEqual(
            control.parse("```json\n[1]\n```"),
            (None, ["the json block is not an object"]),
        )


class Validate(unittest.TestCase):
    def run_block(self, block, last=None):
        return control.validate(block, BOUNDS, BASE, last)

    def test_empty_block_gives_base(self):
        self.assertEqual(self.run_block({}), (BASE, []))

    def test_valid_values_replace_base(self):
        block = {"copies": {"code": 8, "LARRY": 2}, "wip": {"building": 3}}
        effective, errors = self.run_block(block)
        self.assertEqual(effective, {"copies": {"code": 8, "LARRY": 2}, "wip": {"building": 3}})
        self.assertEqual(errors, [])

    def test_zero_is_valid(self):
        effective, errors = self.run_block({"copies": {"code": 0}})
        self.assertEqual(effective["copies"]["code"], 0)
        self.assertEqual(errors, [])

    def test_over_bound_falls_back_to_last(self):
        effective, errors = self.run_block(
            {"copies": {"code": 9}}, {"copies": {"code": 7}}
        )
        self.assertEqual(effective["copies"]["code"], 7)
        self.assertEqual(errors, ["copies.code: 9 is not a whole number from 0 to 8"])

    def test_bad_values_fall_back_to_base(self):
        for value in (-1, 1.5, True, "3", None):
            effective, errors = self.run_block({"copies": {"code": value}})
            self.assertEqual(effective["copies"]["code"], 6)
            self.assertEqual(len(errors), 1)

    def test_one_bad_name_keeps_the_good_one(self):
        effective, errors = self.run_block({"copies": {"code": 99, "LARRY": 2}})
        self.assertEqual(effective["copies"], {"code": 6, "LARRY": 2})
        self.assertEqual(len(errors), 1)

    def test_unknown_name_and_key(self):
        effective, errors = self.run_block(
            {"copies": {"ghost": 1}, "weights": {"P0": 8}}
        )
        self.assertEqual(effective, BASE)
        self.assertEqual(
            errors,
            [
                "copies.ghost: no bound for it",
                "weights: the control block may not set this key",
            ],
        )

    def test_value_not_an_object(self):
        effective, errors = self.run_block({"copies": 3})
        self.assertEqual(effective, BASE)
        self.assertEqual(errors, ["copies: must be an object"])


if __name__ == "__main__":
    unittest.main()
