import json, os, re

SHA = re.compile(r"[0-9a-f]{40}")
WORKFLOW = "Factory tools"


def write(path, text):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    os.replace(tmp, path)


def target(gh, repo, current, skip):
    commits = json.loads(gh(["api", "repos/%s/commits?sha=dev&path=tools/factory&per_page=1" % repo]))
    if not commits:
        return None
    sha = commits[0]["sha"]
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("newest commit id is not a commit id")
    if sha in (current, skip):
        return None
    runs = json.loads(gh(["api", "repos/%s/actions/runs?head_sha=%s&per_page=100" % (repo, sha)])).get("workflow_runs") or []
    return sha if any(r.get("name") == WORKFLOW and r.get("conclusion") == "success" for r in runs) else None
