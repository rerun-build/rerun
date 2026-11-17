import json
import os

WEIGHTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "token-weights.json")


def load(path=WEIGHTS):
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def count(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else 0


def dearest(models):
    return max(models.values(), key=lambda r: (r.get("output", 0), r.get("input", 0)))


def units(row, table):
    models = (table or {}).get("models") or {}
    if not models:
        return 0.0, False
    price = models.get(row.get("model"))
    weighed = price is not None
    if price is None:
        price = dearest(models)
    cached = count(row.get("cache_read"))
    written = count(row.get("cache_write"))
    fresh = max(0, count(row.get("tokens_in")) - cached - written)
    total = (fresh * price.get("input", 0) + cached * price.get("cache_read", 0)
             + written * price.get("cache_write", 0) + count(row.get("tokens_out")) * price.get("output", 0)) / 1e6
    return total, weighed


def job_cost(store, job, table):
    rows = store.db.execute(
        "SELECT model, tokens_in, tokens_out, cache_read, cache_write FROM fires WHERE job=?", (str(job),)).fetchall()
    return len(rows), round(sum(units(dict(r), table)[0] for r in rows), 4)
