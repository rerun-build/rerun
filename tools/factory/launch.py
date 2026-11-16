import datetime, json, os, shutil, signal, subprocess, time

import refresh

HERE = os.path.dirname(os.path.abspath(__file__))
REFRESH_EXIT = 75
GOOD_BEATS = 3
TRIAL_S = 480
TRIAL_TRIES = 2
STOP_S = 120
POLL_S = 2
BACKOFF_S, BACKOFF_MAX_S = 5, 60
CALL_S = 300
SPARSE = ["sparse-checkout", "set", "--no-cone", "/tools/factory/"]


class Failed(Exception):
    pass


ERRORS = (Failed, OSError, ValueError, subprocess.SubprocessError)


def log(msg):
    print("%s launch: %s" % (datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), msg), flush=True)


def is_sha(value):
    return isinstance(value, str) and bool(refresh.SHA.fullmatch(value))


class Launcher:
    def __init__(self, state, app, repo, run=subprocess.run, spawn=subprocess.Popen, clock=time.time, sleep=time.sleep, env=os.environ):
        self.state, self.app, self.repo = state, app, repo
        self.src = os.path.join(state, "src")
        self.run, self.spawn, self.clock, self.sleep, self.env = run, spawn, clock, sleep, env
        self.backoff = BACKOFF_S
        self.stopping = False
        self.start_check, self.failed_switches = True, 0

    def stop_soon(self, *_):
        self.stopping = True

    def path(self, name):
        return os.path.join(self.state, name)

    def record(self):
        try:
            with open(self.path("launch.json"), encoding="utf-8") as f:
                rec = json.load(f)
        except (OSError, ValueError):
            rec = {}
        rec = rec if isinstance(rec, dict) else {}
        out = {k: rec[k] if is_sha(rec.get(k)) else None for k in ("good", "trial", "skip")}
        t = rec.get("timeout")
        ok = isinstance(t, dict) and is_sha(t.get("sha")) and isinstance(t.get("tries"), int)
        out["timeout"] = {"sha": t["sha"], "tries": t["tries"]} if ok else None
        return out

    def save(self, **change):
        refresh.write(self.path("launch.json"), json.dumps(dict(self.record(), **change)))

    def call(self, what, argv):
        p = self.run(argv, capture_output=True, text=True, timeout=CALL_S)
        if p.returncode:
            raise Failed("%s exit %d: %s" % (what, p.returncode, ((p.stderr or "").strip().splitlines() or [""])[-1]))

    def git(self, *args, top=None):
        self.call("git " + args[0], ["git", "-C", top or self.src] + list(args))

    def checkout(self, sha, fetch):
        if not os.path.isdir(os.path.join(self.src, ".git")):
            if not fetch:
                raise Failed("no clone in %s" % self.src)
            tmp = self.src + ".tmp"
            shutil.rmtree(tmp, ignore_errors=True)
            self.call("git clone", ["git", "clone", "--filter=blob:none", "--no-checkout", "--sparse",
                                    "https://github.com/%s.git" % self.repo, tmp])
            self.git(*SPARSE, top=tmp)
            if os.path.exists(self.src):
                shutil.rmtree(self.src, ignore_errors=True)
            os.rename(tmp, self.src)
        self.git(*SPARSE)
        if fetch:
            self.git("fetch", "-q", "--depth", "1", "origin", sha)
        self.git("checkout", "-q", "--detach", sha)
        code = os.path.join(self.src, "tools", "factory")
        if not os.path.isfile(os.path.join(code, "dispatch.py")):
            raise Failed("%s has no tools/factory/dispatch.py" % sha[:7])
        return code

    def compiles(self, code):
        files = sorted(os.path.join(d, f) for d, _, names in os.walk(code) for f in names if f.endswith(".py"))
        self.call("py_compile", ["python3", "-I", "-m", "py_compile"] + files)

    def pick(self):
        rec = self.record()
        for key in ("trial", "good"):
            if rec[key]:
                try:
                    return self.checkout(rec[key], False), rec[key]
                except ERRORS as e:
                    log("cannot check out %s %s: %s" % (key, rec[key][:7], e))
                    if key == "trial":
                        self.save(trial=None)
        return self.app, "app"

    def clean_beat(self, started):
        try:
            if os.path.getmtime(self.path("beat-ok")) < started:
                return None
            with open(self.path("beat-ok"), encoding="utf-8") as f:
                return int(f.read().strip())
        except (OSError, ValueError):
            return None

    def watch(self, p, sha, started):
        trial = self.record()["trial"] == sha
        last, streak, told = None, 0, False
        while True:
            rc = p.poll()
            n = self.clean_beat(started)
            if n is not None and n != last:
                streak, last = (streak + 1 if last is not None and n == last + 1 else 1), n
                if trial and streak >= GOOD_BEATS:
                    self.save(good=sha, trial=None)
                    log("%s is good after %d clean beats" % (sha[:7], GOOD_BEATS))
                    trial = False
            if rc is not None:
                return rc, False
            if self.stopping and not told:
                log("stop asked: passing it to the dispatcher at %s" % sha[:7])
                p.terminate()
                told = True
            elif trial and not self.stopping and self.clock() - started >= TRIAL_S:
                log("trial %s had %d of %d clean beats in %d s: stopping it" % (sha[:7], streak, GOOD_BEATS, TRIAL_S))
                return self.stop(p), True
            self.sleep(POLL_S)

    def stop(self, p):
        p.terminate()
        end = self.clock() + STOP_S
        while self.clock() < end:
            rc = p.poll()
            if rc is not None:
                return rc
            self.sleep(POLL_S)
        log("the dispatcher did not stop in %d s: killing it" % STOP_S)
        p.kill()
        return p.wait()

    def roll_back(self, sha, rc, timed_out, good):
        t = self.record()["timeout"]
        tries = (t["tries"] if t and t["sha"] == sha else 0) + 1
        then = (good or "app")[:7]
        if timed_out and tries < TRIAL_TRIES:
            self.save(trial=None, timeout={"sha": sha, "tries": tries})
            return log("rolled back %s: no %d clean beats in %d s; it gets one more trial; next start uses %s" % (sha[:7], GOOD_BEATS, TRIAL_S, then))
        self.save(trial=None, skip=sha, timeout=None)
        log("rolled back %s: exit %d before %d clean beats; skipped until a newer commit; next start uses %s" % (sha[:7], rc, GOOD_BEATS, then))

    def step(self):
        code, sha = self.pick()
        rec = self.record()
        env = dict(self.env, FACTORY_CODE_SHA=sha, FACTORY_START_CHECK="1" if self.start_check else "0")
        if rec["skip"]:
            env["FACTORY_SKIP_SHA"] = rec["skip"]
        script = os.path.join(code, "dispatch.py")
        log("starting %s at %s" % (script, sha[:7]))
        started = self.clock()
        rc, timed_out = self.watch(self.spawn(["python3", "-u", script, "run"], env=env), sha, started)
        if self.stopping:
            return log("stopped: the dispatcher at %s exited %d" % (sha[:7], rc))
        if self.clock() - started >= BACKOFF_MAX_S:
            self.backoff = BACKOFF_S
        self.start_check = True
        if rc == REFRESH_EXIT:
            if self.switch(sha):
                self.backoff = BACKOFF_S
                return
            self.start_check = False
        if self.record()["trial"] == sha:
            return self.roll_back(sha, rc, timed_out, rec["good"])
        log("dispatcher at %s exited %d: restarting in %d s" % (sha[:7], rc, self.backoff))
        self.sleep(self.backoff)
        self.backoff = min(self.backoff * 2, BACKOFF_MAX_S)

    def switch(self, current):
        try:
            with open(self.path("refresh-to"), encoding="utf-8") as f:
                sha = f.read().strip()
            os.remove(self.path("refresh-to"))
        except OSError as e:
            log("refresh: no target (%s); keeping %s" % (type(e).__name__, current[:7]))
            return False
        if not is_sha(sha):
            log("refresh: the target is not a commit id; keeping %s" % current[:7])
            return False
        try:
            code = self.checkout(sha, True)
        except ERRORS as e:
            self.failed_switches += 1
            note = ""
            if self.failed_switches >= 2 and os.path.exists(self.src):
                shutil.rmtree(self.src, ignore_errors=True)
                self.failed_switches, note = 0, "; the clone was removed and is made again next time"
            log("refresh to %s failed: %s; keeping %s, trying again at the next check%s" % (sha[:7], e, current[:7], note))
            return False
        self.failed_switches = 0
        try:
            self.compiles(code)
        except ERRORS as e:
            self.save(skip=sha)
            log("refresh to %s failed: %s; keeping %s" % (sha[:7], e, current[:7]))
            return False
        self.save(trial=sha)
        log("trial %s: checked out and compiled" % sha[:7])
        return True

    def loop(self):
        while not self.stopping:
            self.step()


def main():
    with open(os.path.join(HERE, "dispatch.json"), encoding="utf-8") as f:
        repo = json.load(f)["repo"]
    launcher = Launcher(os.environ.get("FACTORY_DATA_DIR", "/state"), HERE, repo)
    signal.signal(signal.SIGTERM, launcher.stop_soon)
    log("launcher started: %s" % json.dumps(launcher.record()))
    launcher.loop()
    log("launcher stopped")


if __name__ == "__main__":
    main()
