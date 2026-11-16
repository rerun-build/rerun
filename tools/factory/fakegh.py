import json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs


class Fake:
    def __init__(self, issues=None, comments=None, commits=None, statuses=None, checks=None, diffs=None, pulls=None, files=None):
        self.issues, self.comments, self.commits = dict(issues or {}), comments or {}, commits or {}
        self.diffs, self.statuses, self.checks, self.calls, self.next = dict(diffs or {}), statuses or {}, checks or {}, [], 72
        self.pulls, self.files, self.queries = list(pulls or []), dict(files or {}), []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                u = urlparse(self.path)
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n)) if n else None
                fake.calls.append((self.command, u.path, body, self.headers.get("Authorization")))
                fake.queries.append(parse_qs(u.query))
                code, out, link = fake.route(self.command, u.path.split("/")[4:], parse_qs(u.query))
                data = out.encode() if isinstance(out, str) else json.dumps(out).encode()
                self.send_response(code)
                self.send_header("Content-Length", str(len(data)))
                if link:
                    self.send_header("Link", link)
                self.end_headers()
                self.wfile.write(data)

            do_POST = do_GET

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def route(self, m, p, q):
        if m == "POST" and p in (["issues"], ["pulls"]):
            self.next += 1
            return 201, {"number": self.next - 1}, None
        if m == "GET" and len(p) > 1 and p[0] == "compare":
            b, _, h = "/".join(p[1:]).partition("...")
            d = self.diffs.get((b, h))
            return (200, d, None) if d is not None else (404, {"message": "Not Found"}, None)
        if m == "GET" and p == ["issues"]:
            return 200, list(self.issues.values()), None
        if m == "GET" and p == ["pulls"] and "base" in q:
            return 200, [x for x in self.pulls if x["base"]["ref"] == q["base"][0]], None
        if m == "GET" and len(p) == 3 and p[0] == "pulls" and p[2] == "files":
            return 200, [{"filename": f} for f in self.files.get(int(p[1]), [])], None
        i, sub = (p + ["", ""])[1], (p + ["", "", ""])[2]
        out = {("issues", ""): lambda: self.issues.get(int(i or 0)), ("commits", ""): lambda: self.commits.get(i),
               ("commits", "status"): lambda: self.statuses.get(i, []),
               ("commits", "check-runs"): lambda: self.checks.get(i, {"check_runs": []})}
        if m == "GET" and p and p[0] == "issues" and sub == "comments":
            per, pg = int(q.get("per_page", [30])[0]), int(q.get("page", [1])[0])
            items = self.comments.get(int(i), [])
            nxt = '<%s/repos/o/r/%s?per_page=%d&page=%d>; rel="next"' % (self.url, "/".join(p), per, pg + 1)
            return 200, items[(pg - 1) * per:pg * per], nxt if pg * per < len(items) else None
        got = out[(p[0], sub)]() if m == "GET" and p and (p[0], sub) in out else None
        return (200, got, None) if got is not None else (404, {"message": "Not Found"}, None)

    def start(self):
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()
