import json, os, re, urllib.parse, urllib.request, urllib.error


class GhError(Exception):
    def __init__(self, msg, status=None):
        super().__init__(msg)
        self.status = status


class Client:
    def __init__(self, base, repo, token_env="GH_TOKEN"):
        self.base, self.repo, self.token_env = base.rstrip("/"), repo, token_env

    def __repr__(self):
        return "Client(%s, %s)" % (self.base, self.repo)

    def _open(self, method, url, body=None, accept="application/json", raw=False):
        tok = os.environ.get(self.token_env)
        if not tok:
            raise GhError("no token in environment variable %s" % self.token_env)
        req = urllib.request.Request(url, method=method, headers={"Authorization": "token " + tok,
                                     "Accept": accept, "Content-Type": "application/json"},
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                return (data.decode("utf-8", "replace") if raw else json.loads(data or b"null")), r.headers.get("Link")
        except urllib.error.HTTPError as e:
            e.close()
            raise GhError("%s %s failed: HTTP %d" % (method, url.split("?")[0], e.code), e.code) from None
        except urllib.error.URLError as e:
            raise GhError("%s %s failed: %s" % (method, url.split("?")[0], type(e.reason).__name__)) from None

    def req(self, method, path, body=None):
        return self._open(method, self.base + "/repos/" + self.repo + path, body)[0]

    def get(self, path):
        return self.req("GET", path)

    def pages(self, path, per_page=100):
        url = "%s/repos/%s%s%sper_page=%d" % (self.base, self.repo, path, "&" if "?" in path else "?", per_page)
        while url:
            data, link = self._open("GET", url)
            yield from data
            m = re.search(r'<([^>]+)>;\s*rel="next"', link or "")
            url = m.group(1) if m else None
            if url and urllib.parse.urlsplit(url)[:2] != urllib.parse.urlsplit(self.base)[:2]:
                url = None

    def issue(self, n):
        return self.get("/issues/%d" % n)

    def comments(self, n, per_page=100):
        return list(self.pages("/issues/%d/comments" % n, per_page))

    def commit(self, sha):
        return self.get("/commits/" + sha)

    def statuses(self, sha):
        return self.get("/commits/%s/status" % sha)

    def checks(self, sha):
        return self.get("/commits/%s/check-runs" % sha)["check_runs"]

    def pr_by_head(self, branch):
        head = urllib.parse.quote(self.repo.split("/")[0] + ":" + branch, safe="")
        prs = self.get("/pulls?state=all&head=" + head)
        prs = sorted(prs, key=lambda p: (p["state"] == "open", p["number"]), reverse=True)
        if not prs:
            return None
        p = prs[0]
        merged = bool(p.get("merged_at"))
        return {"number": p["number"], "state": p["state"], "merged": merged,
                "merge_sha": p.get("merge_commit_sha") if merged else None}

    def open_pr(self, title, head, base, body=""):
        try:
            found = self.pr_by_head(head)
        except GhError as e:
            if e.status != 404:
                raise
            found = None
        if found and found["state"] == "open":
            return found
        return self.req("POST", "/pulls", {"title": title, "head": head, "base": base, "body": body})

    def branch_sha(self, branch):
        return self.get("/git/ref/heads/" + urllib.parse.quote(branch, safe="/"))["object"]["sha"]

    def merged_prs(self, base, since):
        out = []
        for p in self.pages("/pulls?state=closed&sort=updated&direction=desc&base=" + urllib.parse.quote(base)):
            if p["updated_at"] < since:
                break
            if p.get("merged_at") and p["merged_at"] >= since:
                files = [f["filename"] for f in self.pages("/pulls/%d/files" % p["number"])]
                out.append({"number": p["number"], "base": base, "sha": p["merge_commit_sha"], "files": files})
        return out

    def issues_since(self, since):
        return [i for i in self.pages("/issues?state=open&since=" + urllib.parse.quote(since))
                if i["created_at"] >= since]

    def create_issue(self, title, body=""):
        return self.req("POST", "/issues", {"title": title, "body": body})

    def compare_diff(self, base, branch):
        q = lambda b: urllib.parse.quote(b, safe="/")
        url = "%s/repos/%s/compare/%s...%s" % (self.base, self.repo, q(base), q(branch))
        return self._open("GET", url, accept="application/vnd.github.diff", raw=True)[0]
