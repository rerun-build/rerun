import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import holds
import store
import timeline as T

D = "2026-11-13T"


def at(hm):
    return D + hm + ":00Z"


class Timeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "ledger.db")
        self.st = store.Store(self.path)
        self.addCleanup(self._close)

    def _close(self):
        try:
            self.st.close()
        except Exception:
            pass

    def test_gantt_from_a_real_ledger(self):
        for state, hm in (("queued", "18:06"), ("building", "18:06"), ("review_wait", "18:08"), ("merged", "18:16")):
            self.st.put_job("171", state, {}, at=at(hm))
        rows = T.read_rows(self.path)
        out = T.gantt(rows, T.parse(at("18:30")), T.parse(at("00:00")))
        self.assertEqual(out, "\n".join([
            "```mermaid",
            "gantt",
            "    title Factory jobs, times in UTC",
            "    dateFormat HH:mm",
            "    axisFormat %H:%M",
            "    section 171",
            "    171 queued :done, 18:06, 18:06",
            "    171 building :done, 18:06, 18:08",
            "    171 review_wait :done, 18:08, 18:16",
            "    171 merged :18:16, 18:30",
            "```"]))

    def test_status_reads_while_the_store_holds_its_lock(self):
        self.st.put_job("171", "building", {}, at=at("18:00"))
        self.st.put_job("172", "queued", {"waiting": [171]}, at=at("18:05"))
        lines = T.status_lines(T.read_rows(self.path), T.parse(at("18:10")))
        self.assertEqual(lines[0], "#171 building for 10 min | pr - | no waits")
        self.assertEqual(lines[1], "#172 queued for 5 min | pr - | waits on #171 for 5 min")

    def test_status_shows_the_reason_of_a_waiting_job(self):
        self.st.put_job("171", "building", {}, at=at("18:00"))
        self.st.put_job("172", "queued", {"waiting": [171], "wait_reason": "dependency"}, at=at("18:05"))
        self.st.put_job("173", "review_wait", {"wait_reason": "plan limit"}, at=at("18:05"))
        lines = T.status_lines(T.read_rows(self.path), T.parse(at("18:10")))
        self.assertEqual(lines, [
            "#171 building for 10 min | pr - | no waits",
            "#172 queued for 5 min | pr - | waits on #171 for 5 min | reason: dependency",
            "#173 review_wait for 5 min | pr - | no waits | reason: plan limit"])

    def test_status_says_when_sending_is_held(self):
        self.st.put_job("172", "queued", {}, at=at("18:05"))
        holds.arm(self.st, "plan limit", T.parse(at("18:40")))
        rows = T.read_rows(self.path)
        job = "#172 queued for 5 min | pr - | no waits"
        self.assertEqual(T.status_lines(rows, T.parse(at("18:10"))),
                         ["sending held: plan limit until 18:40 UTC", job])
        self.assertEqual(T.status_lines(rows, T.parse(at("18:41"))), ["#172 queued for 36 min | pr - | no waits"])
        holds.clear(self.st, "plan limit")
        self.assertEqual(T.status_lines(T.read_rows(self.path), T.parse(at("18:10"))), [job])
        bare = {"jobs": rows["jobs"], "transitions": rows["transitions"]}
        self.assertEqual(T.status_lines(bare, T.parse(at("18:10"))), [job])

    def test_status_names_who_runs_a_job(self):
        self.st.intent("171", "", "build", coworker="code", at=at("18:00"))
        self.st.put_job("171", "building", {"agent": "a1", "copy": 2}, at=at("18:00"))
        self.st.intent("172", "", "build", coworker="LARRY", at=at("17:50"))
        self.st.put_job("172", "review_wait", {}, at=at("18:05"))
        self.st.intent("173", "", "build", coworker="code", at=at("17:40"))
        self.st.intent("173", "", "review", coworker="LINUS", at=at("18:02"))
        self.st.put_job("173", "reviewing", {"agent": "a3"}, at=at("18:02"))
        rows = T.read_rows(self.path)
        now = T.parse(at("18:10"))
        self.assertEqual(T.status_lines(rows, now), [
            "#171 building for 10 min | pr - | no waits | run on code, copy 2",
            "#172 review_wait for 5 min | pr - | no waits",
            "#173 reviewing for 8 min | pr - | no waits | run on LINUS, copy 1"])
        del rows["fires"]
        self.assertEqual(T.status_lines(rows, now), [
            "#171 building for 10 min | pr - | no waits",
            "#172 review_wait for 5 min | pr - | no waits",
            "#173 reviewing for 8 min | pr - | no waits"])

    def test_status_shows_each_feature_and_its_acceptance(self):
        self.st.put_job("51", "merged", {"body": "**Part of**: #50\n"}, at=at("18:00"))
        self.st.put_job("52", "building", {"body": "**Part of**: #50\n"}, at=at("18:00"))
        self.st.put_job("61", "merged", {"body": "**Part of**: #60\n"}, at=at("18:00"))
        self.st.set("accept:60", "state", "running")
        self.st.set("accept:60", "name", "BARBARA")
        self.st.set("accept:60", "started", T.parse(at("18:02")))
        now = T.parse(at("18:10"))
        rows = T.read_rows(self.path)
        self.assertEqual(T.status_lines(rows, now)[:2], [
            "feature #50: 1 of 2 jobs done | acceptance waits on #52",
            "feature #60: 1 of 1 jobs done | acceptance running on BARBARA for 8 min"])
        bare = {"jobs": rows["jobs"], "transitions": rows["transitions"]}
        self.assertEqual(T.status_lines(bare, now)[1], "feature #60: 1 of 1 jobs done | acceptance not sent yet")
        self.st.set("accept:60", "started", "x")
        self.assertTrue(T.status_lines(T.read_rows(self.path), now)[1].startswith(
            "feature #60: 1 of 1 jobs done | acceptance running on BARBARA for "))

    def test_end_states_listed_for_24_hours_and_crit_bars(self):
        self.st.put_job("1", "blocked", {}, reason="old", at="2026-11-10T10:00:00Z")
        self.st.put_job("2", "failed", {}, reason="boom", at=at("10:00"))
        self.st.put_job("3", "waiting", {}, at=at("10:00"))
        self.st.put_job("3", "waiting", {}, at=at("10:02"))
        rows = T.read_rows(self.path)
        now = T.parse(at("11:00"))
        lines = T.status_lines(rows, now)
        self.assertEqual(lines, ["#3 waiting for 60 min | pr - | no waits", "#2 failed: boom"])
        g = T.gantt(rows, now, now - 24 * 3600)
        self.assertIn("    2 failed :crit, 10:00, 11:00", g)
        self.assertIn("    3 waiting :crit, 10:00, 11:00", g)


if __name__ == "__main__":
    unittest.main()
