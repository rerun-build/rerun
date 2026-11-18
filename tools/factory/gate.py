#!/usr/bin/env python3
import fnmatch, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutshape
import factory as F

GH = F.GH
TESTF = cutshape.TESTF
REVIEW_RE = re.compile(r"^\s*Review (ACCEPT|REJECT) @([0-9a-f]{8}): ([A-Za-z][A-Za-z0-9_-]*) (ACCEPT|REJECT)\b")
ANSI = re.compile(r"(?:\x1b|\^\[)\[[0-9;]*m")


LAST = {}


class NoAnswer(Exception):
    pass


def gh_json(path, paginate=False, jq=".[]"):
    cmd = [GH, "api"] + (["--paginate", "--jq", jq] if paginate else []) + [path]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode:
        raise NoAnswer("API error on %s: %s" % (path, (r.stderr or r.stdout).strip()[-200:]))
    t = r.stdout.strip()
    if paginate:
        return [json.loads(l) for l in t.splitlines() if l.strip()]
    return json.loads(t) if t else []


def head_checks(full, sha):
    out = []
    for c in gh_json("repos/%s/commits/%s/check-runs?per_page=100" % (full, sha), paginate=True, jq=".check_runs[]"):
        out.append({"name": c["name"], "status": c["status"], "conclusion": c.get("conclusion"), "id": c["id"], "url": c.get("html_url", "")})
    return out


_logs = {}


def job_log(full, url):
    m = re.search(r"/actions/runs/(\d+)/job/(\d+)", url)
    if not m:
        raise NoAnswer("check has no job url: %s" % url)
    if m.group(2) not in _logs:
        r = subprocess.run([GH, "run", "view", m.group(1), "-R", full, "--log", "--job", m.group(2)], capture_output=True, text=True, timeout=300)
        if r.returncode or not r.stdout.strip():
            raise NoAnswer("job log unavailable (expired?) %s: %s" % (url, r.stderr.strip()[-150:]))
        _logs[m.group(2)] = ANSI.sub("", r.stdout)
    return _logs[m.group(2)]


_PENDING = [None]
UT_RES = {"ok": True, "FAIL": False, "ERROR": False, "FAILED": False}
LINE_TS = re.compile(r"\d{2}:\d{2}:\d{2}(?:\.\d+)?Z (.*)$")


def _ut_name(mod_cls, meth):
    segs = mod_cls.split(".")
    if segs[-1] == meth:
        segs = segs[:-1]
    if segs[:3] == ["unittest", "loader", "_FailedTest"] or segs[-1:] == ["_FailedTest"]:
        segs = [meth, "_FailedTest"]
        return "::".join(segs)
    return "::".join(segs + [meth])


def _py_result(ln, pending):
    m = LINE_TS.search(ln)
    t = (m.group(1) if m else ln).strip()
    if not t:
        return None
    line = t[:120]
    if pending:
        m = re.search(r" \.\.\. (ok|FAIL|ERROR)\b", t)
        if m:
            return ("unittest", pending, UT_RES[m.group(1)], line)
    m = re.match(r"^(test\w*) \(([\w.]+)\)(?: \.\.\. (ok|FAIL|ERROR)\b.*|(?:\n)?)$", t)
    if m:
        if m.group(3):
            return ("unittest", _ut_name(m.group(2), m.group(1)), UT_RES[m.group(3)], line)
        _PENDING[0] = _ut_name(m.group(2), m.group(1))
        return "pending"
    m = re.match(r"^(FAIL|ERROR): (\w+) \(([\w.]+)\)\s*$", t)
    if m:
        return ("unittest", _ut_name(m.group(3), m.group(2)), False, line)
    if re.match(r"^FAILED \((failures|errors|skipped)=", t):
        return ("unittest-run", "unittest::summary", False, line)
    if re.match(r"^OK( \(.*\))?$", t):
        return ("unittest-run", "unittest::summary", True, line)
    m = re.match(r"^(?:\[gw\d+\] \[\s*\d+%\] )?(PASSED|FAILED|ERROR) (\S+::\S+)", t) or None
    if m:
        return ("pytest", m.group(2), m.group(1) == "PASSED", line)
    m = re.match(r"^(\S+::\S+) (PASSED|FAILED|ERROR)\b", t)
    if m:
        return ("pytest", m.group(1), m.group(2) == "PASSED", line)
    return None


