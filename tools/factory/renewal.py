import limits
import snapshot


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
    windows = (c.get("planLimits") or {}).get("windows") or []
    week = next((w for w in windows if isinstance(w, dict) and w.get("kind") == "weekly"), None)
    used = resets = None
    if week and isinstance(week.get("usedPercent"), (int, float)):
        used = min(100, max(0, week["usedPercent"]))
        try:
            at = limits.ts(week["resetsAt"])
            used, resets = (0, None) if at <= now else (used, snapshot.iso(at))
        except (AttributeError, KeyError, TypeError, ValueError):
            pass
    m = left(answer)
    if used is None and m is None:
        return None
    return {"weekUsedPercent": used, "weekResetsAt": resets, "signInMinutes": None if m is None else max(0, int(m))}
