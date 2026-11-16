#!/usr/bin/env python3
import json, os, urllib.error, urllib.parse, urllib.request

KEY_ENV, URL_ENV = "RERUN_DEV_ENGINE_KEY", "RERUN_DEV_ENGINE_URL"
TIMEOUT_S = 30


class EngineError(Exception):
    pass


def _q(s):
    return urllib.parse.quote(s, safe="")

def _scrub(path):
    return path.split("?", 1)[0]


class Engine:
    def __init__(self, base_url=None, key=None, urlopen=urllib.request.urlopen, timeout=TIMEOUT_S):
        self.base = (base_url or os.environ.get(URL_ENV) or "").rstrip("/")
        self._key = key if key is not None else os.environ.get(KEY_ENV, "")
        if not self.base:
            raise EngineError("%s is not set" % URL_ENV)
        if not self._key:
            raise EngineError("%s is not set" % KEY_ENV)
        self._urlopen, self._timeout = urlopen, timeout
        self.last_status = 0

    def __repr__(self):
        return "Engine(%s)" % self.base

    def _call(self, method, path, query=None, payload=None):
        url = self.base + path + ("?" + urllib.parse.urlencode(query) if query else "")
        headers = {"Authorization": "Bearer " + self._key, "Accept": "application/json"}
        data = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else (b"{}" if method == "POST" else None)
        if data:
            headers["Content-Type"] = "application/json"
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with self._urlopen(req, timeout=self._timeout) as r:
                code, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            e.close()
            raise EngineError("engine answered HTTP %d for %s %s" % (e.code, method, _scrub(path))) from None
        except Exception as e:
            raise EngineError("engine call failed (%s) for %s %s" % (type(e).__name__, method, _scrub(path))) from None
        try:
            body = json.loads(raw.decode() or "{}")
        except ValueError:
            raise EngineError("engine answered HTTP %d with a body that is not JSON" % code) from None
        if not isinstance(body, dict):
            raise EngineError("engine answered HTTP %d with an unexpected body" % code)
        self.last_status = code
        return body

    @staticmethod
    def _run_path(agent_id, run_id):
        return "/agents/%s/runs/%s" % (_q(agent_id), _q(run_id))

    def list_runs(self, agent_id, status=None, limit=50):
        query = {"limit": int(limit)}
        if status:
            query["status"] = status
        runs = self._call("GET", "/agents/%s/runs" % _q(agent_id), query).get("runs")
        if not isinstance(runs, list):
            raise EngineError("engine answered without a runs list")
        return runs

    def list_agents(self):
        agents = self._call("GET", "/agents").get("agents")
        if not isinstance(agents, list):
            raise EngineError("engine answered without an agents list")
        return agents

    def get_run(self, agent_id, run_id):
        try:
            return self._call("GET", self._run_path(agent_id, run_id))
        except EngineError as e:
            if "HTTP 404" in str(e):
                return None
            raise

    def run_steps(self, agent_id, run_id):
        steps = self._call("GET", self._run_path(agent_id, run_id) + "/steps").get("steps")
        if not isinstance(steps, list):
            raise EngineError("engine answered without a steps list")
        return steps

    def cancel(self, agent_id, run_id):
        return self._call("POST", self._run_path(agent_id, run_id) + "/cancel").get("ok") is True

    def list_triggers(self, agent_id):
        rows = self._call("GET", "/agents/%s/triggers" % _q(agent_id)).get("triggers")
        if not isinstance(rows, list):
            raise EngineError("engine answered without a triggers list")
        return rows

    def create_trigger(self, agent_id, name, body, model=None, provider=None, methods=None, description=""):
        payload = {"name": name, "description": description, "body": body, "provider": provider, "model": model}
        if methods:
            payload["methods"] = list(methods)
        row = self._call("POST", "/agents/%s/triggers" % _q(agent_id), payload=payload)
        if not row.get("slug") or not row.get("token"):
            raise EngineError("engine answered without a slug and token for the new trigger")
        return row

    def set_trigger_model(self, agent_id, slug, model):
        return self._call("PATCH", "/agents/%s/triggers/%s" % (_q(agent_id), _q(slug)), payload={"model": model})

    def fire_trigger(self, agent_id, slug, token, payload):
        fire = {"token": token, "method": "POST", "contentType": "application/json",
                "body": json.dumps(payload, separators=(",", ":"))}
        out = self._call("POST", "/agents/%s/triggers/%s/fire" % (_q(agent_id), _q(slug)), payload=fire)
        if self.last_status != 202 or not out.get("runId"):
            raise EngineError("engine answered HTTP %d without a run id for the trigger fire" % self.last_status)
        return out["runId"], out.get("sessionId")
