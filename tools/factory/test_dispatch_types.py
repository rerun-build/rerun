import copy, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import briefs
import dispatch as D
from test_dispatch import World, PR_LINE, ready


def run(extra):
    with tempfile.TemporaryDirectory() as d:
        w = World()
        cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "auto_plan_marker": True,
               "ledger_file": os.path.join(d, "ledger.db"), "json_state_file": os.path.join(d, "dispatch.json"),
               "heartbeat_file": os.path.join(d, "heartbeat")}
        cfg.update(extra)
        w.ledger = cfg["ledger_file"]
        disp = D.Dispatcher(cfg, w.account, w.gh, now=lambda: w.clock)
        try:
            disp.once()
            w.finish("b1", PR_LINE)
            disp.once()
            disp.once()
        finally:
            disp.close()
        return [s[0] for s in w.sends]


class Types(unittest.TestCase):
    def test_the_shipped_settings_carry_one_main_per_type_with_one_coworker_behind_it(self):
        cfg = D.settings()
        for k in ("builders", "reviewers", "max_jobs"):
            self.assertNotIn(k, cfg)
        coder, rev = cfg["types"]["coder"], cfg["types"]["reviewer"]
        self.assertEqual({c["name"]: c["runs"] for c in coder["coworkers"]}, {"code": 6, "LARRY": 1})
        self.assertEqual({c["name"]: c["runs"] for c in rev["coworkers"]}, {"LINUS": 3, "BRUCE": 1})
        self.assertEqual([c["name"] for c in coder["coworkers"]], ["code", "LARRY"])
        self.assertEqual([c["name"] for c in rev["coworkers"]], ["LINUS", "BRUCE"])
        ids = [c["id"] for c in coder["coworkers"] + rev["coworkers"]]
        self.assertTrue(all(ids))
        self.assertEqual(len(set(ids)), 4)
        self.assertEqual({c["name"]: c["runs"] for c in cfg["types"]["researcher"]["coworkers"]}, {"search": 3})
        self.assertEqual({c["name"]: c["runs"] for c in cfg["types"]["designer"]["coworkers"]}, {"DIETER": 1})
        self.assertEqual(coder["max_jobs"], 8)

    def test_a_types_map_sends_the_build_and_the_review_to_the_first_free_coworker_of_the_type(self):
        def cw(ids):
            return [{"id": i, "name": i.upper(), "runs": 1} for i in ids]
        new = run({"types": {"coder": {"max_jobs": 8, "coworkers": cw(["b1", "b2"])}, "reviewer": {"coworkers": cw(["r1", "r2"])}}})
        old = run({"max_jobs": 8, "builders": [{"id": i, "name": i.upper()} for i in ("b1", "b2")],
                   "reviewers": [{"id": i, "name": i.upper()} for i in ("r1", "r2")]})
        self.assertEqual(new, ["b1", "r1"])
        self.assertEqual(new, old)

    def test_a_researcher_and_a_designer_issue_are_built_by_their_type_with_their_brief(self):
        def cw(i):
            return {"coworkers": [{"id": i, "name": i.upper(), "runs": 1}]}
        types = {"coder": dict(cw("b1"), max_jobs=8), "reviewer": cw("r1"), "researcher": dict(cw("s1"), max_jobs=8),
                 "designer": dict(cw("d1"), max_jobs=8)}
        issues = [{"number": n, "title": "T%d" % n, "comments": [],
                   "body": ready().replace("**Worker**: coder", "**Worker**: " + w)} for n, w in ((5, "researcher"), (6, "designer"), (7, "reviewer"))]
        with tempfile.TemporaryDirectory() as d:
            w = World(issues)
            cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "auto_plan_marker": True, "types": types,
                   "ledger_file": os.path.join(d, "ledger.db"), "json_state_file": os.path.join(d, "dispatch.json"),
                   "heartbeat_file": os.path.join(d, "heartbeat")}
            w.ledger = cfg["ledger_file"]
            disp = D.Dispatcher(cfg, w.account, w.gh, now=lambda: w.clock)
            try:
                disp.once()
                disp.once()
            finally:
                disp.close()
        sent = {a: m for a, m, _ in w.sends}
        self.assertEqual(sorted(sent), ["d1", "s1"])
        job = lambda n: {"issue": n, "title": "T%d" % n, "body": issues[n - 5]["body"], "extra": ""}
        self.assertIn(briefs.research_brief(job(5)), sent["s1"])
        self.assertIn(briefs.design_brief(job(6)), sent["d1"])
        for m in sent.values():
            self.assertEqual(m.count("Final state"), 1)
            self.assertIn("`PR: <url>` or `BLOCKED: <one sentence>`", m)
            self.assertTrue(m.endswith(D.TAIL))
        self.assertEqual(w.issue(7)["comments"], ["worker type reviewer has no queue yet (phase B of #198)"])

    def test_an_issue_is_taken_only_while_the_open_jobs_of_its_type_are_under_the_types_ceiling(self):
        types = {"coder": {"max_jobs": 1, "coworkers": [{"id": "b1", "name": "B1", "runs": 1}]},
                 "reviewer": {"coworkers": [{"id": "r1", "name": "R1", "runs": 1}]},
                 "researcher": {"max_jobs": 1, "coworkers": [{"id": "s1", "name": "S1", "runs": 1}]}}
        mk = lambda n, w: {"number": n, "title": "T", "comments": [], "body": ready().replace("**Worker**: coder", "**Worker**: " + w)}
        with tempfile.TemporaryDirectory() as d:
            w = World([mk(5, "coder"), mk(6, "researcher"), mk(8, "researcher")])
            cfg = {"repo": "o/r", "label": "factory", "checks_timeout_s": 3600, "types": types,
                   "ledger_file": os.path.join(d, "ledger.db"), "json_state_file": os.path.join(d, "dispatch.json"),
                   "heartbeat_file": os.path.join(d, "heartbeat")}
            w.ledger = cfg["ledger_file"]
            disp = D.Dispatcher(cfg, w.account, w.gh, now=lambda: w.clock)
            try:
                disp.once()
                taken = sorted(j["issue"] for j in disp.jobs())
            finally:
                disp.close()
        self.assertEqual(taken, [5, 6])

    def test_the_shipped_settings_name_search_as_researcher_and_dieter_as_designer(self):
        cfg = D.settings()
        self.assertEqual([c["name"] for c in cfg["types"]["researcher"]["coworkers"]], ["search"])
        self.assertEqual([c["name"] for c in cfg["types"]["designer"]["coworkers"]], ["DIETER"])
        for t, runs in (("researcher", 3), ("designer", 1)):
            c = cfg["types"][t]["coworkers"][0]
            self.assertEqual(c["runs"], runs)
            self.assertNotIn("id", c)
            self.assertEqual(cfg["types"][t]["max_jobs"], 8)

        def go(agents):
            calls = []
            with tempfile.TemporaryDirectory() as d:
                w = World([{"number": n, "title": "T", "comments": [], "body": ready().replace("**Worker**: coder", "**Worker**: " + t)}
                           for n, t in ((5, "researcher"), (6, "designer"))])
                c = copy.deepcopy(cfg)
                c.update(ledger_file=os.path.join(d, "ledger.db"), json_state_file=os.path.join(d, "dispatch.json"),
                         heartbeat_file=os.path.join(d, "heartbeat"))
                w.ledger = c["ledger_file"]

                def account(tool, args):
                    if tool == "list_agents":
                        calls.append(tool)
                        return {"agents": agents}
                    return w.account(tool, args)
                disp = D.Dispatcher(c, account, w.gh, now=lambda: w.clock)
                try:
                    disp.once()
                finally:
                    disp.close()
            return w, calls
        full = [{"id": "s-1", "handle": "search", "name": "search"}, {"id": "d-1", "handle": "dieter", "name": "DIETER"}]
        w, calls = go(full)
        self.assertEqual(sorted(s[0] for s in w.sends), ["d-1", "s-1"])
        with self.assertRaises(Exception) as e:
            go(full[:1])
        self.assertIn("DIETER", str(e.exception))
        c = {"repo": "o/r", "label": "factory", "types": {"coder": {"max_jobs": 1, "coworkers": [{"id": "b1", "name": "B1"}]}}}
        asked = []
        with tempfile.TemporaryDirectory() as d:
            c.update(ledger_file=os.path.join(d, "ledger.db"), json_state_file=os.path.join(d, "dispatch.json"))
            D.Dispatcher(c, lambda t, a: asked.append(t), lambda a: "[]").close()
        self.assertEqual(asked, [])


if __name__ == "__main__":
    unittest.main()
