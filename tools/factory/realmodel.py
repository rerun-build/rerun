#!/usr/bin/env python3
import os, re, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E

NAME, PROBE, MODEL = "claude-plan", "real-model-probe", "claude-haiku-5-5"
MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]
TOKEN_KEY = "CLAUDE_CODE_OAUTH_TOKEN"
TOKEN_OK = re.compile(r"[A-Za-z0-9_.~+/=-]{20,}")
LONG = re.compile(r"[A-Za-z0-9_.~+/=-]{30,}")
PROMPT = "Reply with the single word READY and nothing else. Use no tools."
WAIT_S, STEP_S = 180, 3


def find(eng):
    listing = eng._call("GET", "/connections")
    conn = next((c for c in listing.get("connections") or [] if c.get("name") == NAME and c.get("provider") == "claude"), None)
    return conn, (listing.get("default") or {}).get("connectionId")


def check(eng):
    conn, default = find(eng)
    if not conn:
        return ["connection=absent default-is-real-model=no"]
    offered = sum(1 for m in MODELS if m in (conn.get("models") or []))
    return ["connection=present token-held=%s offers-models=%dof%d default-is-real-model=%s" % (
        "yes" if conn.get("connected") else "no", offered, len(MODELS), "yes" if default == conn["id"] else "no")]


def offer(eng, conn):
    have = list(conn.get("models") or [])
    missing = [m for m in MODELS if m not in have]
    if not missing:
        return []
    eng._call("PATCH", "/connections/%s" % E._q(conn["id"]), payload={"models": have + missing})
    return ["models=added %d" % len(missing)]


def connect(eng, token):
    token = (token or "").strip()
    if not TOKEN_OK.fullmatch(token):
        raise ValueError("the token is empty or does not look like a token; nothing was sent")
    conn, _ = find(eng)
    if conn:
        eng._call("PATCH", "/connections/%s/keys" % E._q(conn["id"]), payload={"set": {TOKEN_KEY: token}})
        return ["connection=updated"] + offer(eng, conn)
    eng._call("POST", "/connections", payload={"name": NAME, "provider": "claude", "models": list(MODELS), "keys": {TOKEN_KEY: token}})
    return ["connection=created"] + check(eng)


def probe(eng, model=MODEL, sleep=None):
    sleep = sleep or time.sleep
    conn, _ = find(eng)
    if not conn:
        raise RuntimeError("no %s connection yet: run connect first" % NAME)
    out = offer(eng, conn)
    agent = eng._call("POST", "/agents", payload={"config": {
        "name": PROBE, "description": "One-run proof that the real model answers (dev engine)",
        "connectionId": conn["id"], "provider": "claude", "model": model}})
    gone = "/agents/%s" % E._q(agent["id"])
    try:
        trig = eng.create_trigger(agent["id"], "probe", PROMPT)
        run_id, _ = eng.fire_trigger(agent["id"], trig["slug"], trig["token"], {})
        row, waited = {"status": "running"}, 0
        while row.get("status") == "running" and waited < WAIT_S:
            sleep(STEP_S)
            waited += STEP_S
            row = eng.get_run(agent["id"], run_id) or {"status": "missing"}
    except BaseException:
        try:
            eng._call("DELETE", gone)
        except E.EngineError:
            pass
        raise
    eng._call("DELETE", gone)
    err = LONG.sub("<cut>", row.get("error") or "")[:160]
    out.append("run=%s status=%s provider=%s model=%s input-tokens=%s output-tokens=%s%s%s" % (
        run_id, row.get("status"), row.get("provider"), row.get("model"), row.get("inputTokens"), row.get("outputTokens"),
        " timeout=yes" if row.get("status") == "running" else "", " error=%s" % err if err else ""))
    real = row.get("status") == "done" and row.get("provider") == "claude"
    out.append("proof=PASS" if real else "proof=FAIL: the run did not finish on the subscription connection (status %s, provider %s)" % (
        row.get("status"), row.get("provider")))
    return out


def remove(eng):
    conn, _ = find(eng)
    if not conn:
        return ["connection=absent"]
    eng._call("DELETE", "/connections/%s" % E._q(conn["id"]))
    return ["connection=removed"]


def main(argv=None, stdin=sys.stdin):
    a = list(sys.argv[1:] if argv is None else argv) or ["check"]
    try:
        eng = E.Engine()
        if a[0] == "check":
            out = check(eng)
        elif a[0] == "connect":
            out = connect(eng, stdin.readline())
        elif a[0] == "probe":
            out = probe(eng, *a[1:2])
        elif a[0] == "remove":
            out = remove(eng)
        else:
            print("usage: realmodel.py check|connect|probe [model]|remove", file=sys.stderr)
            return 2
    except (E.EngineError, ValueError, RuntimeError, KeyError) as e:
        print("realmodel %s failed: %s" % (a[0], "unexpected engine answer" if isinstance(e, KeyError) else e), file=sys.stderr)
        return 1
    for line in out:
        print(line)
    return 1 if out and out[-1].startswith("proof=FAIL") else 0


if __name__ == "__main__":
    sys.exit(main())
