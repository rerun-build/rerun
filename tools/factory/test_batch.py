import unittest
import batch


def chunk(name, builder="code", paths=None, deps=()):
    return {"job": "j", "chunk": name, "builder": builder, "paths": paths or [name + ".py"], "deps": list(deps), "attempts": 0}


class PickBatch(unittest.TestCase):
    def test_only_compatible_chunks(self):
        ready = [chunk("A"), chunk("B", paths=["A.py"]), chunk("C", builder="margaret"), chunk("D", deps=["X"]),
                 chunk("E"), chunk("F"), chunk("G")]
        got = batch.pick_batch(ready, {"cfg": {"builder_capacity": 3, "per_job_cap": 2}})
        self.assertEqual([c["chunk"] for c in got], ["A", "E", "F"])

    def test_none_when_no_slot(self):
        st = {"busy": [("k", "x")] * 3, "cfg": {"builder_capacity": 3}}
        self.assertEqual(batch.pick_batch([chunk("A")], st), [])


if __name__ == "__main__":
    unittest.main()
