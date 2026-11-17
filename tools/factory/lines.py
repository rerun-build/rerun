import json
import os
import re
import time

import states

END = states.END
REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9_.-]{1,100}$")


def ledger_path(cfg, repo):
    if repo == cfg["repo"]:
        return cfg["ledger_file"]
    return os.path.join(os.path.dirname(cfg["ledger_file"]), "ledger-%s.db" % repo.replace("/", "--"))


def line_cfg(cfg, repo):
    if repo == cfg["repo"]:
        return cfg
    path = ledger_path(cfg, repo)
    return dict(cfg, repo=repo, home=cfg["repo"], ledger_file=path, json_state_file=path + ".json")


def live(d):
    return [j for j in d.jobs() if j["state"] != "waiting" and (j["state"] not in END or not j.get("relabelled"))]


class Lines:
    def __init__(self, cfg, account, gh, now=time.time, make=None, mod=None):
        self.cfg, self.now, self.home = cfg, now, cfg["repo"]
        self.mod = mod or __import__("dispatch")
        self.make = make or (lambda c: self.mod.Dispatcher(c, account, gh, now))
        self.lines, self.said, self.last = {}, set(), None
        self.kv = self.open(self.home).store
        self.active = self.home
        saved = self.read("project", {})
        for repo in [saved.get("repo")] + list(self.read("finishing", [])):
            if isinstance(repo, str) and REPO.match(repo) and repo not in self.lines:
                try:
                    self.open(repo)
                except Exception as e:
                    self.problem("project %s not opened: %s" % (repo, e if isinstance(e, RuntimeError) else type(e).__name__))
        if saved.get("repo") in self.lines:
            self.active, self.last = saved["repo"], saved
        self.roles()

    def read(self, key, default):
        try:
            got = json.loads(self.kv.get_all("-").get(key) or "null")
        except ValueError:
            return default
        return got if isinstance(got, type(default)) else default

    def open(self, repo):
        self.lines[repo] = self.make(line_cfg(self.cfg, repo))
        return self.lines[repo]

    def roles(self):
        for repo, d in self.lines.items():
            d.taking = d.reporting = repo == self.active
            d.others = (lambda me: lambda: [p for r, x in self.lines.items() if r != me for p in x.own()])(repo)
            d.extra = self.extra if repo == self.active else dict

    def finishing(self):
        return [(r, len(live(d))) for r, d in self.lines.items() if r != self.active and live(d)]

    def extra(self):
        out = {"home": self.home, "finishing": [{"repo": r, "jobs": n} for r, n in self.finishing()][:10]}
        if self.last:
            out["switch"] = self.last
        return out

    def problem(self, text):
        if text not in self.said:
            self.said.add(text)
            self.mod.log("-", text)

    def ready(self, repo):
        return repo == self.home or self.read("ready:" + repo, {}).get("passed") is True

    def once(self):
        self.lines[self.active].once()
        for repo in [r for r in self.lines if r != self.active]:
            if live(self.lines[repo]):
                self.lines[repo].once()
            elif repo != self.home:
                self.lines.pop(repo).close()
        self.kv.set("-", "finishing", json.dumps([r for r, _ in self.finishing()]))
        self.learn(self.lines[self.active].answer)

    def learn(self, answer):
        if answer is None or (isinstance(answer, dict) and answer.get("project") is None):
            return
        p = answer.get("project") if isinstance(answer, dict) else None
        repo = p.get("repo") if isinstance(p, dict) else None
        if not isinstance(repo, str) or not REPO.match(repo):
            return self.problem("project answer not understood: the factory stays on %s" % self.active)
        if repo == self.active:
            return
        if not self.ready(repo):
            return self.problem("project %s not taken: its readiness is not recorded as passed here; the factory stays on %s" % (repo, self.active))
        try:
            if repo not in self.lines:
                self.open(repo)
        except Exception as e:
            return self.problem("project %s not taken: %s; the factory stays on %s" % (repo, e if isinstance(e, RuntimeError) else type(e).__name__, self.active))
        old, self.active = self.active, repo
        self.last = {"repo": repo, "from": old, "by": str(p.get("by") or "")[:100], "at": self.mod.iso(self.now())}
        self.roles()
        self.kv.set("-", "project", json.dumps(self.last))
        self.kv.add_event("project", old, json.dumps(self.last))
        self.said.clear()
        self.mod.log("project", "%s -> %s by %s; finishing %d jobs of %s" % (old, repo, self.last["by"] or "?", len(live(self.lines[old])), old))

    @property
    def refresh_to(self):
        return self.lines[self.active].refresh_to

    def close(self):
        for d in self.lines.values():
            d.close()
