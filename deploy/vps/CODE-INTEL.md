# Code servers: owner runbook

Four read-only code servers (rerun, testpilot, terminal-commander, Agent_Army_Professionals) run from `deploy/vps/code-intel.yml`. Run every line from the repository folder on the server. No step restarts an engine.

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

The compose lines must read `<service> running`, one for each of the four servers. The status lines must read `<repo> up ready`, followed by the file count and the fetch age.

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

## 7. Undo

```sh
sudo docker compose -f deploy/vps/code-intel.yml down
```
