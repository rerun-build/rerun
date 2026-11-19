# Code servers: owner runbook

Four read-only code servers (rerun, testpilot, terminal-commander, Agent_Army_Professionals) run from `deploy/vps/code-intel.yml`. Run every line from the repository folder on the server. No step restarts an engine.

Each server builds its index in memory when it starts and keeps it there. In `.symforge/` inside its checkout it writes only state files (`api-keys.db`, `stel-ledger.db`), which is why each checkout is mounted writable. It writes no `index.bin`, and neither does a one-off `code-q` question; an `index.bin` already in a shared checkout is left from an earlier run. The factory moves each shared checkout to its base after every fetch (`follow_base` in `tools/factory/factory.py`). A running server whose watcher is active picks up the changed files by itself, with no restart. This was measured once, with symforge 11.21.0 on a copy of terminal-commander on 2026-11-19: after the copy moved back 40 commits, the indexed file count began to change within 5 seconds, and lookups can be slow while it settles. `watching` in a status line means the watcher reports `active`.

## 1. Prepare

Check that the volume and the two networks exist. Compose names them after its project: `rerun_engine-data`, `rerun-dev_default` (dev engine) and `rerun_default` (live engine).

```sh
sudo docker volume ls --format '{{.Name}}'
sudo docker network ls --format '{{.Name}}'
```

Record the volume path and the first network in `deploy/vps/.env`. Run these two lines once: each run appends, so a second run adds the same entries again.

```sh
sudo sh -c 'docker volume inspect rerun_engine-data --format "{{.Mountpoint}}" | sed "s/^/CODE_INTEL_DATA=/" >> deploy/vps/.env'
sudo sh -c 'echo CODE_INTEL_NETWORK=rerun-dev_default >> deploy/vps/.env'
```

## 2. Key and config

The key is written straight into its file and never printed.

```sh
sudo sh -c 'mkdir -p "$(docker volume inspect rerun_engine-data --format "{{.Mountpoint}}")/tools/etc"'
sudo sh -c 'umask 077; od -An -tx1 -N32 /dev/urandom | tr -d " \n" > "$(docker volume inspect rerun_engine-data --format "{{.Mountpoint}}")/tools/etc/code-intel.key"'
sudo sh -c 'chown 1001:1001 "$(docker volume inspect rerun_engine-data --format "{{.Mountpoint}}")/tools/etc/code-intel.key"'
sudo sh -c 'printf "{\"keyFile\": \"/data/tools/etc/code-intel.key\", \"servers\": {\"rerun\": \"http://code-rerun:8787/mcp\", \"testpilot\": \"http://code-testpilot:8787/mcp\", \"terminal-commander\": \"http://code-terminal-commander:8787/mcp\", \"Agent_Army_Professionals\": \"http://code-agent-army-professionals:8787/mcp\"}}\n" > "$(docker volume inspect rerun_engine-data --format "{{.Mountpoint}}")/tools/etc/code-q.json"'
```

## 3. Tools

The factory tools are installed into `/data/tools` the usual way: a coworker runs `tools/factory/install.sh`. The owner does not.

## 4. Trial beside the dev engine

```sh
sudo docker compose -f deploy/vps/code-intel.yml up -d
sudo sh deploy/vps/code-intel-status.sh
```

The compose lines must read `<service> running`, one for each of the four servers.

The status lines must read `<repo> up ready`, followed by the file count, `watching` and the fetch age. `not watching` means that index no longer follows its checkout: restart that one service with `sudo docker compose -f deploy/vps/code-intel.yml restart <service>`. `watching unknown` means this symforge does not report its watcher; the fetch age is then the only freshness signal.

## 5. Beside the live engine

```sh
sudo sed -i 's/^CODE_INTEL_NETWORK=.*/CODE_INTEL_NETWORK=rerun_default/' deploy/vps/.env
sudo docker compose -f deploy/vps/code-intel.yml up -d --force-recreate
sudo sh deploy/vps/code-intel-status.sh
```

Expect the same lines as in step 4.

## 6. Fallback check

Stop one server and check that the others stay up.

```sh
sudo docker compose -f deploy/vps/code-intel.yml stop code-terminal-commander
sudo sh deploy/vps/code-intel-status.sh
sudo docker compose -f deploy/vps/code-intel.yml start code-terminal-commander
```

Expect `terminal-commander down` in the status lines and `code-terminal-commander` not `running` in the compose lines; every other line reads as in step 4.

## 7. Speed and cost check

A coworker runs these from its shell after step 5 shows every server ready, and not within a minute of a fetch; the owner does not. Run them one at a time, by one coworker. Agent_Army_Professionals is the largest checkout by size and rerun the largest by file count. Each line asks one question eleven times through the server, then once through a one-off symforge, and ends with `PASS` or `FAIL:` and the reason. `PASS` means lookups 2 to 11 each answered in under 1000 ms, and the server's answer is no longer than the one-off answer. The length comparison stands in for input tokens, because the answer text is all that `code-q` adds to a coworker's context. A `FAIL` that names slow lookups right after a fetch is run again once.

```sh
/data/tools/bin/code-q --check Agent_Army_Professionals search_symbols '{"query": "main"}'
/data/tools/bin/code-q --check rerun find_references '{"name": "follow_base"}'
pgrep -fa '[s]ymforge daemon' || echo no daemon left
```

The last line must print `no daemon left`. The brackets keep `pgrep` from matching its own shell.

## 8. Undo

```sh
sudo docker compose -f deploy/vps/code-intel.yml down
```
