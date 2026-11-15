import argparse
import http.client
import json
import sys
import urllib.parse

MAX_BODY = 1000000
SLUG_HOST_PREFIX = "runtime-check-no-such-slug."


def get(base, path, deadline, host=None):
    parts = urllib.parse.urlsplit(base)
    if parts.scheme == "https":
        conn = http.client.HTTPSConnection(parts.hostname, parts.port, timeout=deadline)
    else:
        conn = http.client.HTTPConnection(parts.hostname, parts.port, timeout=deadline)
    try:
        headers = {"Host": host} if host else {}
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        body = resp.read(MAX_BODY)
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, body
    finally:
        conn.close()


def liveness(base, deadline, opts):
    status, _, body = get(base, "/api/version", deadline)
    if status != 200:
        return False, "status %d" % status
    data = json.loads(body)
    if not isinstance(data, dict) or "buildSha" not in data:
        return False, "no buildSha"
    return True, "buildSha present"


def settings_redirect(base, deadline, opts):
    status, headers, _ = get(base, "/settings", deadline)
    if not 300 <= status < 400:
        return False, "status %d" % status
    path = urllib.parse.urlsplit(headers.get("location", "")).path
    if path != "/":
        return False, "location path %r" % path
    return True, "redirects to /"


def redeem_404(base, deadline, opts):
    status, _, _ = get(base, "/redeem", deadline)
    return status == 404, "status %d" % status


def auth_email_field(base, deadline, opts):
    status, _, body = get(base, "/auth", deadline)
    if status != 200:
        return False, "status %d" % status
    html = body.decode("utf-8", "replace").lower()
    index = 0
    while True:
        index = html.find("<input", index)
        if index < 0:
            return False, "no email input"
        end = html.find(">", index)
        tag = html[index : end if end > 0 else len(html)]
        compact = tag.replace(" ", "").replace("'", '"')
        if 'type="email"' in compact:
            return True, "email input found"
        index += 6


def published_unknown_slug(base, deadline, opts):
    if not opts.publish_host:
        return None, "no --publish-host"
    status, _, _ = get(base, "/", deadline, host=SLUG_HOST_PREFIX + opts.publish_host)
    return status == 404, "status %d" % status


def engine_health(base, deadline, opts):
    if not opts.engine_url:
        return None, "no --engine-url"
    status, _, body = get(opts.engine_url, "/health", deadline)
    if status != 200:
        return False, "status %d" % status
    data = json.loads(body)
    if not isinstance(data, dict) or data.get("status") != "ok":
        return False, "status field not ok"
    return True, "status ok"


CHECKS = [
    ("liveness", liveness),
    ("settings-redirect", settings_redirect),
    ("redeem-404", redeem_404),
    ("auth-email-field", auth_email_field),
    ("published-unknown-slug", published_unknown_slug),
    ("engine-health", engine_health),
]


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("--publish-host")
    parser.add_argument("--engine-url")
    parser.add_argument("--deadline", type=float, default=10)
    opts = parser.parse_args(argv)
    failed = False
    for name, fn in CHECKS:
        try:
            ok, detail = fn(opts.base_url, opts.deadline, opts)
        except Exception as exc:
            ok, detail = False, "%s: %s" % (type(exc).__name__, exc)
        label = "SKIP" if ok is None else "PASS" if ok else "FAIL"
        failed = failed or label == "FAIL"
        print("%s %s %s" % (label, name, detail))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
