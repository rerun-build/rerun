import json, os, re, time, unittest
from unittest import mock

import machine
from test_dispatch import Base

REPO = "o/r"
NOW = 1763600000.0
SHA = "a" * 40
SHAPE = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-")
ISO = "%Y-%m-%dT%H:%M:%SZ"
NAMES = ["tools_dev_commit", "dispatcher_commit", "api_remaining", "api_reset_at", "runs_queued", "runs_running",
         "queue_wait_oldest_s", "image_commit", "image_build"]


def iso(t):
    return time.strftime(ISO, time.gmtime(t))


def route(path, over):
    for key, body in over.items():
        if key in path:
            return body
    if "rate_limit" in path:
        return {"resources": {"core": {"remaining": 4000, "reset": NOW + 1800}}}
    if "path=tools/factory" in path:
        return [{"sha": "b" * 40}]
    if "path=apps" in path:
        return [{"sha": "c" * 40, "commit": {"committer": {"date": iso(NOW - 60)}}}]
    if "path=packages" in path:
        return [{"sha": "d" * 40, "commit": {"committer": {"date": iso(NOW - 120)}}}]
    if "status=queued" in path:
        return {"total_count": 2, "workflow_runs": [{"created_at": iso(NOW - 7200)}, {"created_at": iso(NOW - 60)}]}
    if "status=in_progress" in path:
        return {"total_count": 1, "workflow_runs": [{"created_at": iso(NOW - 30)}]}
    if "head_sha=" in path:
        return {"total_count": 1, "workflow_runs": [
            {"name": "Images", "created_at": iso(NOW - 60), "status": "completed", "conclusion": "success"}]}
    return {}


class Gh:
    def __init__(self, over=None, fail=None):
        self.over, self.fail, self.calls = over or {}, fail or {}, []

    def __call__(self, args):
        path = args[1]
        self.calls.append(path)
        for key, exc in self.fail.items():
            if key in path:
                raise exc
        return json.dumps(route(path, self.over))


def by_name(rows):
    return {r["name"]: r for r in rows}


class Own(unittest.TestCase):
    def test_the_readings_come_in_order_from_the_dispatcher(self):
        rows = machine.own(Gh(), REPO, NOW, SHA)
        self.assertEqual([r["name"] for r in rows], NAMES)
        self.assertTrue(all(r["source"] == "dispatcher" for r in rows))
        got = {r["name"]: r["value"] for r in rows}
        self.assertEqual(got["tools_dev_commit"], "b" * 40)
        self.assertEqual(got["dispatcher_commit"], SHA)
        self.assertEqual(got["api_remaining"], 4000)
        self.assertEqual(got["api_reset_at"], iso(NOW + 1800))
        self.assertEqual(got["runs_queued"], 2)
        self.assertEqual(got["runs_running"], 1)
        self.assertEqual(got["queue_wait_oldest_s"], 7200)
        self.assertEqual(got["image_commit"], "c" * 40)
        self.assertEqual(got["image_build"], "green")

    def test_dispatcher_commit_is_null_when_unset(self):
        self.assertIsNone(by_name(machine.own(Gh(), REPO, NOW, None))["dispatcher_commit"]["value"])

    def test_a_failed_reading_is_null_with_its_class_name_and_the_rest_stay(self):
        by = by_name(machine.own(Gh(fail={"status=queued": OSError("x")}), REPO, NOW, None))
        self.assertIsNone(by["runs_queued"]["value"])
        self.assertEqual(by["runs_queued"]["reason"], "OSError")
        self.assertIsNone(by["queue_wait_oldest_s"]["value"])
        self.assertEqual(by["queue_wait_oldest_s"]["reason"], "OSError")
        self.assertEqual(by["runs_running"]["value"], 1)
        self.assertEqual(by["image_build"]["value"], "green")

    def test_the_calls_stay_within_eight_and_none_repeats(self):
        g = Gh()
        machine.own(g, REPO, NOW, SHA)
        self.assertLessEqual(len(g.calls), 8)
        self.assertEqual(len(g.calls), len(set(g.calls)))

    def test_own_asks_again_only_after_ten_minutes(self):
        self.assertEqual(machine.OWN_EVERY_S, 600)
        g, o = Gh(), machine.Own()
        o.get(g, REPO, NOW, SHA)
        n = len(g.calls)
        o.get(g, REPO, NOW + 599, SHA)
        self.assertEqual(len(g.calls), n)
        o.get(g, REPO, NOW + 600, SHA)
        self.assertEqual(len(g.calls), 2 * n)

    def test_the_readings_carry_no_token_shape(self):
        over = {"rate_limit": {"resources": {"core": {"remaining": 4000, "reset": NOW + 1800, "token": "ghp_" + "A" * 36}}}}
        self.assertNotRegex(json.dumps(machine.own(Gh(over=over), REPO, NOW, SHA)), SHAPE)

    def test_image_build_states(self):
        cases = {
            "green": {"total_count": 1, "workflow_runs": [{"name": "Images", "created_at": iso(NOW), "status": "completed", "conclusion": "success"}]},
            "red": {"total_count": 1, "workflow_runs": [{"name": "Images", "created_at": iso(NOW), "status": "completed", "conclusion": "failure"}]},
            "running": {"total_count": 1, "workflow_runs": [{"name": "Images", "created_at": iso(NOW), "status": "in_progress", "conclusion": None}]},
            "none": {"total_count": 0, "workflow_runs": []},
        }
        for want, body in cases.items():
            by = by_name(machine.own(Gh(over={"head_sha=": body}), REPO, NOW, SHA))
            self.assertEqual(by["image_build"]["value"], want)


class Beat(Base):
    def setUp(self):
        super().setUp()
        self.w.report_answer = {}
        self.p = os.path.join(self.dir.name, "machine.json")
        env = mock.patch.dict(os.environ, {machine.ENV: self.p, "FACTORY_CODE_SHA": SHA})
        env.start()
        self.addCleanup(env.stop)
        with open(self.p, "w") as f:
            json.dump({"madeAt": "2026-11-20T02:00:00Z", "engine": "running",
                       "readings": [{"name": "load_1", "value": 1.0, "reason": None}]}, f)
        os.utime(self.p, (self.w.clock, self.w.clock))

    def test_the_beat_adds_the_dispatcher_readings_after_the_keeper_rows(self):
        self.tick()
        rows = self.w.reports[-1]["machine"]["readings"]
        self.assertEqual(rows[0]["name"], "load_1")
        self.assertIn("tools_dev_commit", [r["name"] for r in rows if r["source"] == "dispatcher"])
