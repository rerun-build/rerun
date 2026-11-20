# `F21`: `deploy/vps/update.sh` Concatenates Multi-Network Docker Names, Breaks on Special Characters in `POSTGRES_PASSWORD`, Leaves `factory-runner.Dockerfile` With `CRLF`, and Can Leave Migrations Applied Before Restart

- **Finding:** In `deploy/vps/update.sh`, `docker inspect` concatenates multiple Docker network names without a delimiter (`line 63`), `POSTGRES_PASSWORD` is interpolated raw into `SUPABASE_DB_URL` without URI-encoding (`line 64`), and `deploy/vps/factory-runner.Dockerfile` is committed with Windows `CRLF` line endings because `.gitattributes` only matches `Dockerfile*` (prefix) and misses `*.Dockerfile`.

## Evidence

- `deploy/vps/update.sh:61-68,77-83`:
  ```sh
  PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$SUPABASE_DIR/.env" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/")
  [ -n "$PW" ] || { echo "No POSTGRES_PASSWORD in $SUPABASE_DIR/.env"; exit 1; }
  NET=$(docker inspect "$SUPABASE_DB_CONTAINER" -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  SUPABASE_DB_URL="postgresql://postgres:$PW@db:5432/postgres?sslmode=disable"
  export SUPABASE_DB_URL
  docker run --rm --network "$NET" -v "$REPO/supabase:/work/supabase" -w /work --user "$OWNER" -e HOME=/tmp -e SUPABASE_DB_URL node:26 \
      sh -c "npx -y $SUPABASE_CLI db push --include-all --yes --db-url \"\$SUPABASE_DB_URL\""
  ```
- `.gitattributes:1-6`:
  ```gitattributes
  # Files that run on Linux (containers, servers, CI) keep LF even when checked out on Windows.
  *.sh text eol=lf
  *.mjs text eol=lf
  *.yml text eol=lf
  *.yaml text eol=lf
  Dockerfile* text eol=lf
  ```
- **Command / test run:**
  1. `python -c "import subprocess; files = subprocess.check_output(['git', 'ls-files', '*.sh', 'Dockerfile*', '*.Dockerfile', '*.yml', '*.yaml', '*.mjs']).decode().splitlines(); print('TRACKED CRLF FILES:', [f for f in files if b'\r\n' in open(f, 'rb').read()])"`:
     ```text
     TRACKED CRLF FILES: ['deploy/vps/factory-runner.Dockerfile']
     ```
  2. `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_keeper test_doctor test_rotate_engine_key"`:
     ```text
     OK (all keeper, doctor, and rotate_engine_key tests pass; note test_deploy_files failed under WSL on Windows checkout because tools/factory/install.sh and tools/factory/factory.py ALSO lack *.py / tools/factory/bin/* LF rules in .gitattributes, so grep -qx 'CLONE_SAFE = 1' factory.py fails against CRLF!)
     ```

## Trigger

1. **CRLF checkout bug breaking Linux scripts & `install.sh` (`.gitattributes:1-6`, `tools/factory/install.sh:18`):** `.gitattributes` lists `*.sh`, `*.mjs`, `*.yml`, `*.yaml`, and `Dockerfile*`, missing `*.Dockerfile` (`deploy/vps/factory-runner.Dockerfile` has CRLF in git right now!), `*.py`, and extensionless Linux wrapper scripts under `tools/factory/bin/*`! As just proven live in WSL (`test_deploy_files` exit 2), checking out the repo on Windows or copying `tools/factory/` gives `factory.py` and `tools/factory/bin/*` `\r\n` endings, causing `grep -qx 'CLONE_SAFE = 1' "$HERE/factory.py"` in `install.sh:18` to fail with exit code 2 and `#!/usr/bin/env python3\r` in `tools/factory/bin/*` to fail with `env: 'python3\r': No such file or directory`!
2. **Multi-network `docker inspect` concatenation (`update.sh:63`):** If `supabase-db` is connected to more than one Docker network (e.g. `supabase_default` and a monitoring/bridge network), `'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'` outputs `networkAnetworkB` with no separator, causing `docker run --network "$NET"` at `line 66` to abort mid-deploy after `drain` was already set!
3. **Unencoded `POSTGRES_PASSWORD` in URI (`update.sh:64`):** Any `#`, `?`, `@`, `/`, or `%` character in `POSTGRES_PASSWORD` corrupts `postgresql://postgres:$PW@db:5432/...` (`supabase db push` fails or connects to the wrong host/user), whereas passing `PGPASSWORD` or percent-encoding avoids URI-parsing failures.
4. **Migration runs before `wait_drained` (`update.sh:66-70`):** Step `3/4 database migrations` pushes new schema changes to live Postgres *while* running factory/app containers are still draining for up to 60 minutes (`wait_drained` is at `line 70`, *after* `db push` at `line 67`).

*(What holds: Neither `update.sh`, `keeper.sh`, nor `tidy.sh` runs `docker volume prune` or deletes `/data` or Postgres volumes — only `docker image prune -f` and `docker builder prune -af`.)*

## Impact and severity

- **Severity:** `medium` (High if `supabase-db` joins a second network or `POSTGRES_PASSWORD` contains URL metacharacters, aborting `update.sh` mid-deploy)
- **Impact:** Mid-update deploy failure in `update.sh`, CRLF shebang / `grep -qx` breakage on `tools/factory/bin/*`, `tools/factory/*.py`, and `*.Dockerfile` when touched from Windows, and up to 60 minutes of old app code running against newly migrated DB schemas during `wait_drained`.

## Proposed fix

- **Smallest causal change (`deploy/vps/update.sh`, `.gitattributes`):**
  1. In `deploy/vps/update.sh:63-67`:
     - Pick solely the network matching `*supabase*` or the first network line: `NET=$(docker inspect "$SUPABASE_DB_CONTAINER" -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | grep -E 'supabase|default' | head -n 1)` (fallback `head -n 1`).
     - URL-encode `$PW` via `node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$PW"` inside the `node:26` container (`-e PW="$PW"`, building `postgresql://postgres:${encodeURIComponent(process.env.PW)}@db:5432/postgres?sslmode=disable` in Node) so `SUPABASE_DB_URL` never breaks on special characters and never appears on a command line.
     - Move `wait_drained` (`line 70`) *before* `3/4 database migrations` (`line 60`) so running work finishes before schema changes and container restarts happen back-to-back.
  2. In `.gitattributes`, add `*.Dockerfile text eol=lf`, `tools/factory/** text eol=lf`, and `scripts/** text eol=lf`, and normalize `deploy/vps/factory-runner.Dockerfile`.
- **Must not break:** Existing `deploy/vps/update.sh` single-network Supabase setups and `test_update_password.py` / `test_deploy_files.py`.
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_update_password.py` and `tools/factory/test_deploy_files.py`
  - **Test name:** `test_update_handles_multi_network_db_and_url_special_chars_in_password` and `test_gitattributes_keeps_factory_and_dockerfiles_lf`
  - **Assertion:** Simulate `POSTGRES_PASSWORD='p@ss#word/1%2'` and a two-network `docker inspect` output in `update.sh` dry harness and assert `db push` receives a valid single `--network` and percent-encoded URI; assert `.gitattributes` enforces `eol=lf` on `*.Dockerfile` and `tools/factory/**`.
- **Alternative fix and trade-off:** Set `* text=auto eol=lf` repo-wide in `.gitattributes` (except explicit `.bat`/`.cmd`/`.ps1` files if any are ever added). Simplest rule for a Linux-container monorepo developed from both macOS/Linux and Windows.

## Confidence

`proven`
