# `A1a`: Coworker Shell Runs as Engine User `rerun` With Unrestricted Access to `/data` Secrets, Sibling Workspaces, `/run/factory-token`, and Docker Internal Network

- **Finding:** `shell_exec` spawns arbitrary shell commands directly as the engine's own `rerun` OS user with no filesystem namespace, UID isolation, or network egress filter, allowing any shell-enabled coworker to read `/data/connections/*/.env`, `/data/shared.env`, `/data/agents/<other>/*`, `/run/factory-token/token`, `/proc/<engine-pid>/*`, and reach internal Docker services (`http://app:3000`, `http://engine:3000`, `host.docker.internal`).

## Evidence

- `apps/engine/Dockerfile:17,25-30`:
  ```dockerfile
  RUN useradd --create-home --shell /bin/bash rerun && mkdir -p /data && chown rerun:rerun /data
  ...
  USER rerun
  ...
  ENV PATH="/home/rerun/.local/bin:${PATH}" \
      NODE_ENV=production \
      RERUN_DATA_DIR=/data \
  ```
- `apps/engine/src/tools/builtin/shell.ts:15,49-51`:
  ```ts
  const execAsync = promisify(exec) as unknown as ShellRunner
  ...
  try {
      const { stdout, stderr } = await run(command, { cwd, env, timeout: timeoutMs, maxBuffer: 10_000_000, signal: ctx.abortSignal })
      const text = redactSecrets(`${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`, secrets).slice(0, 50_000) || '(no output)'
  ```
- `apps/engine/src/config/paths.ts:20-73,86-94`:
  ```ts
  export const agentsDir = () => resolve(dataDir(), 'agents')
  export const sharedEnvPath = () => resolve(dataDir(), 'shared.env')
  ...
  export const connectionEnvPath = (id: string) => resolve(connectionDir(id), '.env')
  export const agentEnvPath = (id: string) => resolve(agentDir(id), '.env')
  export const agentDataDbPath = (id: string) => resolve(agentDataDir(id), 'agent.db')
  export const systemDbPath = (id: string) => resolve(agentDataDir(id), 'system.db')
  export const codexAuthPath = (connectionId: string) => resolve(codexHomeDir(connectionId), 'auth.json')
  export const mcpTokenPath = (id: string, name: string) => resolve(mcpDir(id), `${pathSegment(name, 'MCP server name')}.json`)
  ```
- `docker-compose.yml:47-50,66-67`:
  ```yaml
      volumes:
        - engine-data:/data
        - factory-token:/run/factory-token:ro
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ...
    factory-token:
      name: rerun_factory-token
      driver_opts: {type: tmpfs, device: tmpfs, o: "uid=10001,gid=10001,mode=0755,size=64k"}
  ```
- `tools/factory/apptoken.py:75-76`:
  ```python
          os.chmod(tmp, 0o444)
          os.replace(tmp, path)
  ```
- `apps/engine/src/pairing/pairing.ts:30`:
  ```ts
          if (!existsSync(pathOf(KEY_FILE))) writeFileSync(pathOf(KEY_FILE), randomBytes(32).toString('hex'), { mode: 0o600 })
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/tools/builtin/shell.test.ts src/tools/builtin/shell.env.test.ts src/config/env.test.ts src/deploy-config.test.ts`
  ```text
   ✓ src/deploy-config.test.ts (4 tests) 10ms
   ✓ src/config/env.test.ts (7 tests) 165ms
   ✓ src/tools/builtin/shell.test.ts (4 tests) 14ms
   ✓ src/tools/builtin/shell.env.test.ts (9 tests) 38ms
   Test Files  4 passed (4)
        Tests  24 passed (24)
  ```

## Trigger

Any coworker with `config.tools.shell === true` executes a `shell_exec` command (for example after prompt injection from an issue comment, webhook, or web page) such as:
- `base64 /data/connections/*/.env /data/connections/*/.codex/auth.json /run/factory-token/token /data/engine.key` (base64 encoding also bypasses `redactSecrets` in `shell.ts:51`, and connection `.env` secrets are not even passed to `redactSecrets` in `shell.ts:48`);
- `sqlite3 /data/agents/<other>/data/system.db "SELECT content_json FROM messages"` to read every other coworker's transcripts, memories, `.env`, and MCP OAuth tokens (`0o600` owned by the exact same `rerun` UID);
- `curl http://[IP_ADDRESS]:3000/connections` (if `RERUN_API_KEY` is unset or read from `/data/engine.key` or `/proc/1/mem`) or `curl http://host.docker.internal:...` / `http://app:3000/...` across the Docker bridge network.

*(Note: `docker-entrypoint.sh:3-25` + `config/env.ts:24-45` properly unsets `RERUN_API_KEY` from `/proc/1/environ` and closes FD 3 when launched via `RERUN_API_KEY_FILE`, and `/run/secrets/rerun_engine_key` permissions depend on Docker Engine's secret mount defaults [marked `unproven` without a live Docker daemon check], whereas self-paired engines store `RERUN_API_KEY` in `/data/engine.key` owned `0o600` by `rerun` [`pairing.ts:30`], which `shell_exec` reads directly.)*

## Impact and severity

- **Severity:** `critical`
- **Impact:** Complete loss of intra-engine isolation and secret confidentiality. Any prompt-injected or compromised coworker extracts workspace-wide Claude/Codex/OpenRouter OAuth & API credentials (`/data/connections/*`), the factory's live GitHub App installation token (`/run/factory-token/token`, `0o444`), paired `engine.key`, and every sibling coworker's private box files, SQLite databases, and MCP tokens, and can pivot to internal Docker and host services (`host.docker.internal`).

## Proposed fix

- **Smallest causal change (`apps/engine/Dockerfile`, `apps/engine/src/tools/builtin/shell.ts`, `docker-compose.yml`):**
  1. Create a second unprivileged OS user in `apps/engine/Dockerfile` (e.g. `coworker`, UID `10002`, group `coworker`) while keeping the engine daemon + `/data/connections`, `/data/shared.env`, `/data/engine.key`, `/data/rerun.db`, and `/data/agents/<id>/data/system.db` mode `0o600`/`0o700` owned by `rerun:rerun`.
  2. Run `shell_exec` inside a `bwrap` (bubblewrap) or unprivileged user/mount namespace wrapper in `apps/engine/src/tools/builtin/shell.ts` that bind-mounts only `/usr`, `/bin`, `/lib*`, `/etc/ssl`, `/tmp` (fresh tmpfs), and the single coworker's `workspaceDir(ctx.agent.id)` (plus `agentDataDbPath` only if `cfg.db` is enabled), masking `/data/connections`, `/data/agents/<other>`, `/data/engine.key`, `/run/factory-token`, and `/proc` (`--proc /proc` inside a new PID namespace `--unshare-pid` so PID 1 of the engine is invisible).
  3. Drop `extra_hosts: ["host.docker.internal:host-gateway"]` from `engine` in production `deploy/vps/docker-compose.vps.yml` (`!reset []`) and move `engine` onto an isolated egress network that cannot initiate connections to `webgate`, `supabase`, or host loopback.
- **Must not break:** Coworker `git`, `node`, `python3`, `npm`, and CLI builds inside `RERUN_WORKSPACE`; factory builder checkouts under `/data/work/wt` (bind-mounted only for coworkers explicitly configured with that root); local dev `supabase-bridge` when running local stack.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/tools/builtin/shell.test.ts`
  - **Test name:** `it('isolates shell_exec from connection secrets and sibling agent directories')`
  - **Assertion:** Create a temporary `/data` layout with `/data/connections/c1/.env` (`SECRET=topsecret123`) and `/data/agents/other/workspace/private.txt`, invoke `shellTools(ctx).shell_exec.execute({ command: 'cat ../../connections/c1/.env ../other/workspace/private.txt', timeoutMs: 5000 })`, and assert the command fails with `ENOENT` / `EACCES` and returns neither file's contents even when base64-encoded.
- **Alternative fix and trade-off:** Run each coworker in its own ephemeral container/microVM (Incus/gVisor). Gives kernel-strong network and resource isolation per coworker, at higher memory/orchestration cost than `bwrap` + separate UID inside the single engine container.

## Confidence

`proven` (same-UID `child_process.exec` without chroot/bwrap, `0o444` `/run/factory-token/token`, `0o600` `rerun`-owned `/data/connections/*/.env` and `/data/engine.key`, and unrestricted Docker bridge + `host.docker.internal` are proven directly in code and compose files; `/run/secrets/rerun_engine_key` mode inside Docker Swarm/Compose tmpfs is `unproven — requires inspecting stat /run/secrets/rerun_engine_key inside a running container`).
