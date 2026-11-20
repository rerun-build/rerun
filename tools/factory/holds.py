import json

PLAN_LIMIT_HOLD_S = 30 * 60

KINDS = ("update", "plan limit", "plan week", "sign-in renewal", "disk", "load", "checkout")
SUBSCRIPTION_KINDS = ("plan limit", "plan week", "sign-in renewal")

_JOB = "-"
_PREFIX = "hold:"


def arm(st, kind, until):
    st.set(_JOB, _PREFIX + kind, json.dumps({"until": until}))


def clear(st, kind):
    arm(st, kind, 0)


def _rows(st):
    rows = {}
    for k, v in st.get_all(_JOB).items():
        if not k.startswith(_PREFIX):
            continue
        try:
            rows[k[len(_PREFIX):]] = json.loads(v)["until"]
        except (ValueError, KeyError, TypeError):
            continue
    return rows


def active_kinds(st, now):
    return {k for k, until in _rows(st).items() if until > now}


def blocks_all(st, now):
    return any(k not in SUBSCRIPTION_KINDS for k in active_kinds(st, now))


def blocks_subscription(st, now):
    return bool(active_kinds(st, now))


def active(st, now):
    rows = {}
    for k, v in st.get_all(_JOB).items():
        if not k.startswith(_PREFIX):
            continue
        try:
            rows[k[len(_PREFIX):]] = json.loads(v)["until"]
        except (ValueError, KeyError, TypeError):
            continue
    order = [k for k in KINDS if k in rows] + sorted(k for k in rows if k not in KINDS)
    for kind in order:
        if rows[kind] > now:
            return {"kind": kind, "until": rows[kind]}
    return None
