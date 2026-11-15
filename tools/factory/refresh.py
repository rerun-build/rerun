import json, os, re

SHA = re.compile(r"[0-9a-f]{40}")
RUNS = "repos/%s/actions/workflows/factory-tools.yml/runs?branch=dev&event=push&status=success&per_page=1"
COMMITS = "repos/%s/commits?sha=%s&path=tools/factory&per_page=1"


class NoTarget(Exception):
    pass


def write(path, text):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    os.replace(tmp, path)


def commit_id(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError("not a commit id")
    return value


def target(gh, repo, current, skip):
    runs = json.loads(gh(["api", RUNS % repo])).get("workflow_runs") or []
    if not runs:
        raise NoTarget("no green push run of factory-tools.yml on dev")
    head = commit_id(runs[0]["head_sha"])
    commits = json.loads(gh(["api", COMMITS % (repo, head)]))
    if not commits:
        raise NoTarget("no tools/factory commit behind %s" % head[:7])
    sha = commit_id(commits[0]["sha"])
    return None if sha in (current, skip) else sha
