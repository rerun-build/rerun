import datetime, re, sqlite3, sys

DAY = 86400
TOP_GROUPS = 12
TOP_REASONS = 6
REASON_CHARS = 150


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def shape(reason):
    text = re.sub(r"[0-9a-f]{7,40}", "<sha>", str(reason or ""))
    text = re.sub(r"\d+", "N", text)
    return text if len(text) <= REASON_CHARS else text[:100].rstrip() + " ... " + text[-45:].lstrip()


def rows(db, sql, args=()):
    return db.execute(sql, args).fetchall()


def report(db, now):
    day, week = iso(now - DAY), iso(now - 7 * DAY)
    out = ["store read at %s" % iso(now), ""]

    out.append("## failures by group: all | 7 days | 24 hours | first | last")
    groups = rows(db, "SELECT kind, station, COUNT(*), SUM(at >= ?), SUM(at >= ?), MIN(at), MAX(at), COUNT(DISTINCT job) "
                      "FROM failures GROUP BY kind, station ORDER BY COUNT(*) DESC", (week, day))
    for kind, station, n, n7, n1, first, last, jobs in groups:
        out.append("%s @ %s: %d | %d | %d | %s | %s | %d jobs" % (kind, station or "-", n, n7 or 0, n1 or 0, first, last, jobs))

    out += ["", "## reasons of the largest groups, last 7 days (numbers and commit ids folded)"]
    for kind, station, *_ in groups[:TOP_GROUPS]:
        counts = {}
        for (reason,) in rows(db, "SELECT reason FROM failures WHERE kind=? AND station=? AND at >= ?", (kind, station, week)):
            counts[shape(reason)] = counts.get(shape(reason), 0) + 1
        if not counts:
            continue
        out.append("%s @ %s" % (kind, station or "-"))
        for text, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_REASONS]:
            out.append("  %d x %s" % (n, text))

    out += ["", "## jobs with the most failure rows, last 7 days"]
    for job, n, kinds in rows(db, "SELECT job, COUNT(*), GROUP_CONCAT(DISTINCT kind) FROM failures WHERE at >= ? "
                                  "GROUP BY job ORDER BY COUNT(*) DESC LIMIT 12", (week,)):
        out.append("#%s: %d (%s)" % (job, n, kinds))

    out += ["", "## state changes into an end state: state | all | 7 days | 24 hours | distinct jobs"]
    for state, n, n7, n1, jobs in rows(db, "SELECT to_state, COUNT(*), SUM(at >= ?), SUM(at >= ?), COUNT(DISTINCT job) FROM transitions "
                                           "WHERE to_state IN ('merged','blocked','returned','rejected','failed','unsolvable','superseded') "
                                           "AND (from_state IS NULL OR from_state != to_state) GROUP BY to_state ORDER BY COUNT(*) DESC", (week, day)):
        out.append("%s | %d | %d | %d | %d" % (state, n, n7 or 0, n1 or 0, jobs))

    out += ["", "## runs by stage, last 7 days: stage | runs | done | error | cancelled | lost | still open | tokens in | tokens out | avg seconds"]
    for r in rows(db, "SELECT stage, COUNT(*), SUM(status='done'), SUM(status='error'), SUM(status='cancelled'), SUM(status='lost'), "
                      "SUM(status IN ('intent','running')), SUM(tokens_in), SUM(tokens_out), AVG(seconds) FROM fires WHERE intent_at >= ? "
                      "GROUP BY stage ORDER BY COUNT(*) DESC", (week,)):
        out.append(" | ".join(str(int(v)) if isinstance(v, float) else str(v or 0) for v in r))

    out += ["", "## run errors, last 7 days (numbers folded)"]
    counts = {}
    for stage, error in rows(db, "SELECT stage, error FROM fires WHERE intent_at >= ? AND status IN ('error','lost','cancelled') AND error IS NOT NULL", (week,)):
        key = "%s: %s" % (stage, shape(error))
        counts[key] = counts.get(key, 0) + 1
    for text, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:12]:
        out.append("  %d x %s" % (n, text))

    out += ["", "## escaped records"]
    for k, v in rows(db, "SELECT k, v FROM kv WHERE job='escaped' ORDER BY k"):
        out.append("  %s %s" % (k, v))
    return "\n".join(out)


def main(argv):
    path = argv[1] if len(argv) > 1 else "/state/ledger.db"
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        print(report(db, datetime.datetime.now(datetime.timezone.utc).timestamp()))
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv)
