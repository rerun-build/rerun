import math
import limits
import snapshot


WEEK_S = 7 * 86400


def pace(used, mark, resets_at, now):
    if used is None or not mark or resets_at is None or resets_at <= now:
        return 1.0
    budget = max(0.0, mark - used) / mark
    time = min(1.0, (resets_at - now) / WEEK_S)
    return min(1.0, budget / time)


def left(answer):
    if not isinstance(answer, dict):
        return None
    connections = answer.get("connections")
    if not isinstance(connections, list):
        return None
    for c in connections:
        if not isinstance(c, dict) or c.get("isDefault") is not True:
            continue
        sign_in = c.get("signIn")
        if not isinstance(sign_in, dict):
            return None
        m = sign_in.get("minutesLeft")
        if isinstance(m, (int, float)) and not isinstance(m, bool):
            return m
        return None
    return None


def due(answer, limit):
    m = left(answer)
    return m is not None and m <= limit


def plan(answer, now):
    connections = answer.get("connections") if isinstance(answer, dict) else None
    c = next((c for c in connections if isinstance(c, dict) and c.get("isDefault") is True), None) if isinstance(connections, list) else None
    if c is None:
        return None
    limits_of = c.get("planLimits")
    windows = limits_of.get("windows") if isinstance(limits_of, dict) else None
    windows = windows if isinstance(windows, list) else []
    week = next((w for w in windows if isinstance(w, dict) and w.get("kind") == "weekly"), None)
    used = resets = None
    if week and isinstance(week.get("usedPercent"), (int, float)) and math.isfinite(week["usedPercent"]):
        used = min(100, max(0, week["usedPercent"]))
        try:
            at = limits.ts(week["resetsAt"])
            used, resets = (0, None) if at <= now else (used, snapshot.iso(at))
        except (AttributeError, KeyError, TypeError, ValueError):
            pass
    m = left(answer)
    m = m if m is not None and math.isfinite(m) else None
    if used is None and m is None:
        return None
    return {"weekUsedPercent": used, "weekResetsAt": resets, "signInMinutes": None if m is None else max(0, int(m))}
