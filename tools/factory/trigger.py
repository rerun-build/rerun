#!/usr/bin/env python3
import json, os, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E

CONFIG = os.path.join(HERE, "runner.json")
TRIGGERS = os.path.join(HERE, "triggers")
TOKENS_ENV, TOKENS_DEFAULT = "FACTORY_TRIGGER_TOKENS_FILE", "/state/trigger-tokens.json"
PROBE_WAIT_S, PROBE_POLL_S, PROBE_MAX_INPUT = 600, 15, 300000
RUN_KEYS = (("id", "id"), ("agent_id", "agentId"), ("session_id", "sessionId"), ("status", "status"),
            ("step_count", "stepCount"), ("started_at", "startedAt"), ("finished_at", "finishedAt"), ("error", "error"),
            ("input_tokens", "inputTokens"), ("output_tokens", "outputTokens"),
            ("cached_input_tokens", "cachedInputTokens"), ("trigger_source", "triggerSource"),
            ("trigger_slug", "triggerSlug"))


class TriggerError(Exception):
    pass


def load_config(path=None):
    with open(path or CONFIG, encoding="utf-8") as f:
        return json.load(f)


def tokens_path(cfg=None):
    return (cfg or {}).get("token_file") or os.environ.get(TOKENS_ENV) or TOKENS_DEFAULT


def _tkey(agent, slug):
    return "%s/%s" % (agent, slug)


def load_tokens(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        raise TriggerError("cannot read the token file (%s)" % type(e).__name__) from None
    if not isinstance(data, dict):
        raise TriggerError("the token file is not a JSON object")
    return {k: v for k, v in data.items() if isinstance(v, str) and v}


def save_tokens(path, tokens):
    d = os.path.dirname(os.path.abspath(path))
    try:
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tokens-", dir=d)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(tokens, f, sort_keys=True)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except OSError as e:
        raise TriggerError("cannot write the token file (%s)" % type(e).__name__) from None


def stage_body(stage):
    with open(os.path.join(TRIGGERS, stage + ".md"), encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n").strip()


def ensure_triggers(eng, cfg=None, stages=None):
    cfg = cfg if cfg is not None else load_config()
    path = tokens_path(cfg)
    tokens = load_tokens(path)
    listed = {}
    for e in cfg["triggers"]:
        if stages is not None and e["stage"] not in stages:
            continue
        agent, slug = e["agent"], e["slug"]
        if agent not in listed:
            listed[agent] = {t.get("slug"): t for t in eng.list_triggers(agent)}
        row = listed[agent].get(slug)
        if row is None:
            row = eng.create_trigger(agent, slug, stage_body(e["stage"]), model=e.get("model"))
            if row.get("slug") != slug:
                raise TriggerError("the engine derived another slug than %s from the trigger name" % slug)
            if e.get("model") and model_of(row) != e["model"]:
                row = dict(row, **eng.set_trigger_model(agent, slug, e["model"]))
                if model_of(row) != e["model"]:
                    raise TriggerError("trigger %s did not take the model" % slug)
            listed[agent][slug] = row
        if not row.get("token"):
            raise TriggerError("trigger %s has no token" % slug)
        tokens[_tkey(agent, slug)] = row["token"]
    save_tokens(path, tokens)
    return tokens


def fire(eng, agent, slug, token, payload):
    try:
        return eng.fire_trigger(agent, slug, token, payload)
    except E.EngineError as e:
        raise TriggerError(str(e)) from None


def map_run(row):
    if not isinstance(row, dict):
        return None
    return {snake: row.get(camel, row.get(snake)) for snake, camel in RUN_KEYS}


def read_run(eng, agent, run_id):
    return map_run(eng.get_run(agent, run_id))


def input_tokens(row):
    if row.get("input_tokens") is not None:
        return row["input_tokens"]
    try:
        return json.loads(row.get("usage_json") or "null")["inputTokens"]
    except (TypeError, KeyError, ValueError):
        return None


def model_of(row):
    m = row.get("model")
    return m if isinstance(m, str) and m not in ("", "null", "~") else None


def cmd_check_triggers(a, eng=None):
    entries = load_config()["triggers"]
    slugs = [e["slug"] for e in entries]
    live = {}
    bad = 0
    for e in entries:
        try:
            eng = eng or E.Engine()
            if e["agent"] not in live:
                live[e["agent"]] = {t.get("slug"): t for t in eng.list_triggers(e["agent"])}
            row = live[e["agent"]].get(e["slug"])
            ok = row is not None and (row.get("body") or "").replace("\r\n", "\n").strip() == stage_body(e["stage"]) \
                and model_of(row) == e.get("model")
        except Exception:
            ok = False
        bad += 0 if ok else 1
        label = e["slug"] if slugs.count(e["slug"]) == 1 else "%s %s" % (e["slug"], e["coworker"])
        print("%s %s" % (label, "OK" if ok else "DRIFT"))
    return 1 if bad else 0


def cmd_probe(a, eng=None):
    stage = a[a.index("--stage") + 1] if "--stage" in a[:-1] else ""
    cfg = load_config()
    entries = [e for e in cfg["triggers"] if e["stage"] == stage]
    if len(entries) != 1:
        print("usage: probe --stage STAGE (a stage with exactly one trigger in runner.json)")
        return 2
    e = entries[0]
    try:
        eng = eng or E.Engine()
        tokens = ensure_triggers(eng, cfg, stages=[stage])
        run_id, sid = fire(eng, e["agent"], e["slug"], tokens[_tkey(e["agent"], e["slug"])], {"v": 1, "stage": "probe"})
        end = time.time() + PROBE_WAIT_S
        while True:
            row = read_run(eng, e["agent"], run_id) or {}
            if row.get("status") not in (None, "running") or time.time() >= end:
                break
            time.sleep(PROBE_POLL_S)
    except (TriggerError, E.EngineError) as x:
        print("PROBE FAIL: %s" % x)
        return 1
    n, st = input_tokens(row), row.get("status")
    ok = st == "done" and n is not None and n < PROBE_MAX_INPUT
    print("%s %s %s input=%s%s" % ("PROBE OK" if ok else "PROBE FAIL", run_id, sid, "?" if n is None else n, "" if ok else " status=%s" % st))
    return 0 if ok else 1


CMDS = {"probe": cmd_probe, "check-triggers": cmd_check_triggers}


def main(argv):
    if not argv or argv[0] not in CMDS:
        print("commands: " + ", ".join(CMDS))
        return 2
    try:
        return CMDS[argv[0]](argv[1:])
    except Exception as e:
        print("FAILED (%s)" % type(e).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
