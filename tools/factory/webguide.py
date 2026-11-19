import argparse
import base64
import fcntl
import glob
import hashlib
import http.client
import io
import json
import os
import re
import shutil
import sys
import tarfile
import time
import urllib.request

PIN = {
    "version": "1.0.0",
    "url": "https://registry.npmjs.org/modern-web-guidance/-/modern-web-guidance-1.0.0.tgz",
    "integrity": "sha512-vafIZwC8AS6QjM2yyoflZbnc7n3/TVOMLbEMRdPTwcFy0f9/Tq8s5rJQ8UIqRt2KPl9ixravyaMR4nTGuUrcmg==",
}
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "webguide")
WAIT = 3600
BUDGET = 40
SOCKET_TIMEOUT = 10
CHUNK = 1 << 20
NO_CDN = "Install it from the package registry at build time; never load it from a third-party host at run time."
BASE = "package/skills/modern-web-guidance/"
COPIED = {
    "package/LICENSE": "LICENSE",
    "package/THIRD_PARTY_NOTICES": "THIRD_PARTY_NOTICES",
    BASE + "gen/guides.json": "guides.json",
}
RETRIEVE = re.compile(r'npx -y modern-web-guidance@latest retrieve "([^"]+)"')
CDN_SENTENCE = re.compile(r"If not using a package manager, import from a CDN, e\.g\. `[^`]*`\.")
CDN_IMPORT = re.compile(r'"https://(?:unpkg\.com|cdn\.jsdelivr\.net/npm|esm\.sh)/((?:@[^/@"]+/)?[^/@"]+)@latest[^"]*"')
CHANGES = """Source: modern-web-guidance %(version)s, Apache-2.0, https://www.npmjs.com/package/modern-web-guidance
Pinned by the npm integrity value %(integrity)s

Kept: LICENSE, THIRD_PARTY_NOTICES, gen/guides.json (as guides.json) and the guide files under guides/<category>/<id>.md.
Not kept: SKILL.md, every .mjs program, watchdog/, the other gen/ files and chrome-extensions.

Rewrites of the guide text, in this order, and nothing else:
1. The upstream retrieve command line, run through a package runner at the latest tag, becomes: /data/tools/bin/webguide get <id>
2. The sentence that tells the reader to import from a CDN when no package manager is used becomes: %(no_cdn)s
3. A quoted unpkg.com, cdn.jsdelivr.net/npm or esm.sh address of a package at the latest tag becomes the bare package name in quotes.
"""


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


def notice(want=PIN["integrity"]):
    return CHANGES % {"version": PIN["version"], "integrity": want, "no_cdn": NO_CDN}


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def gone(root, rel, why="is missing"):
    return SystemExit("webguide: no usable guide copy at %s (%s %s); /data/tools/bin/webguide ensure installs the pinned copy" % (root, rel, why))


def rewrite(text):
    text = RETRIEVE.sub(r"/data/tools/bin/webguide get \1", text)
    text = CDN_SENTENCE.sub(lambda m: NO_CDN, text)
    return CDN_IMPORT.sub(r'"\1"', text)


def guide_target(name):
    if ".." in name or not name.startswith(BASE + "guides/") or not name.endswith(".md"):
        return None
    parts = name[len(BASE) + len("guides/"):].split("/")
    if len(parts) != 2 or not all(parts):
        return None
    return "guides/" + "/".join(parts)


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(body)


def install(data, into, want=PIN["integrity"]):
    if integrity(data) != want:
        raise SystemExit("webguide: tarball does not match the pinned checksum; nothing written")
    out = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        for m in t.getmembers():
            if not m.isreg():
                continue
            if m.name in COPIED:
                out[COPIED[m.name]] = t.extractfile(m).read()
                continue
            target = guide_target(m.name)
            if target:
                text = t.extractfile(m).read().decode("utf-8")
                out[target] = rewrite(text).encode("utf-8")
    for rel, body in out.items():
        write(os.path.join(into, rel), body)
    write(os.path.join(into, "CHANGES"), notice(want).encode("utf-8"))


def fetch(into, opener=urllib.request.urlopen):
    with opener(PIN["url"], timeout=60) as r:
        install(r.read(), into)


def missing(root, want=PIN["integrity"]):
    try:
        with open(os.path.join(root, "CHANGES"), encoding="utf-8") as f:
            if f.read() != notice(want):
                return "CHANGES"
    except (OSError, ValueError):
        return "CHANGES"
    try:
        with open(os.path.join(root, "guides.json"), encoding="utf-8") as f:
            index = json.load(f)
    except (OSError, ValueError):
        return "guides.json"
    if not isinstance(index, list) or not all(
            isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("category"), str) for e in index):
        return "guides.json"
    for e in index:
        rel = "guides/%s/%s.md" % (e["category"], e["id"])
        if not os.path.isfile(os.path.join(root, rel)):
            return rel
    return None


