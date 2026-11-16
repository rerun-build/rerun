import datetime, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger as L

FIX_BUILDS, JOB_FIXES, REVIEW_ROUNDS, PLAN_ROUNDS = 2, 2, 2, 3
FIRED_CAP = 20
RUN_LIMIT_S, CI_START_LIMIT_S = 45 * 60, 30 * 60
STALL_S = 10 * 60
PENDING_TICKS, RESTART_REFIRES = 3, 1
RESTARTED = "interrupted: engine restarted"


def ts(iso):
    return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def replan(plan_round, reason):
    if plan_round >= PLAN_ROUNDS:
        return "BLOCKED", "plan_round %d/%d used, the next plan would be round %d: %s" % (plan_round, PLAN_ROUNDS, plan_round + 1, reason)
    return "PLAN", reason


def fix_or_replan(used, cap, plan_round, reason):
    if used < cap:
        return "FIX", reason
    return replan(plan_round, "failed after %d/%d fixes: %s" % (used, cap, reason))


def challenge(verdict, rejects_in_row, plan_round, text):
    if verdict == "READY":
        return "BUILD", None
    if rejects_in_row >= 1:
        return "NEEDS_BOSS", "second PLAN REJECT in a row: " + text
    return replan(plan_round, text)


def may_fire(fired_total):
    if fired_total >= FIRED_CAP:
        return "BLOCKED", "fired %d/%d runs for this job, the safety cap" % (fired_total, FIRED_CAP)
    return "FIRE", None


STANDARD_CHUNK_CAP, BUILDER_CAPACITY, PER_JOB_CAP = 400000, 3, 2


def _pos(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def chunk_cap(cfg=None, entry=None, lane=None):
    vals = [_pos(v) for v in (STANDARD_CHUNK_CAP, (cfg or {}).get("token_cap"), (entry or {}).get("token_cap"), lane)]
    return min(v for v in vals if v is not None)


def batch_cap(cfg, chunks, entry=None, lane=None):
    return chunks * chunk_cap(cfg, entry, lane)


def _runner_cfg():
    import json
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.json")) as f:
        return json.load(f)


def capacity(cfg=None):
    return _pos((_runner_cfg() if cfg is None else cfg).get("builder_capacity")) or BUILDER_CAPACITY


def per_job_cap(cfg=None):
    return _pos((_runner_cfg() if cfg is None else cfg).get("per_job_cap")) or PER_JOB_CAP


def stage_cfg(cfg, entry=None):
    out = dict(cfg or {})
    for k in ("run_limit_s", "stall_s", "token_cap"):
        if entry and k in entry:
            out[k] = min(entry[k], out[k]) if k == "token_cap" and _pos(out.get(k)) and _pos(entry[k]) else entry[k]
    return out



def run_limits(cfg=None):
    cfg = cfg or {}
    def num(key, default):
        v = cfg.get(key, default)
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None
    return {"run_limit_s": num("run_limit_s", RUN_LIMIT_S) or RUN_LIMIT_S, "stall_s": num("stall_s", STALL_S), "token_cap": num("token_cap", None)}

def run_outcome(row, now, steps=None, cfg=None):
    if not row or not row.get("status"):
        return "MISSING", "run not found in system.db"
    st, rid = row["status"], row.get("id")
    if st == "running":
        lim, steps = run_limits(cfg), steps or {}
        started = ts(row["started_at"])
        if now - started > lim["run_limit_s"]:
            return "CANCEL", "run %s still running after %d s (limit %d s)" % (rid, now - started, lim["run_limit_s"])
        if lim["token_cap"] is not None and (steps.get("tokens") or 0) > lim["token_cap"]:
            return "CANCEL", "run %s used %d tokens (cap %d)" % (rid, steps["tokens"], lim["token_cap"])
        if steps and lim["stall_s"] is not None:
            last = ts(steps["last_step_at"]) if steps.get("last_step_at") else started
            if now - last > lim["stall_s"]:
                return "CANCEL", "run %s stalled: no new step for %d s (limit %d s)" % (rid, now - last, lim["stall_s"])
        return "RUNNING", None
    if st == "done":
        return "DONE", None
    if st == "error":
        if RESTARTED in (row.get("error") or ""):
            return "RESTARTED", None
        return "REFIRE_ONCE", "run %s ended error: %s" % (rid, (row.get("error") or "-")[:200])
    return "FAILED", "run %s ended %s: %s" % (rid, st, (row.get("error") or "-")[:200])


def restart(refires):
    if refires < RESTART_REFIRES:
        return "REFIRE", None
    return "FAILED", "run interrupted by an engine restart again after %d refire" % refires


def ci_overdue(dispatched, now):
    return now - ts(dispatched) > CI_START_LIMIT_S


def resolve_pending(firing, slug, rows, now, tick_seconds):
    f = ts(firing)
    mine = sorted((ts(r["started_at"]), r["id"]) for r in rows if r.get("trigger_slug") == slug and r.get("started_at") and ts(r["started_at"]) >= f)
    if mine:
        return "RUN", mine[0][1]
    if now - f >= PENDING_TICKS * tick_seconds:
        return "FAILED", "firing of %s at %s has no run after %d ticks" % (slug, firing, PENDING_TICKS)
    return "WAIT", None


def keeps_merged(old_text, new_text, merged):
    def by_id(text):
        return {L.chunk(l)["id"]: l.strip()[6:].strip() for l in L.chunk_lines(text)}
    old, new = by_id(old_text), by_id(new_text)
    bad = sorted(i for i in merged if old.get(i) is None or new.get(i) != old.get(i))
    return ("BLOCKED", "re-plan changes merged chunk(s): " + ", ".join(bad)) if bad else ("OK", None)


STAGE_TIER = {**dict.fromkeys(("checks", "ci", "gate", "risk"), "small"), **dict.fromkeys(("build", "fix"), "mid"),
              **dict.fromkeys(("plan", "challenge", "review", "ruling", "accept"), "large")}


def model_for(stage, cfg=None):
    if stage not in STAGE_TIER:
        raise ValueError("unknown stage: %r" % (stage,))
    return (_runner_cfg() if cfg is None else cfg)["model_tiers"][STAGE_TIER[stage]]


PACKET_CAP = 4096


def packet_oversize(text, cfg=None, lane=None):
    cap = min(v for v in (PACKET_CAP, _pos((cfg or {}).get("packet_cap")), _pos(lane)) if v is not None)
    return len(text.encode("utf-8")) > cap


RETRIES = 1


def failure(attempts, cfg=None, tail=""):
    n = (_runner_cfg() if cfg is None else cfg).get("retries", RETRIES)
    if not isinstance(n, int) or isinstance(n, bool) or n < 0:
        n = RETRIES
    if attempts < n:
        return "RETRY", tail
    return "NEEDS_BOSS", "failed after %d attempt(s), retries %d: %s" % (attempts + 1, n, (tail or "-")[-200:])


def after_reject(owners):
    if len(owners) >= 2 and owners[-1] == owners[-2]:
        return "ARBITER", "second REJECT in a row of %s's work" % owners[-1]
    return "FIX", None
