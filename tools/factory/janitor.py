import json, os, re, shutil, sys, time

import clones as C
import factory as F
import mirror as M

MIN_AGE_H = 1
TRASH_KEEP_H = 24
UNREACHABLE_PASSES = 3
STALE_GIT_LOCK_H = 1
DIR = re.compile(r"(\d+)-([a-z0-9]{1,12})")


def trash_root():
    return os.path.join(F.WORK, "trash")


def busy(path):
    root = os.path.realpath(path)
    for pid in os.listdir("/proc") if os.path.isdir("/proc") else []:
        if not pid.isdigit():
            continue
        try:
            cwd = os.path.realpath(os.readlink("/proc/%s/cwd" % pid))
        except OSError:
            continue
        if cwd == root or cwd.startswith(root + os.sep):
            return int(pid)
    return None


def age_h(path):
    try:
        with open(os.path.join(path, ".git", C.CREATED)) as f:
            return (time.time() - int(f.read().strip())) / 3600
    except (OSError, ValueError):
        return None


def clones():
    return [(r, d, p) for r, d, p in F.wt_dirs() if F.is_clone(p) and DIR.fullmatch(d)]


def tips(path):
    out = set(C.M.git(["for-each-ref", "--format=%(objectname)", "refs/heads"], cwd=path).stdout.split())
    out |= set(C.M.git(["log", "-g", "--format=%H", "refs/stash"], cwd=path).stdout.split())
    head = C.M.git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd=path).stdout.strip()
    return sorted(out | ({head} if head else set()))


def unpushed(path, full):
    r = C.M.git(["fetch", "--quiet", "--prune", M.url(full), "+refs/heads/*:refs/factory-remote/*"], cwd=path)
    if r.returncode:
        return None
    return [t for t in tips(path) if not C.M.git(["for-each-ref", "--contains", t, "refs/factory-remote"], cwd=path).stdout.strip()]


def rescue(path, full, branch, left):
    for sha in left:
        rb = "rescue/%s-%s" % (branch, sha[:8])
        C.M.git(["push", "--quiet", M.url(full), "%s:refs/heads/%s" % (sha, rb)], cwd=path)
        print("RESCUED %s of %s to %s" % (sha[:8], branch, rb))
    return unpushed(path, full)


def to_trash(path, repo, d):
    os.makedirs(trash_root(), exist_ok=True)
    dst = os.path.join(trash_root(), "%d-%s-%s" % (time.time(), repo, d))
    os.rename(path, dst)
    return dst


def counter(name, bump):
    p = os.path.join(F.STATE, "janitor.json")
    try:
        with open(p) as f:
            rec = json.load(f)
    except (OSError, ValueError):
        rec = {}
    rec[name] = rec.get(name, 0) + 1 if bump else 0
    M.write(p, json.dumps(rec))
    return rec[name]


def github(full, issue, branch):
    prs = F.pr_lookup(full, branch)
    it = F.api("repos/%s/issues/%s" % (full, issue))
    if prs is None or not isinstance(it, dict) or "state" not in it:
        return None
    return prs, it


def verdict(full, repo, d, path):
    issue, chunk = DIR.fullmatch(d).groups()
    branch = "chunk/" + d
    if busy(path):
        return "KEEP", "a process works inside"
    gh = github(full, issue, branch)
    if gh is None:
        return "UNREACHABLE", "cannot reach GitHub"
    prs, it = gh
    settled = [x for x in prs if x.get("state", "").upper() in ("MERGED", "CLOSED")]
    if any(x.get("state", "").upper() == "OPEN" for x in prs):
        return "KEEP", "pull request open"
    if not settled and it.get("state") != "closed":
        return "KEEP", "no merged or closed pull request and the issue is open"
    h = age_h(path)
    if not settled and (h is None or h < MIN_AGE_H):
        return "KEEP", "younger than %d h without a closed pull request" % MIN_AGE_H
    if C.M.git(["status", "--porcelain"], cwd=path).stdout.strip():
        return "KEEP", "uncommitted changes"
    left = unpushed(path, full)
    if left is None:
        return "UNREACHABLE", "cannot fetch from GitHub"
    if left:
        left = rescue(path, full, branch, left)
        if left is None or left:
            return "KEEP", "commits on no GitHub branch and the rescue push failed"
    return "REMOVE", "pull request %s, everything on GitHub" % (settled[0]["state"].lower() if settled else "none, issue closed")


