import json

LIMIT = 2
HOLD_S = 600

_JOB = "-"
_PREFIX = "strike:"


def _row(st, agent):
    try:
        row = json.loads(st.get_all(_JOB).get(_PREFIX + agent) or "null")
    except ValueError:
        row = None
    return row if isinstance(row, dict) else {"n": 0, "until": 0, "why": None}


def _put(st, agent, row):
    st.set(_JOB, _PREFIX + agent, json.dumps(row))


def fail(st, agent, now, limit=LIMIT, hold_s=HOLD_S):
    row = _row(st, agent)
    n = int(row.get("n") or 0) + 1
    row["n"] = n
    held = n >= limit
    if held:
        row["until"] = now + hold_s
        row["why"] = "%d failed runs in a row" % n
    _put(st, agent, row)
    return row["until"] if held else None


def ok(st, agent):
    row = _row(st, agent)
    if not row.get("n"):
        return
    _put(st, agent, {"n": 0, "until": 0, "why": None})


def held(st, now):
    rows = {}
    for k, v in st.get_all(_JOB).items():
        if not k.startswith(_PREFIX):
            continue
        try:
            row = json.loads(v)
            if row["until"] > now:
                rows[k[len(_PREFIX):]] = row
        except (ValueError, KeyError, TypeError):
            continue
    return rows
