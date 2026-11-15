import json

PLAN_LIMIT_HOLD_S = 30 * 60

KINDS = ("plan limit", "sign-in renewal")

_JOB = "-"
_PREFIX = "hold:"


def arm(st, kind, until):
    st.set(_JOB, _PREFIX + kind, json.dumps({"until": until}))


def clear(st, kind):
    arm(st, kind, 0)


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