def results(log):
    out = []
    binary = None
    pending = None
    ran = False
    for ln in log.splitlines():
        py = _py_result(ln, pending)
        pending = None
        if py == "pending":
            pending = _PENDING[0]
            continue
        if py:
            if py[0] == "unittest-run":
                ran = ran or py[2]
            out.append(py)
            continue
        r = re.search(r"Z\s+Running (unittests )?(\S+?)\.rs \(", ln)
        if r:
            binary = None if r.group(1) else os.path.basename(r.group(2))
            continue
        m = re.search(r"Z\s+(PASS|FAIL|SIGABRT|SIGSEGV|TIMEOUT|LEAK-FAIL)\s+\[\s*[\d.]+s\]\s+(?:\(\s*\d+/\d+\)\s+)?(\S+)\s+(\S+)\s*$", ln)
        if m:
            out.append(("nextest-it" if "::" in m.group(2) else "nextest-unit", m.group(2) + "::" + m.group(3), m.group(1) == "PASS", ln.split("Z ", 1)[1].strip()[:120]))
            continue
        m = re.search(r"Z (PASS|FAIL) (\S+)", ln)
        if m:
            out.append(("jest", m.group(2), m.group(1) == "PASS", ln.split("Z ", 1)[1][:120]))
            continue
        m = re.search(r"Z test (\S+) \.\.\. (ok|FAILED)\b", ln)
        if m:
            nm = m.group(1) if binary is None else binary + "::" + m.group(1)
            out.append(("cargo-unit" if binary is None else "cargo-it", nm, m.group(2) == "ok", ln.split("Z ", 1)[1][:120]))
    return out


def _norm(x):
    return x[2:] if x.startswith("./") else x


def same(a, b):
    a, b = _norm(a), _norm(b)
    if b.endswith(".py") and a.startswith(b + "::"):
        return True
    if re.fullmatch(r"test_\w+", b) and a.startswith(b + "::"):
        return True
    if a == b or a.endswith("::" + b) or b.endswith("::" + a):
        return True
    return ("/" in b and a.endswith("/" + b)) or ("/" in a and b.endswith("/" + a))


def rust_prefix(path):
    parts = _norm(path).split("/")
    if not parts[-1].endswith(".rs"):
        return None
    if len(parts) >= 2 and parts[-2] == "tests":
        return ("bin", parts[-1][:-3])
    if "src" in parts:
        mods = parts[len(parts) - 1 - parts[::-1].index("src") + 1:]
        mods[-1] = mods[-1][:-3]
        if mods[-1] in ("mod", "lib", "main"):
            mods = mods[:-1]
        return ("mod", "::".join(mods))
    return None


def py_hit(tf, name, kind):
    tf = _norm(tf)
    if kind == "pytest":
        return same(name.split("::")[0], tf)
    if kind != "unittest":
        return False
    want = tf[:-3].split("/")
    segs = name.split("::")
    for k in range(1, len(segs)):
        mod = segs[:k]
        if want[-len(mod):] == mod or mod[-len(want):] == want:
            return True
    return False


def test_hit(tf, name, kind=""):
    if _norm(tf).endswith(".py"):
        return py_hit(tf, name, kind)
    rp = rust_prefix(tf)
    if not rp:
        return same(name, tf)
    segs = name.split("::")
    if rp[0] == "bin":
        return (kind == "nextest-it" and len(segs) >= 3 and segs[1] == rp[1]) or (kind == "cargo-it" and len(segs) >= 2 and segs[0] == rp[1])
    want = [x for x in rp[1].split("::") if x] + ["tests"]
    if kind == "nextest-unit":
        segs = segs[1:]
    elif kind != "cargo-unit":
        return False
    return segs[:len(want)] == want and len(segs) > len(want)


def inline_rust_test(f):
    return bool(re.search(r"(^|/)src/.*\.rs$", f["filename"]) and re.search(r"(?m)^\+(?!\+\+).*(#\[(\w+::)?test\]|cfg\(test\)|mod tests)", f.get("patch") or ""))


def clean_glob(g):
    g = g.strip(" `")
    if g.endswith("."):
        g = g[:-1]
    return g.strip(" `")


def parse_issue(full, jobrepo, jobn, chunk):
    body = gh_json("repos/%s/issues/%s" % (F.repo_full(jobrepo), jobn)).get("body") or ""
    line = next((l for l in body.splitlines() if re.match(r"\s*- \[.\] %s\." % re.escape(chunk), l, re.I)), None)
    if not line:
        return None, body, {}
    f = {}
    for part in line.split("|")[1:]:
        k, _, v = part.strip().partition(":")
        f[k.strip().lower()] = v.strip()
    return line, body, f