def janitor(apply):
    code = doctor(apply)
    n, unreachable = {"KEEP": 0, "REMOVE": 0, "UNREACHABLE": 0}, False
    for repo, d, path in clones():
        lk = C.try_lease(repo, d)
        if lk is None:
            n["KEEP"] += 1
            print("KEEP   %s/%s  live: owned by run %s" % (repo, d, C.read_owner("%s-%s" % (repo, d)).get("run", "unknown")))
            continue
        try:
            full = F.reg_read(repo, d).get("repo") or F.repo_full(repo)
            v, why = verdict(full, repo, d, path)
            unreachable = unreachable or v == "UNREACHABLE"
            n[v] += 1
            if v == "REMOVE" and apply:
                dst = to_trash(path, repo, d)
                for f in (F.marker(repo, "chunk/" + d), F.reg_path(repo, d)):
                    if os.path.exists(f):
                        os.remove(f)
                why += "; moved to %s" % os.path.basename(dst)
            print("%-6s %s/%s  %s" % ("KEEP" if v == "UNREACHABLE" else v, repo, d, why))
        finally:
            lk.close()
    passes = counter("unreachable", unreachable)
    if passes >= UNREACHABLE_PASSES:
        print("JANITOR cannot reach GitHub for %d passes; nothing removed while it lasts" % passes)
    if apply:
        empty_trash()
        F.wt_sweep(True, only="REMOVE", quiet=True)
    print("janitor: %d KEEP, %d REMOVE, %d unreachable | %s" % (n["KEEP"], n["REMOVE"], n["UNREACHABLE"], "applied" if apply else "dry run"))
    return code


def empty_trash():
    for e in sorted(os.listdir(trash_root())) if os.path.isdir(trash_root()) else []:
        try:
            at = int(e.split("-", 1)[0])
        except ValueError:
            continue
        if time.time() - at > TRASH_KEEP_H * 3600:
            shutil.rmtree(os.path.join(trash_root(), e), ignore_errors=True)
            print("emptied trash %s" % e)


def restore(name):
    src = os.path.join(trash_root(), name)
    m = re.fullmatch(r"\d+-(.+)-(\d+-[a-z0-9]{1,12})", name)
    if not m or not os.path.isdir(src):
        F.die("no trash entry %s" % name)
    dst = os.path.join(F.WT, m.group(1), m.group(2))
    if os.path.exists(dst):
        F.die("%s exists; nothing moved" % dst)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.rename(src, dst)
    print("RESTORED %s to %s" % (name, dst))
    return 0


def git_locks(path, older_h):
    g = os.path.join(path, ".git")
    out = []
    for d, _, fs in os.walk(g):
        rel = os.path.relpath(d, g).split(os.sep)[0]
        if rel in ("objects", "hooks"):
            continue
        for f in fs:
            p = os.path.join(d, f)
            if f.endswith(".lock") and time.time() - os.path.getmtime(p) > older_h * 3600:
                out.append(p)
    return out


