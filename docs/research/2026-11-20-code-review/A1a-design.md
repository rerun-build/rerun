# `A1a` Design Note: Coworker Shell & CLI Process Isolation

## 1. Threat Model & Confirmed Gaps

Today inside `moldwright-engine` (`apps/engine/Dockerfile:17,25-36`, `docker-compose.yml:32-53`), the Node.js engine server and every child process spawned on behalf of a coworker run under the exact same OS identity (`rerun`, UID `1000`), in the same mount namespace, PID namespace, and Docker bridge network:

1. **`shell_exec` (`apps/engine/src/tools/builtin/shell.ts:15,50`):** Calls `child_process.exec(command, { cwd, env })` directly.
2. **Claude Code SDK (`apps/engine/src/agents/providers.ts:282-292`) & Codex CLI (`providers.ts:327-341`):** Spawn long-lived CLI subprocesses as `rerun` with `permissionMode: 'bypassPermissions'` / `sandboxMode: 'danger-full-access'`.
3. **Stdio MCP servers (`apps/engine/src/tools/mcp.ts:44`):** Spawn external `npx`/`uvx`/binary commands as `rerun`.

Because all four surfaces execute as UID `1000` (`rerun`), `0o600`/`0o700` file permissions on `/data` protect nothing against a shell-enabled coworker. Any prompt-injected or compromised coworker command can read or mutate:
- **Workspace-wide provider credentials:** `/data/connections/<id>/.env` (Anthropic OAuth refresh tokens, OpenAI/OpenRouter keys) and `/data/connections/<id>/.codex/auth.json`.
- **Sibling coworker state:** `/data/agents/<other-id>/workspace/**`, `/data/agents/<other-id>/.env`, `/data/agents/<other-id>/mcp/*.json` (OAuth tokens), and `/data/agents/<other-id>/data/{system.db,agent.db}`.
- **Engine & Factory credentials:** `/data/engine.key` (self-paired engines), `/data/shared.env`, `/run/factory-token/token` (currently written `0o444` by `tools/factory/apptoken.py:75`), and `/proc/1/*` (engine memory, open file descriptors, and sockets).
- **Internal Docker & host services:** `http://127.0.0.1:3000` (engine HTTP API), `http://app:3000` (Next.js internal hub), `http://webgate:8080`, `http://searxng:8080`, and `host.docker.internal` (`docker-compose.yml:50`).

Output-string redaction (`redactSecrets` in `shell.ts:51`) is not a security boundary: base64/hex encoding or outbound HTTP/DNS exfiltration bypasses string matching completely.

---

## 2. Target Security Invariants

