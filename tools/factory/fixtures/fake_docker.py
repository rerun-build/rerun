import json, os, re, sys


def env_key():
    try:
        with open(".env", encoding="utf-8") as f:
            lines = [l.rstrip("\r\n") for l in f]
    except OSError:
        return ""
    vals = [l[len("RERUN_ENGINE_API_KEY="):] for l in lines if l.startswith("RERUN_ENGINE_API_KEY=")]
    v = vals[-1] if vals else ""
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        v = v[1:-1]
    return v


def http(st, args, bearer):
    url = next((a for a in args if a.startswith("http://")), "")
    if url == "http://localhost:3000/health":
        return "200"
    if url == "http://localhost:3000/agents":
        open_ = st["engine_open"] or not st["engine_key"]
        return "200" if open_ or bearer == st["engine_key"] else "401"
    if url == "http://app:3000/api/hub":
        if "app" not in st["running"]:
            return "000"
        if st.get("app_slow", 0) > 0:
            st["app_slow"] -= 1
            return "000"
        if "-X" not in args or args[args.index("-X") + 1] != "POST":
            return "405"
        held = [r["engine_api_key"] for r in st["rows"]]
        return "400" if bearer and bearer in held and not st["app_refuses"] else "401"
    return "404"


def curl(st, args):
    if "engine" not in st["running"]:
        return 1, "", 'service "engine" is not running\n'
    bearer = None
    if "@-" in args:
        if args[args.index("@-") - 1] != "-H":
            return 2, "", "fake: @- without -H\n"
        m = re.fullmatch(r"Authorization: Bearer (\S+)\r?\n?", sys.stdin.buffer.read().decode())
        bearer = m.group(1) if m else None
    return 0, http(st, args, bearer), ""


PSQL = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"]


def psql(st, argv):
    i = argv.index("psql")
    opts, container, args = argv[1:i - 1], argv[i - 1], argv[i + 1:]
    if any("=" in o for o in opts):
        st["violations"].append("docker exec option with a value: %r" % opts)
        return 9, "", "fake: value on docker exec command line\n"
    if "-i" not in opts or container != st["dbc"] or args[:6] != PSQL or args[-2:] != ["-d", "postgres"]:
        st["unknown"].append(argv)
        return 99, "", "fake: unexpected psql invocation\n"
    tcp = args[6:-2] == ["-h", "127.0.0.1", "-U", "postgres"]
    if opts == ["-i", "-u", "postgres"] and args[6:-2] == []:
        mode = "socket"
    elif opts == ["-i"] and tcp:
        mode = "local"
    elif opts == ["-i", "-e", "PGPASSWORD"] and tcp:
        mode = "password" if os.environ.get("PGPASSWORD") == st["pg_password"] else "bad-password"
    else:
        st["unknown"].append(argv)
        return 99, "", "fake: unexpected psql options\n"
    if mode not in st["db_modes"]:
        return 2, "", "psql: error: connection to server failed\n"
    return sql(st, sys.stdin.buffer.read().decode())


def sql(st, text):
    lines = text.split("\n")
    m = re.fullmatch(r"-- rotate-engine-key: (ping|count|swap|rehearse|info)", lines[0])
    if not m:
        st["unknown"].append(lines[0])
        return 99, "", "fake: no marker line\n"
    name, data, rest = m.group(1), None, lines
    if "copy k from stdin;" in lines:
        c = lines.index("copy k from stdin;")
        if lines[c + 2] != "\\.":
            return 3, "", "ERROR:  fake: COPY data must be one line\n"
        data, rest = lines[c + 1], lines[:c + 1] + lines[c + 3:]
    known = {r["engine_api_key"] for r in st["rows"]} | {st["engine_key"], env_key()} | set(st["secrets"])
    known |= set((data or "").split("\t"))
    for line in rest:
        for k in known:
            if k and len(k) >= 8 and k in line:
                st["violations"].append("key in the SQL text of the %s program" % name)
                return 9, "", "fake: key in SQL text\n"
    st["calls"][-1]["sql"] = name
    if name == "ping":
        return 0, "1\n", ""
    if name == "info":
        if any("copy" in l.lower() for l in lines):
            st["violations"].append("COPY in the info program")
            return 9, "", "fake: COPY in the info program\n"
        return 0, "%s|%s\n" % (",".join(st.get("triggers", [])), ",".join(st.get("publications", []))), ""
    old, new = data.split("\t")
    held = [r["engine_api_key"] for r in st["rows"]]
    o, n = held.count(old), held.count(new)
    last = [l for l in rest if l.strip()][-1]
    if last != ("commit;" if name == "swap" else "rollback;"):
        st["violations"].append("the %s program ends with %r" % (name, last))
        return 9, "", "fake: wrong ending\n"
    if name == "count":
        return 0, "%d|%d|%s\n" % (o, n, ",".join(st["tables"])), ""
    if name == "rehearse":
        if (o, n) in ((1, 0), (0, 1)):
            return 0, "swapped\n" if o == 1 else "already\n", ""
        return 3, "", "ERROR:  rows_old=%d rows_new=%d\n" % (o, n)
    if st.get("db_down_at_swap"):
        st["db_modes"] = []
        return 2, "", "psql: error: server closed the connection unexpectedly\n"
    if st.get("swap_fails"):
        return 3, "", "ERROR:  rows_old=%d rows_new=%d\n" % (o, n)
    if o == 1 and n == 0:
        for r in st["rows"]:
            if r["engine_api_key"] == old:
                r["engine_api_key"], r["updated_at"] = new, "now"
        if st.get("swap_reply_lost"):
            return 2, "", "psql: error: server closed the connection unexpectedly\n"
        return 0, "swapped\n", ""
    if o == 0 and n == 1:
        return 0, "already\n", ""
    return 3, "", "ERROR:  rows_old=%d rows_new=%d\n" % (o, n)


def dispatch(st, argv):
    if argv == ["compose", "stop", "app", "engine"]:
        st["running"] = [s for s in st["running"] if s not in ("app", "engine")]
        return 0, "", ""
    if argv == ["compose", "up", "-d"]:
        st["engine_key"] = env_key()
        st["calls"][-1]["env_key"] = st["engine_key"]
        st["running"] = sorted(set(st["running"]) | {"app", "engine"})
        return 0, "", ""
    if argv == ["compose", "ps", "--status", "running", "--services"]:
        return 0, "".join(s + "\n" for s in st["running"]), ""
    if argv[:5] == ["compose", "exec", "-T", "engine", "curl"]:
        return curl(st, argv[5:])
    if argv[:1] == ["exec"] and "psql" in argv:
        return psql(st, argv)
    st["unknown"].append(argv)
    return 99, "", "fake docker: unknown invocation\n"


def main(argv):
    path = os.environ["FAKE_DOCKER_STATE"]
    with open(path, encoding="utf-8") as f:
        st = json.load(f)
    st["calls"].append({"argv": argv})
    code, out, err = dispatch(st, argv)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(st, f)
    sys.stdout.buffer.write(out.encode())
    sys.stderr.buffer.write(err.encode())
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
