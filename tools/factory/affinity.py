def cache_life(kind, table):
    if not table:
        return 0
    return table.get(kind, 0)


def pick(free, last_copy, last_end, now, life_s):
    if not free:
        return None
    if last_copy in free and last_end is not None and now - last_end < life_s:
        return last_copy
    return free[0]
