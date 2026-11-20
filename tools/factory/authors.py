TRUSTED_LOGINS = frozenset(("special-place-administrator", "moldwright-factory[bot]", "app/moldwright-factory"))
ROB = "special-place-administrator"


def trusted_author(item):
    if not isinstance(item, dict):
        return False
    login = ((item.get("author") or item.get("user")) or {}).get("login") or ""
    return login in TRUSTED_LOGINS


def is_rob(item):
    if not isinstance(item, dict):
        return False
    login = ((item.get("author") or item.get("user")) or {}).get("login") or ""
    return login == ROB