def chunk_limits(full, n, jobrepo, jobn, ids):
    cm = gh_json("repos/%s/pulls/%s/commits?per_page=100" % (full, n), paginate=True)
    why = []
    for cid in ids:
        mx = int(re.sub(r"\D", "", parse_issue(full, jobrepo, jobn, cid)[2].get("max-lines", "")) or 800)
        shas = [c["sha"] for c in cm if re.match(r"%s( \w+)?:" % re.escape(cid), c["commit"]["message"], re.I)]
        n_l = sum(f["additions"] + f["deletions"] for s in shas for f in gh_json("repos/%s/commits/%s" % (full, s))["files"])
        if not shas:
            why.append("chunk %s: no commit titled '%s: ...'" % (cid, cid))
        elif n_l > mx:
            why.append("chunk %s: %d changed lines > max %d" % (cid, n_l, mx))
    return why


RECEIPT_RE = re.compile(r"^\s*Receipt (\w+): done-test (\w+) \(base exit (-?\d+), head exit (-?\d+)\)\s*$", re.M)


def receipts(body, ref):
    if not re.fullmatch(r"factory/job-\d+", ref or ""):
        return {}
    return {c: (v == "ok" and int(h) == 0, int(b) != 0) for c, v, b, h in RECEIPT_RE.findall(body or "")}


def _list(x):
    return x if isinstance(x, list) else []


def open_claims(full, n, jobn):
    import ledger as L
    out, same = [], str(jobn) if jobn else None
    for p in _list(gh_json("repos/%s/pulls?state=open&per_page=100" % full, paginate=True)):
        num, ref = p.get("number"), (p.get("head") or {}).get("ref", "")
        if str(num) == str(n) or (same and re.fullmatch(r"chunk/%s-\w+" % same, ref)):
            continue
        fl = _list(gh_json("repos/%s/pulls/%s/files?per_page=100" % (full, num), paginate=True))
        out.append({"ref": "#%s" % num, "files": [f["filename"] for f in fl]})
    for i in _list(gh_json("repos/%s/issues?state=open&per_page=100" % full, paginate=True)):
        if i.get("pull_request") or str(i.get("number")) == same:
            continue
        globs = []
        for l in L.chunk_lines(i.get("body")):
            c = L.chunk(l)
            if c and re.match(r"\s*- \[ \]", l):
                globs += c["paths"]
        if globs:
            out.append({"ref": "#%s" % i["number"], "globs": globs})
    return out


def claims_line(ro, names, builder, others, verdict):
    if not ro:
        return True, "no roster"
    import roster as R
    confl = [(a, r, R.owner(ro, a, builder)) for a, refs in R.overlaps(ro, names, others).items() for r in refs]
    ok, lines = R.claims_check(confl, verdict)
    return ok, "; ".join(lines) or "no shared area with %d open PRs or jobs" % len(others)


def ledger_builders(full, jobrepo, jobn, ids, ref):
    import ledger as L
    if F.short(F.repo_full(jobrepo)) != F.short(full):
        return [], "PR body names %s#%s but branch is %s" % (jobrepo, jobn, ref)
    mj = re.fullmatch(r"factory/job-(\d+)", ref)
    if mj and mj.group(1) != str(jobn):
        return [], "PR body names %s#%s but branch is %s" % (jobrepo, jobn, ref)
    text = (gh_json("repos/%s/issues/%s" % (full, jobn)) or {}).get("body") or ""
    chunks = {}
    for ln in L.chunk_lines(text):
        c = L.chunk(ln)
        if c:
            chunks.setdefault(c["id"].lower(), c)
    out = []
    for i in ids:
        c = chunks.get(i.lower())
        b = ((c or {}).get("builder") or "").strip().lower()
        if not b:
            return [], "chunk %s has no builder under ## Chunks of #%s" % (i, jobn)
        out.append(b)
    return out, None


