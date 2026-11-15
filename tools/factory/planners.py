import datetime
import json
import re

import pools

EVERY = 5
LABEL = "factory-plan"
MAX_PLANS = 5
MAX_RUNS = 8
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$")


def moment(text):
    return datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))


class Planners:
    def __init__(self, cfg, account, gh):
        planner = pools.types(cfg).get("planner") or {"coworkers": []}
        self.names = {c["id"]: c["name"] for c in planner["coworkers"]}
        self.account, self.gh, self.repo = account, gh, cfg["repo"]
        self.last = None

    def read(self, beat):
        if not self.names:
            return []
        if self.last is not None and beat % EVERY:
            return self.last
        try:
            self.last = self.fetch()
        except Exception:
            if self.last is None:
                self.last = []
        return self.last

    def runs(self):
        got = self.account("get_team_status", {})
        agents = (got.get("agents") if isinstance(got, dict) else None) or []
        out = []
        for a in agents:
            if not isinstance(a, dict) or a.get("id") not in self.names:
                continue
            for r in a.get("running") or []:
                started = r.get("startedAt") if isinstance(r, dict) else None
                if not r.get("runId") or not isinstance(started, str) or not ISO.match(started):
                    continue
                steps = r.get("steps")
                out.append({"id": str(a["id"])[:64], "name": str(a.get("name") or self.names[a["id"]])[:64],
                            "runId": str(r["runId"])[:64], "startedAt": started,
                            "steps": steps if isinstance(steps, int) and not isinstance(steps, bool) and steps >= 0 else None})
        return out[:MAX_RUNS]

    def children(self, parent):
        found = json.loads(self.gh(["issue", "list", "-R", self.repo, "--state", "all", "--search",
                                    "Part of #%d in:body" % parent, "--json", "number,createdAt,body", "--limit", "100"]))
        pattern = re.compile(r"Part of\W*#%d\b" % parent, re.I)
        return [i for i in found if i["number"] != parent and pattern.search(i.get("body") or "")]

    def fetch(self):
        runs = self.runs()
        parents = json.loads(self.gh(["issue", "list", "-R", self.repo, "--label", LABEL, "--state", "open",
                                      "--json", "number,title", "--limit", str(MAX_PLANS)]))
        since = min((moment(r["startedAt"]) for r in runs), default=None)
        out = []
        for p in sorted(parents, key=lambda p: p["number"])[:MAX_PLANS]:
            kids = self.children(p["number"])
            filed = [k for k in kids if since is not None and moment(k["createdAt"]) > since]
            out.append({"parent": p["number"], "title": str(p["title"])[:256], "coworkers": runs,
                        "children": len(kids), "filed": len(filed)})
        return out
