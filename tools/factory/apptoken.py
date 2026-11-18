import base64
import calendar
import http.client
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
EARLY = 900
MARGIN = 300
RETRY = 60


class Error(Exception):
    pass


def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def jwt(app_id, now, sign):
    head = b64(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps({"iat": int(now) - 60, "exp": int(now) + 540, "iss": str(app_id)}, separators=(",", ":")).encode())
    data = head + "." + body
    return data + "." + b64(sign(data.encode()))


def openssl_signer(key_path):
    def sign(data):
        try:
            p = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path], input=data, capture_output=True, timeout=30)
        except (subprocess.TimeoutExpired, OSError) as e:
            raise Error("the App key could not sign: %s" % type(e).__name__) from None
        if p.returncode != 0:
            raise Error("the App key could not sign (openssl exit %d)" % p.returncode)
        return p.stdout
    return sign


def http_post(url, headers):
    req = urllib.request.Request(url, data=b"", headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        raise Error("GitHub not reached: %s" % type(e).__name__) from None


def mint(app_id, installation, now, sign, post=http_post):
    headers = {"Authorization": "Bearer " + jwt(app_id, now, sign), "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "moldwright-factory"}
    status, body = post("%s/app/installations/%s/access_tokens" % (API, installation), headers)
    if status != 201:
        raise Error("mint refused: HTTP %d" % status)
    try:
        got = json.loads(body)
        return got["token"], calendar.timegm(time.strptime(got["expires_at"], "%Y-%m-%dT%H:%M:%SZ"))
    except (ValueError, KeyError, TypeError):
        raise Error("mint answer unreadable") from None


def write(path, token, expires):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".token.")
    try:
        with os.fdopen(fd, "w") as f:
            f.write("%s\n%d\n" % (token, int(expires)))
        os.chmod(tmp, 0o444)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def read(path, now):
    try:
        with open(path, encoding="utf-8") as f:
            token, expires = f.read().split("\n")[:2]
        if token and now < int(expires) - MARGIN:
            return token
    except (OSError, ValueError):
        pass
    return None


def wait_after(expires, now):
    if expires is None:
        return RETRY
    return max(RETRY, int(expires - EARLY - now))


def round_once(path, minter, log):
    try:
        token, expires = minter()
    except Error as e:
        log("token not renewed: %s; the old file stays" % e)
        return None
    write(path, token, expires)
    log("token renewed, valid until %s" % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires)))
    return expires


def main():
    app_id, installation = os.environ["FACTORY_APP_ID"], os.environ["FACTORY_APP_INSTALLATION"]
    key = os.environ.get("FACTORY_APP_KEY_FILE", "/run/secrets/app_key")
    path = os.environ.get("FACTORY_APP_TOKEN_FILE", "/token/token")
    sign = openssl_signer(key)

    def log(line):
        print("%s apptoken %s" % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), line), flush=True)

    while True:
        expires = round_once(path, lambda: mint(app_id, installation, time.time(), sign), log)
        time.sleep(wait_after(expires, time.time()))


if __name__ == "__main__":
    sys.exit(main())
