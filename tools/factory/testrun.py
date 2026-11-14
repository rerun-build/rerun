import os
import subprocess


ENV_ALLOWED = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")


def _rc(path, cmd, timeout):
    env = {k: os.environ[k] for k in ENV_ALLOWED if k in os.environ}
    try:
        return subprocess.run(cmd, cwd=path, env=env, capture_output=True, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        return 124
    except OSError:
        return 127


def run(base_path, head_path, cmd, timeout=600):
    base, head = _rc(base_path, cmd, timeout), _rc(head_path, cmd, timeout)
    verdict = "passes_on_base" if base == 0 else "fails_on_head" if head else "ok"
    return {"verdict": verdict, "base": base, "head": head}
