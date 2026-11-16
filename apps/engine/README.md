# rerun-engine

A light, self-hostable engine for autonomous AI agents (coworkers). One process runs every coworker
of one workspace, each with its own personality, memory, skills, tools and variables, and exposes
all of it over HTTP. Built on the Vercel AI SDK.

It is file-first: you can open and read everything a coworker knows. SQLite (libSQL) files hold
only what needs a query or retrieval: transcripts, the memory index, run telemetry and the
coworkers' own tables.

For the whole picture see [docs/GUIDE.md](./docs/GUIDE.md); for the HTTP contract,
[docs/API.md](./docs/API.md).

## Quick start

```bash
pnpm install
pnpm build
node dist/cli/bin.js run
# or, in dev:
pnpm dev
```

The server listens on `RERUN_PORT` (default 3000). Health check:

```bash
curl localhost:3000/health
```

## What the data-dir holds

Everything lives under `RERUN_DATA_DIR` (default `~/.rerun`, `/data` in the Docker image):

```
rerun.db                    agent index (id, name, status), nothing else
data-version.json           the last step of the data-dir ladder this folder went through
last-update.json            what the last `rerun update` did, read back by /health
plan.json                   the workspace plan the app last pushed
engine.key, hub.json        a paired server's own API key and the app it paired with
update.log                  output of the self-updater
config.env                  environment file of the systemd unit (release layout)
agents/<id>/                one folder per coworker (below); agents/foreman/ is the Chief of Staff
connections/<id>/           an AI provider credential: connection.json, .env (0600), .codex/
connections/default.json    the connection and model a coworker with no pin of its own runs on
vault/<id>/                 the Vault: item.json, .env (0600), tokens/<server>.json
shared/                     files every coworker reads and writes (shared_* tools, /shared/files)
shared-db/shared.db         SQL database every coworker shares (shared_db_* tools, /shared/data)
brain/<slug>.md             pages of the company brain, the source of truth
brain-db/brain.db           brain index: chunks and embeddings, links, proposals, revisions
mcp-packages/               MCP servers declared as `npx <package>`, installed once
```

One coworker:

```
agents/<id>/
  SOUL.md                   personality / system prompt
  INSTALL.md                guided setup the coworker runs once on a new owner's account (optional)
  config.json               model, connection, tool families, MCP servers, self-improvement, setup state
  .env                      the coworker's own variables (0600, never returned by the API)
  workspace/                private root of the fs_* tools and working directory of the shell
                            (which is not confined to it); .rerun/services.json lists its apps
  skills/<slug>/SKILL.md    reusable procedures, with bundled files beside them
  memory/<id>.md            durable memories (markdown + frontmatter)
  schedules/<slug>.md       scheduled tasks (cron or one-shot)
  triggers/<slug>.md        webhook triggers
  mcp/<server>.json         OAuth tokens of its own MCP servers
  browser-profile/          its Chromium profile (never archived)
  data/system.db            sessions, messages (+ FTS), the memory index (vector + FTS), runs,
                            run steps, tool calls, compaction checkpoints, skill proposals,
                            the paid data calls behind table rows
  data/agent.db             its own SQL database (db_* tools, /agents/:id/data)
```

A script reaches the two SQL databases through `RERUN_AGENT_DB` and `RERUN_SHARED_DB`, and the
workspace through `RERUN_WORKSPACE`.

## Data-dir migrations

A data-dir can come back from an archive taken weeks earlier and boot on today's engine, so it carries
its own version and every change to its layout is a numbered step in a ladder:

- `src/datadir/migrations.ts`: the data-dir ladder (files, folders, `rerun.db`). The version reached
  is written to `RERUN_DATA_DIR/data-version.json` after each step; a folder without it is v0.
- `SYSTEM_DB_MIGRATIONS` (`src/db/systemDb.ts`), `SHARED_DB_MIGRATIONS` (`src/db/sharedDb.ts`) and
  `BRAIN_DB_MIGRATIONS` (`src/db/brainDb.ts`): one ladder per SQLite file, versioned with
  `PRAGMA user_version`, applied when the file is opened. `agent.db` is the coworker's own and has
  no ladder.
- Every-boot reconcilers (`ensureAgentsIndex`, `reconcileConnections`, `ensureForeman`,
  `reconcileVault`) are not steps: they bring the folder in line with today's code, whatever its history.

Rules:

1. Any change to what lives on disk is a new step at the end of its ladder.
2. A shipped step is never edited nor removed. The registry snapshots in `src/datadir/ladder.test.ts`
   and `src/db/ladder.test.ts`, and the per-version `system.db` schema snapshot, fail when one is.
3. A step must be re-runnable (a crash between the step and the version write replays it) and must
   not break the engine still running beside it: `rerun update` migrates before the restart. Add
   first, remove in a later step.
4. A step ships with a test that starts from the previous version.