def last_try(path):
    try:
        with open(path, encoding="utf-8") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def ensure(root=ROOT, opener=urllib.request.urlopen, want=PIN["integrity"], now=time.time, clock=time.monotonic,
           rename=os.rename, force=False):
    if root == "" or os.path.abspath(root) == "/":
        return 2, "webguide: --dir must name a folder below /; nothing done"
    root = os.path.abspath(root)
    os.makedirs(os.path.dirname(root), exist_ok=True)
    with open(root + ".lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 0, "webguide: another install of the guide copy is running; nothing done"
        olds = [p for p in glob.glob(root + ".old.*") if os.path.isdir(p)]
        if not os.path.exists(root) and olds:
            rename(max(olds, key=os.path.getmtime), root)
        if not force and missing(root, want) is None:
            return 0, "webguide: pinned copy %s in place at %s" % (PIN["version"], root)
        tried = root + ".tried"
        t = last_try(tried)
        if not force and t is not None and now() - t < WAIT:
            return 1, "webguide: the last try at %s did not install the copy; next try after %s" % (iso(t), iso(t + WAIT))
        for p in glob.glob(root + ".stage.*") + glob.glob(root + ".old.*"):
            shutil.rmtree(p, ignore_errors=True)
        stamp = int(now())
        with open(tried, "w", encoding="utf-8") as f:
            f.write("%d" % stamp)
        stage = root + ".stage.%d" % os.getpid()
        old = root + ".old.%d" % os.getpid()
        try:
            start = clock()
            chunks = []
            with opener(PIN["url"], timeout=SOCKET_TIMEOUT) as r:
                while True:
                    b = r.read(CHUNK)
                    if not b:
                        break
                    chunks.append(b)
                    if clock() - start > BUDGET:
                        raise TimeoutError("the download passed %d s" % BUDGET)
            install(b"".join(chunks), stage, want)
            if os.path.exists(root):
                rename(root, old)
            rename(stage, root)
        except (OSError, SystemExit, tarfile.TarError, ValueError, http.client.HTTPException) as e:
            if not os.path.exists(root) and os.path.exists(old):
                try:
                    rename(old, root)
                except OSError:
                    pass
            shutil.rmtree(stage, ignore_errors=True)
            return 1, "webguide: install failed (%s); next try after %s" % ((str(e) or type(e).__name__)[:200], iso(stamp + WAIT))
        shutil.rmtree(old, ignore_errors=True)
        try:
            os.remove(tried)
        except OSError:
            pass
        return 0, "webguide: installed pinned copy %s at %s" % (PIN["version"], root)


def load_index(root):
    try:
        with open(os.path.join(root, "guides.json"), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise gone(root, "guides.json")
    except ValueError:
        raise gone(root, "guides.json", "is unreadable")


def words(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def search(query, root=ROOT, limit=5):
    q = words(query)
    scored = []
    for e in load_index(root):
        score = 2 * len(q & words(e["id"])) + len(q & words(e.get("description", "")))
        if score > 0:
            scored.append((-score, e["id"], e.get("description", "")))
    scored.sort()
    return [{"id": i, "description": d} for _, i, d in scored[:limit]]


def get(gid, root=ROOT):
    for e in load_index(root):
        if e["id"] == gid:
            try:
                with open(os.path.join(root, "guides", e["category"], gid + ".md"), encoding="utf-8") as f:
                    return f.read()
            except FileNotFoundError:
                raise gone(root, "guides/%s/%s.md" % (e["category"], gid))
    raise SystemExit("webguide: no guide named %s" % gid)


def main(argv=None):
    p = argparse.ArgumentParser(prog="webguide")
    p.add_argument("--dir", default=ROOT)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("search").add_argument("query")
    sub.add_parser("get").add_argument("id")
    sub.add_parser("install").add_argument("tarball")
    sub.add_parser("fetch")
    sub.add_parser("ensure")
    a = p.parse_args(argv)
    if a.cmd == "search":
        print(json.dumps(search(a.query, a.dir)))
    elif a.cmd == "get":
        sys.stdout.write(get(a.id, a.dir))
    elif a.cmd == "install":
        with open(a.tarball, "rb") as f:
            install(f.read(), a.dir)
    else:
        code, line = ensure(a.dir, force=a.cmd == "fetch")
        print(line)
        return code
    return 0


if __name__ == "__main__":
    sys.exit(main())