def gate(repo, n):
    full = F.repo_full(repo)
    pr = gh_json("repos/%s/pulls/%s" % (full, n))
    head = pr["head"]["sha"]
    s8 = head[:8]
    files = gh_json("repos/%s/pulls/%s/files?per_page=100" % (full, n), paginate=True)
    lines = sum(f["additions"] + f["deletions"] for f in files)
    pbody = pr.get("body") or ""
    res = {}

    def put(cid, ok, receipt):
        res[cid] = {"ok": bool(ok), "receipt": receipt, "sha": head}

    m = re.search(r"Job: ([\w./-]+)#(\d+), chunk (\w+)", pbody)
    mb = re.fullmatch(r"chunk/(\d+)-(\w+)", pr["head"]["ref"])
    jobrepo, jobn, chunk = (m.group(1), m.group(2), m.group(3)) if m else ((full, mb.group(1), mb.group(2)) if mb else (full, None, None))
    ids = (re.search(r"Job: [\w./-]+#\d+, chunk ([\w, ]+)", pbody) or [0, ""])[1].replace(" ", "").split(",") if m else []
    idconf = None
    if m and mb and (mb.group(1) != m.group(2) or mb.group(2).lower() != m.group(3).lower()):
        idconf = "PR body says %s#%s chunk %s but branch %s says issue %s chunk %s" % (m.group(1), m.group(2), m.group(3), pr["head"]["ref"], mb.group(1), mb.group(2))
    line, ibody, fld = (None, "", {})
    if jobn:
        line, ibody, fld = parse_issue(full, jobrepo, jobn, chunk)

    cs = head_checks(full, head)
    if not cs and not gh_json("repos/%s/commits/%s" % (full, head)):
        raise NoAnswer("cannot read checks")
    st = F.ci_state(cs)
    put("CI_GREEN", st == "GREEN", "%s: %d check-runs on %s, e.g. %s" % (st, len(cs), s8, cs[0]["url"] if cs else "none"))

    dt = fld.get("done-test")
    jobpr = re.fullmatch(r"factory/job-\d+", pr["head"]["ref"]) is not None
    rc = receipts(pbody, pr["head"]["ref"])
    want = ids or sorted(rc)
    if jobpr:
        for i, (key, what) in enumerate((("DONE_TEST", "done-test"), ("FAIL_BEFORE", "fail-before"))):
            bad = [c for c in want if not rc.get(c, (False, False))[i]]
            put(key, want and not bad, ("%s receipt ok for chunk %s" % (what, ", ".join(want))) if want and not bad else "no %s receipt line that holds for chunk: %s" % (what, ", ".join(bad) or "none named"))
    elif idconf:
        put("DONE_TEST", False, "chunk id mismatch: " + idconf)
    elif not dt:
        put("DONE_TEST", False, "no done-test in work order %s#%s chunk %s" % (jobrepo, jobn, chunk) if jobn else "chunk id not found (branch chunk/<issue>-<cN> or 'Job: <repo>#<n>, chunk <cN>')")
    else:
        seen = None
        for c in cs:
            if c["conclusion"] != "success":
                continue
            for k, name, ok, ln in results(job_log(full, c["url"])):
                if same(name, dt):
                    if not ok:
                        seen = (False, c["url"], ln)
                        break
                    seen = seen if seen and not seen[0] else (True, c["url"], ln)
            if seen and not seen[0]:
                break
        if seen and seen[0]:
            put("DONE_TEST", True, "%s | %s" % (seen[2], seen[1]))
        elif seen:
            put("DONE_TEST", False, "failed on head: %s | %s" % (seen[2], seen[1]))
        else:
            put("DONE_TEST", False, "'%s' not found as passed in any job log on %s" % (dt, s8))

    tfiles = [f["filename"] for f in files if f["status"] in ("added", "modified") and (re.search(TESTF, f["filename"]) or inline_rust_test(f))]
    commits = [c["sha"] for c in gh_json("repos/%s/pulls/%s/commits?per_page=100" % (full, n), paginate=True) if c["sha"] != head]
    if jobpr:
        pass
    elif not tfiles:
        put("FAIL_BEFORE", False, "PR touches no test file: nothing that failed before")
    else:
        missing, rec, nolog = [], [], set()
        red = []
        for sha in commits:
            for c in head_checks(full, sha):
                if c["conclusion"] == "failure":
                    red.append((sha, c))
        for tf in tfiles:
            hit = None
            for sha, c in red:
                try:
                    older = results(job_log(full, c["url"]))
                except NoAnswer:
                    nolog.add(c["url"])
                    continue
                for k, name, ok, ln in older:
                    if not ok and test_hit(tf, name, k):
                        hit = "%s FAILED on %s | %s" % (ln, sha[:8], c["url"])
                        break
                if hit:
                    break
            (rec if hit else missing).append(hit or tf)
        put("FAIL_BEFORE", not missing, ("; ".join(rec)) if not missing else "no failing log on an older commit for: " + ", ".join(missing) + ("; %d older red check(s) had no readable log" % len(nolog) if nolog else ""))

    need, stop = {"LINUS"}, []
    builder = (fld.get("builder") or "").strip().lower() or None
    builders, unbound = ([builder] if builder else []), None
    if m and not mb:
        builders, unbound = ledger_builders(full, jobrepo, jobn, ids, pr["head"]["ref"])
        builder = builders[0] if builders else None
    roster_err, ro = None, None
    try:
        ro = F.base_roster(full)
    except F.RosterError as e:
        roster_err = str(e)
    for f in files:
        fn = f["filename"]
        test_only = re.search(r"\.spec\.ts$|\.test\.[jt]sx?$|(^|/)tests?/|__tests__|\.md$", fn)
        for who, pat, why in F.RULES:
            if re.search(pat, fn, re.I) and not (test_only and who != "STOP"):
                if who == "STOP":
                    stop.append(fn)
                else:
                    need.add(who)
    if ro:
        import roster as R
        need = R.required(ro, [f["filename"] for f in files], builder)
    elif not roster_err and F.short(full) != F.short(F.home()):
        import roster as R
        need.add(R.GATE_SENSITIVE)
    if len(files) > 25 or lines > 1200:
        need.add("ADA")
    verdict, refused = {}, []
    for cm in sorted(gh_json("repos/%s/issues/%s/comments?per_page=100" % (full, n), paginate=True), key=lambda c: c["created_at"]):
        mm = REVIEW_RE.match(cm.get("body") or "")
        if mm and mm.group(2) == s8:
            if mm.group(3).lower() in builders and mm.group(4) == "ACCEPT":
                refused.append(mm.group(3).upper())
                continue
            verdict[mm.group(3).upper()] = (mm.group(4), cm["html_url"], (cm.get("body") or "")[mm.end():])
    bad = sorted(w for w in need if verdict.get(w, ("", ""))[0] != "ACCEPT")
    if roster_err:
        put("REVIEWS", False, "roster unreadable, failing closed: " + roster_err)
    elif unbound:
        put("REVIEWS", False, "builder not bound: " + unbound)
    elif stop:
        put("REVIEWS", False, "STOP: workflow or GitHub settings file touched (Rob only): " + ", ".join(stop[:3]))
    else:
      put("REVIEWS", not bad, ("%s ACCEPT @%s | %s" % (", ".join(sorted(need)), s8, " ".join(verdict[w][1] for w in sorted(need)))) if not bad else
        "need ACCEPT @%s from: %s (have: %s)%s" % (s8, ", ".join(bad), ", ".join("%s %s" % (k, v[0]) for k, v in verdict.items()) or "none on this head",
                                                    "; ACCEPT by builder %s refused" % ", ".join(sorted(set(refused))) if refused else ""))

    names = [f["filename"] for f in files]
    try:
        others = open_claims(full, n, jobn) if ro and not roster_err else []
    except NoAnswer as e:
        others, roster_err = [], str(e)
    if roster_err:
        put("CLAIMS", False, "cannot list open work, failing closed: " + roster_err)
    else:
        put("CLAIMS", *claims_line(ro, names, builder, others, verdict))

    mx = int(re.sub(r"\D", "", fld.get("max-lines", "")) or 800)
    wf = [f["filename"] for f in files if re.search(F.WF, f["filename"])]
    globs = []
    in_lim = False
    for l in ibody.splitlines():
        if l.startswith("## "):
            in_lim = l.strip() == "## Limits"
        if in_lim and "do not touch:" in l.lower():
            globs += [clean_glob(g) for g in re.split(r"do not touch:", l, flags=re.I)[1].split(",") if clean_glob(g)]
    dnt = [f["filename"] for f in files if any(fnmatch.fnmatch(f["filename"], g) for g in globs)]
    why = []
    if len(ids) > 1:
        why += chunk_limits(full, n, jobrepo, jobn, ids)
    elif lines > mx:
        why.append("%d changed lines > max %d" % (lines, mx))
    if wf:
        why.append("workflow files: " + ", ".join(wf[:3]))
    if dnt:
        why.append("do-not-touch: " + ", ".join(dnt[:3]))
    put("LIMITS", not why, "; ".join(why) or "%d lines <= %d, %d files, no workflow file, %d do-not-touch globs" % (lines, mx, len(files), len(globs)))

    miss = F.has_heads(pbody, F.PR_HEADS)
    put("HANDOFF", not miss, "missing sections: " + ", ".join(miss) if miss else "all %d PR_HEADS sections present in PR body" % len(F.PR_HEADS))

    failed = [k for k, v in res.items() if not v["ok"]]
    LAST.update(full=full, head=head)
    head_line = "GATE %s %s#%s @%s%s" % ("FAIL" if failed else "PASS", F.short(full), n, s8, (": " + ", ".join(failed)) if failed else "")
    print(head_line)
    for k, v in res.items():
        print("%s %s %s" % (k, "PASS" if v["ok"] else "FAIL", v["receipt"]))
    os.makedirs(F.STATE + "/gate", exist_ok=True)
    json.dump({"repo": full, "pr": int(n), "head": head, "verdict": "FAIL" if failed else "PASS", "checks": res},
              open(F.STATE + "/gate/%s-%s-%s.json" % (F.short(full), n, head), "w"), indent=1)
    return 3 if failed else 0