An engine older than the data-dir it finds leaves it untouched and boots; `/health` reports
`dataVersion` against `dataVersionTarget` and `GET /doctor` says what is wrong, read-only.

## CLI

```
rerun run                       Start the API server (prepares the data-dir first)
rerun migrate                   Run the data-dir migration ladder
rerun restore-finalize          Migrate a restored data-dir and skip the schedules it slept through
rerun agent create --name X     Create an agent (--provider, --model, --key KEY=VALUE)
rerun agent list                List agents
rerun agent delete <id>         Delete an agent
rerun skill list <agentId>      List an agent's skills
rerun schedule list <agentId>   List an agent's scheduled tasks
rerun mcp login <id> <server>   Sign in to an OAuth MCP server of an agent
rerun mcp status <agentId>      Check an agent's MCP server connections
rerun mcp logout <id> <server>  Clear a stored MCP token
rerun doctor                    Check the data-dir without changing it (exits 1 on a failure)
rerun update [--no-restart]     Pull, rebuild, migrate and restart the service (git checkout)
rerun update --artifact <url> --sha256 <hex> --commit <sha>
                                Install a prebuilt release, migrate and restart the service
rerun rollback                  Go back to the previous release and restart the service
rerun install-layout            Write the launcher and the systemd units for the release layout
rerun install-browser           Install Chromium for the browser tool
rerun install-desktop           Install the window manager and VNC server behind the screen
rerun update-cli-tools          Install the Codex CLI this release pins
rerun start | stop | restart    Control the systemd service
rerun status                    Show the service status
rerun logs [--no-follow]        Tail the service logs
```

`rerun run` also installs a missing Chromium, desktop packages or Codex CLI in the background.

## HTTP API

All routes except `/health` require `Authorization: Bearer $RERUN_API_KEY` when `RERUN_API_KEY` is
set. The full contract, with bodies and errors, is in [docs/API.md](./docs/API.md).

```
GET    /health                               liveness, capabilities, data-dir version
GET    /doctor                               read-only data-dir checks
POST   /update                               self-update (git or prebuilt artifact)
GET    /tools                                tool families and their tools

GET|POST /connections   PUT|DELETE /connections/default   POST /connections/probe
PATCH|DELETE /connections/:id   PATCH /connections/:id/keys   GET /connections/:id/usage

GET|POST /vault   GET|PATCH|DELETE /vault/:id   PATCH /vault/:id/env   GET /vault/:id/usage
PUT|DELETE /vault/:id/agents/:agentId   PUT|DELETE /vault/:id/tokens/:server

GET|POST /agents   POST /agents/import   GET|PATCH|DELETE /agents/:id   GET /agents/:id/tools
GET|PATCH /agents/:id/keys   PATCH /agents/:id/mcp-servers   GET /agents/:id/mcp-servers/status
PUT|DELETE /agents/:id/mcp/:name/token   POST /agents/:id/duplicate   POST /agents/:id/automations/activate
GET /agents/:id/archive   GET /agents/:id/archive/plan

POST   /agents/:id/chat                      stream a run (AI SDK UI message stream)
GET    /agents/:id/sessions   /sessions/:sid   /sessions/:sid/messages
GET    /agents/:id/runs   /runs/:rid   /runs/:rid/stream   /runs/:rid/steps   /runs/:rid/tools
POST   /agents/:id/runs/:rid/cancel   /runs/:rid/tasks/:taskId/cancel
GET    /agents/:id/usage   /agents/:id/stats

GET|POST|DELETE /agents/:id/memories   POST /memories/recall   DELETE /memories/:memoryId
GET|POST /agents/:id/skills   POST /skills/import   GET|PATCH|DELETE /skills/:slug   GET /skills/:slug/archive
GET /agents/:id/skill-proposals?session=   POST /skill-proposals/:pid/accept   /:pid/dismiss
GET|POST /agents/:id/schedules   GET|PATCH|DELETE /schedules/:slug   POST /schedules/:slug/run
GET|POST /agents/:id/triggers   GET|PATCH|DELETE /triggers/:slug   POST /triggers/:slug/rotate   /:slug/fire

files   /agents/:id/files   /shared/files   /agents/:id/skills/:slug/files
        GET / /read /raw   PUT / /raw   POST /raw /move /dir   DELETE /
data    /agents/:id/data   /shared/data
        GET /tables   POST /query /execute /sources   GET|DELETE /tables/:name   ...

GET    /brain/pages   GET|PUT|DELETE /brain/pages/:slug   ...   GET /brain/proposals   POST /brain/seed
GET    /desktop   POST /agents/:id/desktop/session /apps /takeover   DELETE /agents/:id/desktop/takeover
GET    /desktop/ws?ticket=…                  VNC WebSocket (ticket, no bearer)
```

Create a connection, then an agent that runs on it:

```bash
curl -X POST localhost:3000/connections -H 'content-type: application/json' -d '{
  "name": "Anthropic", "provider": "anthropic", "models": ["claude-sonnet-4-6"],
  "keys": { "ANTHROPIC_API_KEY": "sk-ant-..." }
}'
curl -X POST localhost:3000/agents -H 'content-type: application/json' -d '{
  "config": { "name": "Scout", "connectionId": "<connection id>", "provider": "anthropic", "model": "claude-sonnet-4-6" },
  "soul": "You are Scout, a curious researcher."
}'
```

## Tools and self-improvement

Each coworker gets a tool set gated by the `tools` flags of its `config.json`, one flag per family:
files of its own workspace and of the shared space, shell, web, memory, its own and the shared SQL
database, the company brain, skills, schedules, triggers, `delegate_tasks` (ephemeral sub-coworkers,
up to four in parallel), calling another coworker, reading the team, the browser and its own
screen, vision, notifications, the Rerun hub catalog, paid data, cards and the human-in-the-loop
questions. The full table is in [docs/GUIDE.md](./docs/GUIDE.md#8-tools); `GET /tools` lists them
live.

With `selfImprovement.enabled`, a coworker can also rewrite its soul, set its answer length,
install packages and register MCP servers, and after each run a curator can keep a durable memory
(`autoMemory`). Skills are written by the coworker with its skill tools, or offered with
`skill_propose` for the user to accept or dismiss.

The shell runs in the coworker's workspace behind a command-policy denylist. Run the engine in its
own container (see the Dockerfile) so arbitrary shell stays contained.

## Memory recall

`memory_recall` embeds the query (OpenAI `text-embedding-3-small`, 1536 dims) and runs libSQL
`vector_top_k` KNN merged with FTS5 keyword search. The engine holds no embedding key: it POSTs
the text to the app's `/api/embed` endpoint (reached at `RERUN_HUB_BASE_URL`, authenticated with
`RERUN_API_KEY`), which owns the provider key. Without a reachable app, recall falls back to FTS
only.

## Deployment

The engine runs in Docker, one container per workspace, next to the app or on a machine of its own.
Build it from the repository root:

```bash
docker build -f apps/engine/Dockerfile -t rerun-engine .
docker run -d -p 127.0.0.1:3000:3000 -v rerun-engine:/data --shm-size 2g \
  -e RERUN_API_KEY=<key> -e RERUN_HUB_BASE_URL=<app url> rerun-engine
```

The image carries Chromium, the desktop packages and the Codex CLI. Its data-dir is `/data`: the
databases and every file of every coworker. Updates are a new image; the data-dir migrates itself
on start.

The app attaches it to a workspace: the first one gets the engine of `docker-compose.yml`, any
other is paired from Servers, in the workspace menu (see https://docs.rerun.build/self-host/servers).

### Securing a public deployment

- **API key.** Always set `RERUN_API_KEY` (a paired server generates its own): without it the API is open.
- **TLS.** Don't expose port 3000 in clear. Put a reverse proxy in front for HTTPS (with Caddy, a
  single `reverse_proxy localhost:3000` block with automatic certificates) and keep the port
  reachable from the machine only. Inside Docker, leave `RERUN_HOST` at `0.0.0.0` (a container bound
  to `127.0.0.1` answers nobody) and publish the port on the loopback instead:
  `-p 127.0.0.1:3000:3000`. Outside Docker, set `RERUN_HOST=127.0.0.1`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `RERUN_DATA_DIR` | `~/.rerun` (`/data` in the image) | Root of the data-dir |
| `RERUN_PORT` | `3000` | HTTP port |
| `RERUN_HOST` | `0.0.0.0` | Bind address |
| `RERUN_API_KEY` | _unset_ | Bearer token for the API (open if unset); also authenticates the engine to the app (embeddings, notifications, hub tools) |
| `RERUN_HUB_BASE_URL` | _unset_ | Base URL of the app, for embeddings, notifications and the hub tools |
| `RERUN_LOG_LEVEL` | `info` | pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |
| `RERUN_CODEX_PATH` | _unset_ (`/usr/local/bin/codex` in the image) | Absolute path to the Codex CLI, when it is not on the service user's `PATH` |
| `RERUN_DESKTOP` | _unset_ | `off` keeps the screen and the computer tools shut on this engine |
| `RERUN_PAIR_TOKEN` | _unset_ | One-time token from the Servers page: the engine pairs itself with the app at `RERUN_HUB_URL` |
| `RERUN_HUB_URL` | _unset_ | Address of the app to pair with, together with `RERUN_PAIR_TOKEN` |
| `RERUN_PUBLIC_URL` | _unset_ | Address the app should reach this engine at, sent when pairing |
| `RERUN_SERVICE` | `rerun` | Name of the systemd service the CLI controls |
| `RERUN_SERVICE_USER` | current user | User the systemd unit of `rerun install-layout` runs as |