1. **Filesystem Confidentiality & Integrity:** A coworker subprocess (`shell_exec`, Claude CLI, Codex CLI, or stdio MCP) sees **only**:
   - Read-only OS runtime (`/usr`, `/bin`, `/lib`, `/lib64`, `/etc/ssl`, `/etc/resolv.conf`, `/etc/alternatives`, `/opt` toolchains);
   - Its own read-write workspace (`workspaceDir(agentId)`);
   - Optionally `/data/shared` (read-write **only** when `agent.config.tools.shared === true`);
   - Optionally its scoped factory git worktree `/data/work/wt/<repo>-<job>` (**only** when `lineage.jobRef` is bound, matching PR #1702);
   - An isolated per-invocation or per-coworker `/tmp` (`tmpfs`) and `/proc` (mounted inside an unshared PID namespace so engine PID 1 is invisible).
   - Zero visibility into `/data/connections`, `/data/agents/<other>`, `/data/agents/<self>/.env`, `/data/agents/<self>/mcp`, `/data/agents/<self>/data/system.db`, `/data/engine.key`, `/data/shared.env`, or `/run/factory-token`.
2. **UID Separation:** The engine HTTP/orchestrator process runs as `rerun` (`UID 1000`, `GID 1000`). Coworker subprocesses run as unprivileged `coworker` (`UID 10002`, `GID 10002`) — or per-slot UIDs `10002..10999` — so kernel DAC blocks access to `0o600` `rerun:rerun` files even if a mount flag is misconfigured.
3. **Network Egress Containment:** Coworker subprocesses cannot connect to `127.0.0.1:3000` (engine), RFC1918/Docker internal bridge peers (`app`, `webgate`, `searxng`, `supabase-db`), link-local metadata (`169.254.169.254`), or `host.docker.internal`, except through an explicit engine-mediated capability proxy when Hub/MCP access is required.

---

## 3. Architecture Options Evaluated

| Option | Mechanism | Pros | Cons / Operational Cost |
|---|---|---|---|
| **Option A (Recommended Phase 1): `bubblewrap` (`bwrap`) + Dedicated `coworker` UID + Docker Network/Firewall Split** | Install `bubblewrap` in `apps/engine/Dockerfile`; run engine as `rerun` (`1000`) and wrap `shell_exec`, Claude/Codex CLI, and stdio MCP in `bwrap --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --proc /proc --dev /dev --tmpfs /tmp` under `coworker` (`10002`), plus `iptables`/`nftables` owner-match (`-m owner --uid-owner 10002`) blocking RFC1918/loopback/link-local egress. | ~2–4 ms spawn overhead; zero Docker-in-Docker socket exposure; works identically on VPS Compose and self-hosted single-container installs; preserves npm/pip/git workflows inside `workspaceDir`. | Requires `CAP_SYS_ADMIN` or unprivileged user namespaces (`kernel.unprivileged_userns_clone=1` / Docker `security_opt: seccomp=unconfined` or custom seccomp profile allowing `clone(CLONE_NEWUSER\|CLONE_NEWNS\|CLONE_NEWPID)`) on the Docker host, or setuid `bwrap` with a separate `coworker` UID. |
| **Option B: Setuid Helper + `chroot` / `pivot_root` + `setpriv --reuid=10002`** | Small root-owned C/Rust launcher (`0o4750 root:rerun`) creates mount + PID namespaces (`unshare(CLONE_NEWNS\|CLONE_NEWPID)`), bind-mounts allowed paths, `pivot_root`s, drops all capabilities (`PR_SET_NO_NEW_PRIVS`), and `setresuid(10002)`. | Works even when Docker blocks unprivileged `CLONE_NEWUSER` under default seccomp (`CAP_SYS_ADMIN` granted only to container or setuid binary inside container). | Requires `CAP_SYS_ADMIN` on the `engine` container (`cap_add: [SYS_ADMIN]` with `cap_drop: [ALL]` + minimal cap set) so `mount`/`pivot_root` succeed inside Docker. |
| **Option C (Phase 2 Cloud Hardening): Ephemeral Per-Coworker Sibling Container / gVisor (`runsc`)** | Engine dispatches coworker runs over a restricted broker API (never raw `/var/run/docker.sock`) to ephemeral `runsc`/Incus sandboxes mounting only that coworker's workspace volume. | Kernel-isolated CPU/RAM/PIDs/network per coworker; eliminates shared-container kernel attack surface. | 150–500 ms cold start, higher RAM footprint for 20+ idle coworkers, and breaks single-container self-hosted UX (`docker run moldwright-engine`). |

**Decision:** Ship **Option A (`bwrap` + UID `10002` + UID-scoped egress filter)** as the universal baseline in `apps/engine`, with an explicit startup self-check (`bwrap --ro-bind /usr /usr /bin/true`) in `docker-entrypoint.sh` so misconfigured container capabilities fail closed at boot rather than silently falling back to unsandboxed `exec`.

---

## 4. Concrete Implementation Plan

### Step 1: UID Split & On-Disk Ownership (`DATA_DIR_MIGRATIONS` v6)
1. **`apps/engine/Dockerfile`:**
   - Add `bubblewrap`, `util-linux` (`setpriv`), and `iptables` (or `nftables`) to `apt-get install`.
   - Create `useradd --uid 10002 --create-home --shell /bin/bash coworker`.
   - Keep engine daemon user as `rerun` (`UID 1000`). Put `rerun` in group `coworker` (`usermod -aG coworker rerun`) so the engine daemon can read/write coworker workspaces while `coworker` cannot traverse `0o700 rerun:rerun` directories.
2. **Directory Permissions (`apps/engine/src/datadir/migrations.ts` step `v6: workspace-uid-split`):**
   - `/data/connections`, `/data/shared.env`, `/data/engine.key`, `/data/rerun.db`: `0o700` / `0o600` owned `rerun:rerun`.
   - `/data/agents/<id>`: `0o711` (`rerun:rerun`, traversable only to reach `workspace`, directory listing denied).
   - `/data/agents/<id>/{.env,config.json,SOUL.md,mcp,data,triggers,schedules}`: `0o600` / `0o700` owned `rerun:rerun`.
   - `/data/agents/<id>/workspace`: `0o2770` owned `rerun:coworker` (`setgid` so files created by either engine `fs_write` or `coworker` shell stay group-writable by both).
   - `/data/shared`: `0o2770` owned `rerun:coworker`.
3. **Factory Token Tightening (`tools/factory/apptoken.py` & `docker-compose.yml`):**
   - Change `os.chmod(tmp, 0o444)` in `tools/factory/apptoken.py:75` to `0o440` with `gid=1000` (`rerun` group), and mount `factory-token` with `uid=10001,gid=1000,mode=0750`. `coworker` (`10002`) loses read access at the kernel VFS layer; when a factory builder needs `gh` git credentials, the engine injects only the short-lived token value into `GIT_HELPER` for that specific factory job rather than exposing `/run/factory-token/token` to all coworkers.

### Step 2: `sandboxExec` Wrapper (`apps/engine/src/tools/sandbox-exec.ts`)
Introduce a single `buildBwrapArgv(opts)` helper shared by `shell.ts`, `mcp.ts` (stdio servers), and CLI provider spawners (`providers.ts`):

```text
bwrap
  --unshare-pid
  --unshare-ipc
  --unshare-uts
  --die-with-parent
  --new-session
  --ro-bind /usr /usr
  --ro-bind /bin /bin
  --ro-bind /lib /lib
  [--ro-bind-try /lib64 /lib64]
  --ro-bind /etc/alternatives /etc/alternatives
  --ro-bind /etc/ssl /etc/ssl
  --ro-bind-try /etc/ca-certificates /etc/ca-certificates
  --ro-bind-try /etc/resolv.conf /etc/resolv.conf
  --proc /proc
  --dev /dev
  --tmpfs /tmp
  --tmpfs /run
  --tmpfs /home/coworker
  --bind <workspaceDir(agentId)> <workspaceDir(agentId)>
  [if cfg.shared: --bind /data/shared /data/shared]
  [for root of fsExtraRoots(cfg, lineage): --bind <root> <root>]
  --chdir <workspaceDir(agentId)>
  --clearenv
  [--setenv KEY VAL ... from childProcessEnv]
  -- /bin/bash -c <command>
```

Key properties:
- `/data` is **never** bound as a parent directory; `bwrap` synthesizes an empty tmpfs parent for `/data/agents/<id>/workspace`, so `/data/connections`, `/data/engine.key`, and `/data/agents/<other>` **do not exist** in the child's mount table (`ENOENT`).
- `--unshare-pid` + `--proc /proc` mounts a fresh procfs showing only the command's own PID tree (PID 1 inside `bwrap`), hiding the Node.js engine's `/proc/<pid>/environ`, `/proc/<pid>/maps`, and `/proc/<pid>/fd/*`.
- `--die-with-parent` + `--new-session` guarantees orphan background daemons spawned by a timed-out `shell_exec` are reaped by the kernel when the `bwrap` leader exits.

### Step 3: Claude Code & Codex CLI Compatibility
- **Claude Code (`providers.ts`):** Currently sets `HOME` and `CLAUDE_CONFIG_DIR` via `agentProcessEnv`. Under `bwrap`, bind a per-run staging directory `/data/agents/<id>/cli-home` (`0o2770 rerun:coworker`, containing only bridged MCP socket/HTTP config and stripped of `/data/connections/*/.env` per PR #1703) to `/home/coworker`. Pass `CLAUDE_CODE_OAUTH_TOKEN` via pipe/FD or ephemeral env only for that Claude process, never writing refresh tokens (`CLAUDE_CODE_OAUTH_REFRESH_TOKEN`) into `cli-home`.
- **Codex CLI (`providers.ts`):** Instead of pointing `CODEX_HOME` directly at `/data/connections/<connId>/.codex` (where `auth.json` holds refresh tokens and is shared across coworkers), copy only a short-lived access-token projection into `/data/agents/<id>/cli-home/.codex/auth.json` before launch and bind only that directory into `bwrap`.

### Step 4: Network Egress & Compose Hardening (`docker-compose.yml` & `deploy/vps/docker-compose.vps.yml`)
1. **Drop `host.docker.internal` in production (`deploy/vps/docker-compose.vps.yml`):**
   Add `extra_hosts: !reset []` under `services.engine` (and `services.app`) in `deploy/vps/docker-compose.vps.yml` so production containers never get a host-gateway route; keep `host.docker.internal` solely in local dev overrides (`supabase-bridge` profile).
2. **UID-Matched Egress Filter in `docker-entrypoint.sh`:**
   Before dropping from `root` (or `CAP_NET_ADMIN` init step) to `rerun`, install `iptables` / `ip6tables` `OUTPUT` rules matching `-m owner --uid-owner 10002`:
   - `ACCEPT` established/related replies and DNS (`UDP/TCP 53` to Docker's embedded resolver `127.0.0.11`).
   - `REJECT` loopback (`127.0.0.0/8`, `::1/128`), RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`), and ULA (`fc00::/7`).
   - Because the engine Node.js process runs as UID `1000` (`rerun`), the engine itself continues talking to `http://app:3000` (`RERUN_HUB_BASE_URL`) and bridged local MCP relays unimpeded, while UID `10002` (`coworker`) can reach only public internet hosts.
3. **Resource Limits:** Add `pids_limit: 512` on `services.engine` in `docker-compose.yml` and `ulimit -u 128` inside the `coworker` wrapper so fork bombs cannot starve the engine event loop.

---

## 5. Rollout & Verification Sequence (Stacked PRs)

1. **PR 1 — `feat(engine): add coworker UID and DATA_DIR_MIGRATIONS v6 permissions`:**
   - Add `coworker` (`10002`) user + `bubblewrap` to `apps/engine/Dockerfile`; tighten `apptoken.py` mode `0o444` -> `0o440`; add `DATA_DIR_MIGRATIONS` v6 setting `0o2770 rerun:coworker` on `workspace` and `/data/shared` while locking `0o700`/`0o600` on `connections`, `engine.key`, and `system.db`.
   - Test: `datadir/ladder.test.ts` starting from v5 snapshot.
2. **PR 2 — `feat(engine): isolate shell_exec and stdio MCP inside bwrap mount/PID namespace`:**
   - Implement `sandbox-exec.ts` + startup selftest in `docker-entrypoint.sh`; wire `shell.ts` and `mcp.ts` stdio transport.
   - Integration test (`shell.isolation.test.ts` in Linux CI): prove `cat /data/connections/c1/.env`, `ls /data/agents/other`, `cat /run/factory-token/token`, and `cat /proc/1/cmdline` all fail inside `shell_exec`, while `npm test`, `git status`, and `fsExtraRoots` job worktrees succeed.
3. **PR 3 — `feat(engine,deploy): wrap CLI providers in bwrap and enforce coworker UID network egress rules`:**
   - Isolate Claude/Codex `cli-home` staging; reset `extra_hosts` in `deploy/vps/docker-compose.vps.yml`; add `UID 10002` `iptables`/`ip6tables` private-egress block in `docker-entrypoint.sh` (`CAP_NET_ADMIN` dropped via `setpriv --inh-caps=-all` before `exec node`).
   - Integration test: prove `curl http://127.0.0.1:3000/agents` and `curl http://169.254.169.254` fail with `ECONNREFUSED`/`EPERM` from `shell_exec` while engine-to-hub requests from UID `1000` succeed.