def check_one(full, repo, d, path, apply):
    issue, chunk = DIR.fullmatch(d).groups()
    branch = "chunk/" + d
    if C.M.git(["rev-parse", "--git-dir"], cwd=path).returncode or C.M.git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd=path).returncode:
        if apply:
            dst = to_trash(path, repo, d)
            print("BROKEN %s/%s moved to %s" % (repo, d, os.path.basename(dst)))
        else:
            print("BROKEN %s/%s" % (repo, d))
        return
    for p in git_locks(path, STALE_GIT_LOCK_H):
        if apply:
            os.remove(p)
        print("STALE git lock %s in %s/%s%s" % (os.path.relpath(p, path), repo, d, " removed" if apply else ""))
    if C.M.git(["remote", "get-url", "origin"], cwd=path).stdout.strip() != M.url(full):
        if apply:
            C.M.git(["remote", "set-url", "origin", M.url(full)], cwd=path)
        print("ORIGIN of %s/%s set to GitHub%s" % (repo, d, "" if apply else " (dry run)"))
    if os.path.exists(os.path.join(path, ".git", "factory-merging")) and apply:
        C.M.git(["merge", "--abort"], cwd=path)
        os.remove(os.path.join(path, ".git", "factory-merging"))
        print("CLEARED a cut-off automatic merge in %s/%s" % (repo, d))
    head = C.M.git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path).stdout.strip()
    if head != branch:
        print("BRANCH of %s/%s is %s, not %s; left as it is" % (repo, d, head, branch))
    h = age_h(path)
    if not os.path.exists(os.path.join(path, ".git", C.READY)) and (h is None or h >= 1):
        print("INCOMPLETE %s/%s: run `wt new %s %s %s` to finish it" % (repo, d, repo, issue, chunk))


def rebuild_missing(apply):
    for f in sorted(os.listdir(F.STATE)) if os.path.isdir(F.STATE) else []:
        m = re.fullmatch(r"wt__(.+)__(\d+-[a-z0-9]{1,12})\.json", f)
        if not m:
            continue
        repo, d = m.groups()
        rec = F.reg_read(repo, d)
        if rec.get("checkout") != "clone" or os.path.exists(os.path.join(F.WT, repo, d)):
            continue
        full, branch = rec.get("repo") or F.repo_full(repo), "chunk/" + d
        gh = github(full, rec.get("issue"), branch)
        if gh is None or gh[1].get("state") == "closed" or any(x.get("state", "").upper() == "MERGED" for x in gh[0]):
            continue
        r = C.M.git(["ls-remote", "--heads", M.url(full), branch])
        if r.returncode or not r.stdout.strip():
            print("MISSING %s/%s: no folder and no pushed branch; the next `wt new` makes it" % (repo, d))
            continue
        if apply:
            info = F.api("repos/%s" % full) or {}
            C.new(full, rec["issue"], rec["chunk"], rec.get("base"), rec.get("owner", "unknown"), info.get("default_branch", "main"), start=branch)
        print("REBUILT %s/%s from the pushed branch %s" % (repo, d, branch))


def old_tmp(apply):
    for e in sorted(os.listdir(C.tmp_root())) if os.path.isdir(C.tmp_root()) else []:
        p = os.path.join(C.tmp_root(), e)
        m = re.fullmatch(r"(.+)-(\d+-[a-z0-9]{1,12})", e)
        lk = C.try_lease(*m.groups()) if m else None
        if lk is None and (m or time.time() - os.path.getmtime(p) <= 3600):
            continue
        try:
            if apply:
                shutil.rmtree(p, ignore_errors=True)
            print("TMP %s removed%s" % (e, "" if apply else " (dry run)"))
        finally:
            if lk:
                lk.close()


def doctor(apply):
    faults = 0
    for repo, d, path in clones():
        lk = C.try_lease(repo, d)
        if lk is None or busy(path):
            if lk:
                lk.close()
            print("SKIP   %s/%s  live" % (repo, d))
            continue
        try:
            check_one(F.reg_read(repo, d).get("repo") or F.repo_full(repo), repo, d, path, apply)
        except Exception as e:
            faults += 1
            print("DOCTOR FAULT %s/%s: %s" % (repo, d, str(e)[:300]))
        finally:
            lk.close()
    try:
        rebuild_missing(apply)
        old_tmp(apply)
    except SystemExit:
        raise
    except Exception as e:
        faults += 1
        print("DOCTOR FAULT: %s" % str(e)[:300])
    return 1 if faults else 0


def main(a):
    if a[0] == "restore":
        if len(a) != 2:
            F.die("usage: wt restore <trash entry>")
        return restore(a[1])
    code = janitor("--apply" in a) if a[0] == "janitor" else doctor("--apply" in a)
    if code:
        sys.exit(code)
