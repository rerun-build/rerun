import json, os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gatefiles.json")


def load(path=PATH):
    with open(path) as f:
        return tuple(json.load(f)["files"])


def touched(paths, files=None):
    return bool(files) and any(p in files for p in paths or [])