def _post(full, sha, state, context, desc):
    r = subprocess.run([GH, "api", "repos/%s/statuses/%s" % (full, sha), "-f", "state=" + state, "-f", "context=" + context, "-f", "description=" + desc],
                       capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise NoAnswer((r.stderr or r.stdout).strip()[-200:])


def post_status(code, post=_post):
    if code not in (0, 3) or "head" not in LAST:
        return
    try:
        post(LAST["full"], LAST["head"], "success" if code == 0 else "failure", "factory/review", "gate %s @%s" % ("PASS" if code == 0 else "FAIL", LAST["head"][:8]))
    except Exception as e:
        print("status not posted: %s" % e, file=sys.stderr)


NOTE_MAX = 60000


def review(a):
    if len(a) < 3 or a[2] not in ("ACCEPT", "REJECT") or "--as" not in a or "--note" not in a:
        print("usage: review <repo> <PR> ACCEPT|REJECT --as <NAME> --note '<text>' [--sha <head commit you read>]")
        return 2
    full, n = F.repo_full(a[0]), a[1].lstrip("#")
    name = a[a.index("--as") + 1].upper()
    note = a[a.index("--note") + 1][:NOTE_MAX]
    if not re.fullmatch(r"[A-Z][A-Z0-9_-]*", name):
        print("--as must be a name like LINUS, BRUCE")
        return 2
    read = None
    if "--sha" in a:
        read = (a[a.index("--sha") + 1:] or [""])[0].lower()
        if not re.fullmatch(r"[0-9a-f]{7,40}", read):
            print("--sha must be the 7 to 40 hex characters of the head commit you read")
            return 2
    pr = gh_json("repos/%s/pulls/%s" % (full, n))
    if read and not pr["head"]["sha"].startswith(read):
        print("REFUSED: PR head is now %s, you read %s. Read the new head and review again. Nothing posted." % (pr["head"]["sha"][:8], read[:8]))
        return 2
    s8 = pr["head"]["sha"][:8]
    body = "Review %s @%s: %s %s @%s: %s" % (a[2], s8, name, a[2], s8, note)
    r = subprocess.run([GH, "pr", "comment", n, "-R", full, "--body", body], capture_output=True, text=True)
    if r.returncode:
        print("review not posted: " + (r.stderr or r.stdout)[-200:])
        return 1
    print("POSTED " + body[:160] + " | " + r.stdout.strip())
    return 0


if __name__ == "__main__":
    cmd = os.environ.get("GATE_CMD", "gate")
    a = sys.argv[1:]
    try:
        if cmd == "review":
            sys.exit(review(a))
        if len(a) < 2:
            print("usage: gate <repo> <PR>")
            sys.exit(2)
        code = gate(a[0], a[1].lstrip("#"))
        if os.environ.get("GATE_POST_STATUS") == "1":
            post_status(code)
        sys.exit(code)
    except NoAnswer as e:
        print("GATE UNKNOWN: could not answer: %s" % e)
        sys.exit(1)
    except SystemExit:
        raise
    except Exception as e:
        print("GATE UNKNOWN: could not answer: %r" % e)
        sys.exit(1)
