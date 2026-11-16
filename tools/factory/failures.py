import hashlib, inspect

import cutshape

SOURCES = {}
ENDS = ("blocked", "rejected", "failed", "returned", "unsolvable")


def kinds(old, new, msg):
    msg = msg or ""
    out = []
    if msg.endswith("asked again"):
        out.append("asked again")
    if old == "proving" and (msg.startswith("proof failed") or "proof:" in msg):
        out.append("proof fail")
    if new in ENDS:
        out.append("ended %s" % new)
    elif new == "fix_wait":
        out.append("fix round")
    return out


def version(state):
    fns = SOURCES.get(state)
    if not fns:
        return None
    text = "".join(inspect.getsource(f) for f in fns)
    return hashlib.sha1(text.encode()).hexdigest()[:10]


def plan_run(store, j):
    parent = cutshape.parse({"number": j["issue"], "body": j.get("body")})["parent"]
    if parent is None:
        return None
    moves = store.transitions_of(str(j["issue"]))
    if not moves:
        return None
    row = store.db.execute(
        "SELECT run_id FROM fires WHERE job=? AND stage='plan' AND run_id IS NOT NULL AND intent_at<=? ORDER BY intent_at DESC, id DESC LIMIT 1",
        ("plan:%d" % parent, moves[0]["at"])).fetchone()
    return row[0] if row else None
