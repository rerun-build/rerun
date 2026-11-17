# rerun-engine: complete guide

This document explains the whole project: what it is, how it is built, how data is stored, how to run it, and how every part (agents, the run loop, tools, skills, memory, self-improvement) works together. For the exact HTTP contract see [API.md](./API.md).

---

## 1. What it is

`rerun-engine` is a small, self-hostable server that runs **autonomous AI agents** (coworkers). One engine serves one workspace: a single process manages **every coworker of that workspace** and exposes everything over HTTP. There is no UI here on purpose: the Rerun app (`apps/ui`, "the hub" in the code) is the front end.

Each coworker is self-contained: its own personality, memory, skills, enabled tools and variables. The AI provider credentials are held once by the engine as **connections**, and each coworker points at one. You start the server once (`rerun run`), then create coworkers and talk to them over the API.

It is built on the **Vercel AI SDK** (`ai` + `@ai-sdk/*`), and drives the Claude Code and Codex CLIs for the subscription providers.

### Design principles

- **File-first.** Everything a coworker "is" lives in real files on disk you can open and read: personality, config, variables, skills, memories, schedules, workspace. The databases hold only what needs queries or retrieval.
- **One server, many coworkers.** Coworkers are addressed by URL (`/agents/:id/...`), not by separate ports or processes.
- **Self-improving.** Coworkers write their own memories, propose their own skills, install tools and register MCP servers, so they get better over time.
- **Contained.** The file tools are jailed to a root; the shell runs in the coworker's workspace but is not confined to it. Run the whole engine in a container so anything a coworker does stays inside it.

---

## 2. Architecture at a glance

```
HTTP (Hono)
  └── /agents/:id/{chat,sessions,runs,memories,skills,schedules,triggers,files,data,...}
      /connections  /vault  /shared/{files,data}  /brain  /desktop
        │
        ▼
  Agent registry  ──reads──►  agents/<id>/   (files = source of truth)
        │                        SOUL.md, config.json, .env,
        ▼                        workspace/, skills/, memory/, schedules/, triggers/
  Run loop (AI SDK streamText, or a CLI)   ◄── HTTP chat, scheduler (cron), trigger, another coworker
        │  multi-step tool calling, no step cap
        ├── tools: the families of section 8, plus MCP servers (its own and the Vault's)
        ├── persists transcript + telemetry ──►  agents/<id>/data/system.db
        ├── memory recall/write  ──►  memory/*.md + system.db (vector + FTS index)
        └── curator (after run)  ──►  a durable memory
        │
        ▼
  Notifications ──► POST <app>/api/webhooks/engine

  Scheduler (every 30 s)  ──reads──►  agents/<id>/schedules/<slug>.md
        └── due task ──► fresh session ──► same run loop
```

---

## 3. Storage layout

Everything lives under `RERUN_DATA_DIR` (default `~/.rerun`, `/data` in the Docker image):

```
<data-dir>/
  rerun.db                      agent index only (id, name, status)
  data-version.json             data-dir migration ladder version
  last-update.json              what the last `rerun update` did
  plan.json                     the workspace plan the app last pushed
  engine.key, hub.json          a paired server's key and the app it paired with
  connections/
    <id>/connection.json        provider, name, models, base URL
    <id>/.env                   the credential (chmod 600, never returned)
    <id>/.codex/                Codex state, shared by the coworkers on that connection
    default.json                the engine default connection and model
  vault/<id>/                   Vault items: item.json, .env, tokens/<server>.json
  shared/                       files every coworker can read and write (shared_* tools)
  shared-db/shared.db           SQL database every coworker shares (shared_db_* tools)
  brain/<slug>.md               company brain pages
  brain-db/brain.db             brain index, proposals and revisions
  mcp-packages/                 MCP servers declared as `npx <package>`, installed once
  agents/
    foreman/                    the Chief of Staff, rewritten from code at every boot
    <agentId>/
      SOUL.md                   personality / system prompt
      INSTALL.md                guided setup replayed once on a new owner's account (optional)
      config.json               AgentConfig (model, tools, MCP, self-improvement, setup)
      .env                      the coworker's own variables (chmod 600, never returned)
      workspace/                private root of the fs_* tools and working directory of the shell
      skills/<slug>/SKILL.md    a reusable procedure (frontmatter + markdown) and its files
      schedules/<slug>.md       a scheduled task (cron/one-shot frontmatter + prompt)
      triggers/<slug>.md        a webhook trigger (frontmatter + prompt, holds its token)
      memory/<memId>.md         a durable memory (frontmatter + markdown)
      mcp/<server>.json         OAuth tokens of its own MCP servers
      browser-profile/          its Chromium profile
      data/system.db            the engine's records about this coworker (below)
      data/agent.db             its own SQL database (db_* tools)
```

Two filesystems coexist: each coworker's private `workspace/` (the `filesystem` / `fs_*` tools), and the global `shared/` space (the `shared` / `shared_*` tools) that every coworker can read and write to hand files to each other.

Two SQL databases a coworker writes coexist the same way: its private `data/agent.db` (the `db` / `db_*` tools), and the engine-wide `shared-db/shared.db` (the `sharedDb` / `shared_db_*` tools). The shared file sits outside `shared/` on purpose, so no file tool can truncate it. A script reaches them through `RERUN_AGENT_DB` and `RERUN_SHARED_DB`.

### Which database holds what

| File | Holds |
| --- | --- |
| `rerun.db` | the `agents` index (id, name, status), for fast listing |
| `agents/<id>/data/system.db` | `sessions`, `messages` (+ `messages_fts`), `memories` (embedding + FTS, each row points to its `.md`), `runs`, `run_steps`, `tool_calls`, `compaction_checkpoints`, `skill_proposals`, and the paid data calls behind table rows |
| `agents/<id>/data/agent.db` | the coworker's own tables, plus the saved table views |
| `shared-db/shared.db` | the tables every coworker shares, who created each, and the saved views |
| `brain-db/brain.db` | `brain_pages`, `brain_chunks` (embeddings), `brain_links`, `brain_proposals`, `brain_revisions`; pages, chunks and links are rebuilt from `brain/*.md` |

Skills, schedules, triggers and the canonical memory text are **not** in a database: they are the `.md` files. The `memories` table is an index that makes those files searchable.

`system.db`, `shared.db` and `brain.db` each carry their own migration ladder; the data-dir carries one more (see the README).

---

## 4. Install and run

```bash
pnpm install
pnpm build                 # compiles to dist/
node dist/cli/bin.js run   # starts the server (prepares the data-dir first)
# during development:
pnpm dev                   # tsx watch, same as `rerun run`
```

Check it:

```bash
curl localhost:3000/health
```

```json
{
  "status": "ok",
  "activeAgents": 0,
  "activeRuns": 0,
  "claimedSessions": 0,
  "desktopViewers": 0,
  "capabilities": ["files.stream", "foreman.files", "schedules.rename", "update.artifact", "connections.opencode", "connections.custom", "vault", "desktop"],
  "commit": "e70322d",
  "startedAt": "2026-11-16T09:12:03.512Z",
  "layout": "monorepo",
  "lastUpdate": null,
  "dataVersion": 6,
  "dataVersionTarget": 6
}
```

### The CLI (`rerun`)

After `pnpm build`, the `rerun` bin is `dist/cli/bin.js`:

```
rerun run                       Start the API server
rerun migrate                   Run the data-dir migration ladder
rerun restore-finalize          Migrate a restored data-dir, skip the schedules it slept through
rerun agent create --name X     Create an agent  (--provider, --model, --key KEY=VALUE)
rerun agent list                List agents
rerun agent delete <id>         Delete an agent and its files
rerun skill list <agentId>      List an agent's skills
rerun schedule list <agentId>   List an agent's scheduled tasks
rerun mcp login <id> <server>   Sign in to an OAuth MCP server
rerun mcp status <agentId>      Check MCP server connections
rerun mcp logout <id> <server>  Clear a stored MCP token
rerun doctor                    Check the data-dir without changing it
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

`rerun doctor` is the fastest way to confirm a machine is healthy. It runs the same read-only checks as `GET /doctor` and exits with code 1 when one fails:

```
data dir: /home/rerun/.rerun ok
api key: set
embed: via UI (https://app.example.com)
ok   data-version: v6
ok   index: 2 agent(s)
ok   agents-on-disk
ok   system-db
ok   connections: 2 connection(s)
ok   vault: 1 item(s)
ok   shared-db: not created yet
vector support: yes
```

A failed check reads `FAIL <name>: <what is wrong>`, for example `FAIL agents-on-disk: folder without an index row: a2`.

---

## 5. Configuration

Instance-level variables are parsed and validated at startup (`src/config/env.ts`): `RERUN_DATA_DIR`, `RERUN_PORT`, `RERUN_HOST`, `RERUN_API_KEY`, `RERUN_HUB_BASE_URL`, `RERUN_LOG_LEVEL`, `RERUN_CODEX_PATH` and `RERUN_DESKTOP`. Pairing (`RERUN_PAIR_TOKEN`, `RERUN_HUB_URL`, `RERUN_PUBLIC_URL`) and the service CLI (`RERUN_SERVICE`, `RERUN_SERVICE_USER`) read a few more. The table with defaults is in the [README](../README.md#configuration).

Provider credentials (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, a Claude or ChatGPT subscription, ...) are **not** environment variables of the engine: they live on connections (`POST /connections`), and each coworker points at one through `config.connectionId`.

---

## 6. Agents

### The agent model (`config.json`)

Trimmed to the fields you set most often (`src/agents/types.ts` re-exports the full schema from `@rerun/contracts`):

```json
{
  "name": "scout",
  "displayName": "Scout",
  "kind": "user",
  "enabled": true,
  "description": "",
  "connectionId": "abc...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "verbosity": "normal",
  "language": null,
  "tools": { "filesystem": true, "shell": true, "web": true, "browser": true, "computer": true, "...": true },
  "mcpServers": [],
  "selfImprovement": { "enabled": true, "allowToolInstall": true, "allowSoulEdit": true, "autoMemory": true },
  "setup": { "required": null, "completedAt": null }
}
```

- `provider` is one of `rerun`, `anthropic`, `claude`, `codex`, `openai`, `google`, `openrouter`, `opencode`, `custom` (`providerSchema` in `packages/contracts/src/agent.ts`). The credential lives on the connection the agent points at (`connectionId`), see Connections in `API.md`. `model: null` follows the engine default.
- `tools` switches whole tool families on or off; every flag defaults to `true`.
- `selfImprovement` controls the curator and whether the agent may install tools, register MCP servers and rewrite its soul.
- `enabled: false` switches a coworker off: it keeps everything and stops running (no chat, no schedule, no call).

### Creating an agent

Via API, once a connection exists:

```bash
curl -X POST localhost:3000/agents -H 'content-type: application/json' -d '{
  "config": { "name": "Scout", "connectionId": "<connection id>", "provider": "anthropic", "model": "claude-sonnet-4-6" },
  "soul": "You are Scout, a concise research assistant.",
  "keys": { "SERP_API_KEY": "..." }
}'
```

Only `config.name` is required. `soul` becomes `SOUL.md`, and an optional `install` becomes `INSTALL.md`, the setup the agent walks a new owner through when `config.setup.required` is true. `keys` are the agent's own variables (MCP servers, shell scripts), written to `.env`. Vector memory recall is enabled automatically when the engine can reach the app's `/api/embed` (set `RERUN_HUB_BASE_URL` + `RERUN_API_KEY`); no per-agent embedding key is needed.

Via CLI:

```bash
rerun agent create --name Scout --provider anthropic --model claude-sonnet-4-6
```

### The Chief of Staff

Every engine carries one built-in agent, the Chief of Staff (`kind: "foreman"`, id `foreman` in the code). It is rewritten from code at every boot (`ensureForeman`, `src/agents/foreman.ts`), keeping only its model, and is never listed in the agent index. It works on the engine with files, shell, web, the shared database, the brain (which it writes rather than proposes to), sub-agents, calls to other coworkers, the browser and file cards, and on the workspace through the tools the app hands it with each chat request (`foreman` in the body of `POST /agents/foreman/chat`). Over HTTP it can be chatted with and read, its runs stopped, files handed to it, and its model pinned; everything else answers `403`.

### The system prompt

On each run the system prompt is assembled (`src/agents/systemPrompt.ts`) from: the agent's `SOUL.md`, a compact **index of its skills**, the **most relevant memories** for the incoming message, and operating notes for the tools it has. Full skill bodies are loaded only when the agent calls `skill_read`, which keeps the context small. An agent whose guided setup is still pending also gets a `setup` section and the `install_complete` tool, both of which disappear the moment it closes its installation.

---

## 7. The run loop

A "run" is one turn: you send a message, the agent thinks and calls tools until it is done, and you get a reply. It uses the AI SDK `streamText` with multi-step tool calling that runs until the model stops calling tools or calls a human-in-the-loop tool such as `ask_user` (`src/runtime/loop.ts`). There is no step cap. The `claude` and `codex` providers run the Claude Code and Codex CLIs instead, with the engine's tools served to them over MCP.

Lifecycle of a run:

1. Load the session history and append the user message.
2. Build the system prompt (soul + skills index + recalled memories).
3. Build the tool set for this agent (enabled families + MCP servers). A heavy set of MCP tools is held back and reached on demand, see [MCP](#mcp).
4. Start a `runs` row (`running`), mark the agent `busy`, claim the session (one run per session at a time).
5. Stream the model, executing tools each step and recording each step and tool call.
6. On finish: persist the assistant + tool messages, mark `idle`, close the `runs` row (`done`), notify the app, and run the **curator**.
7. On error: the row ends `error`. A run stopped through `POST /agents/:id/runs/:rid/cancel` ends `cancelled`; one cut by a restart is closed `error` at the next boot.

`POST /agents/:id/chat` drives the loop over HTTP as a **stream** (SSE, AI SDK UI message stream). The session id and the run id come back in the `x-session-id` and `x-run-id` headers, and a client that lost the stream picks it up again with `GET /agents/:id/runs/:rid/stream`.

If you omit `sessionId`, a new session is created; pass it back to continue the same conversation.

---

## 8. Tools

Tools are built per run and gated by `config.tools` (`src/tools/registry.ts`, the families in `src/tools/catalog.ts`, the tools in `src/tools/builtin/`). Each is a typed AI SDK `tool()` with a Zod input schema. `GET /tools` returns this catalog live.

| Family | Tools | Notes |
| --- | --- | --- |
| `filesystem` | `fs_read`, `fs_write`, `fs_list`, `fs_edit`, `fs_search` | Jailed to the agent's private `workspace/`; `fs_edit` is a surgical string-replace, `fs_search` a regex content grep |
| `shared` | `shared_read`, `shared_write`, `shared_list`, `shared_edit`, `shared_search` | Same operations on the global `shared/` space every agent can read and write: use it to pass files between agents |
| `shell` | `shell_exec` | Runs in `workspace/` (also in `RERUN_WORKSPACE`), behind a command-policy denylist |
| `web` | `web_fetch`, `web_search`, `download` | Fetch/strip a URL (a page the site refuses is read through the Rerun hub instead), search the web (through the Rerun hub), download a file into the workspace. On `claude` and `codex`, the CLI's own search replaces `web_search` |
| `memory` | `memory_write`, `memory_recall`, `memory_delete` | Writes `.md` files + index; hybrid recall |
| `db` | `db_query`, `db_execute`, `db_schema` | The agent's private `data/agent.db` |
| `sharedDb` | `shared_db_query`, `shared_db_execute`, `shared_db_schema` | `shared-db/shared.db`, shared by every agent |
| `brain` | `brain_search`, `brain_read`, `brain_write`, `brain_propose` | The company brain. A coworker writes at once only what a person told it in the conversation (`brain_write` refuses without one) and proposes the rest for review. The Chief of Staff gets `brain_write`, `brain_delete`, `brain_proposals` and `brain_decide` instead of `brain_propose` |
| `skills` | `skill_list`, `skill_read`, `skill_read_file`, `skill_create`, `skill_edit`, `skill_update`, `skill_delete`, `skill_write_file`, `skill_delete_file`, `skill_import`, `skill_propose` | Skill folders (section 9). `skill_propose` needs `selfImprovement.enabled` |
| `self` | `verbosity_set`, `soul_update`, `tool_install`, `mcp_register`, `mcp_login`, `mcp_login_complete`, `mcp_status`, `request_mcp_sign_in` | Gated by `selfImprovement.enabled`; `soul_update` also by `allowSoulEdit`, the install and MCP tools by `allowToolInstall` |
| `schedule` | `schedule_list`, `schedule_get`, `schedule_create`, `schedule_update`, `schedule_edit`, `schedule_delete` | Reads/writes schedule `.md` files; the agent can plan its own recurring tasks |
| `trigger` | `trigger_list`, `trigger_create`, `trigger_get`, `trigger_edit`, `trigger_update`, `trigger_rotate_token`, `trigger_delete` | Webhook triggers; `trigger_get` is the only one that returns the URL |
| `delegate` | `delegate_tasks` | Spawns one fresh ephemeral sub-agent per task (inherits tools, model and variables), up to four at a time, runs each to completion and returns their answers. Sub-agents cannot delegate further, ask the user anything nor show cards; the files they make for the caller land in `shared/` |
| `callAgent` | `call_agent` | Messages another persistent coworker of the engine, in a session of its own |
| `team` | `team_status`, `team_list_schedules`, `team_list_triggers`, `team_list_runs`, `team_get_run` | Reads the other coworkers without changing anything |
| `aiProviders` | `ai_status` | Which provider and model it runs on, the other connections, and the credit or subscription quota left |
| `browser` | `browser_navigate`, `request_takeover` | Chromium driven by patchright, windowed on the agent's own Xvfb display (headless when there is none), with a persistent profile per agent: renders JS, waits out bot-protection challenges, accepts cookie banners, returns visible text, optional full-page screenshot into the workspace. `rerun run` installs Chromium when it is missing. `request_takeover` pauses the run and hands that browser to the user for a sign-in or a captcha; it only exists on an engine with the desktop packages, for an agent that is neither a delegate nor the Chief of Staff |
| `vision` | `vision_analyze` | Analyzes a workspace image with the agent's multimodal model (e.g. a screenshot from `browser_navigate`) |
| `computer` | `computer`, `computer_open_app` | The agent's own hands on its screen (see Desktop in `API.md`): `computer` takes a screenshot, clicks, drags, scrolls, types and presses keys with `xdotool`, and answers every action with a fresh screenshot scaled to 1280x720; `computer_open_app` opens the browser, the file manager or the terminal. Only exists on an engine with the desktop packages and `maim`, on a model that sees images, for an agent that is neither a delegate nor the Chief of Staff. Screenshots never enter the stored conversation: the run keeps the latest in memory and attaches them to each model call; `codex` gets the path of a temporary file to open with its own `view_image`. One run drives an agent's screen at a time, capped at 200 actions (60 on `claude` and `codex`), and it is refused while a person drives that screen |
| `notify` | `notify_user` | Flags something the user must see, out of band, without pausing the run |
| `hub` | `rerun_hub_service_search`, `rerun_hub_service_details`, `rerun_hub_service_install`, `rerun_hub_service_list_installed`, `rerun_hub_service_uninstall`, `rerun_hub_publish_file`, `rerun_hub_unpublish_file`, `rerun_hub_list_published`, `rerun_hub_search_docs` | The Rerun catalog of apps, public file links and the documentation, through the app |
| `paidData` | `paid_data_catalog`, `paid_data`, `paid_data_read`, `request_spend` | Live data billed on the Rerun credit once the user approves the spend; hidden where the app offers no paid data |
| `cards` | `card_table`, `card_file`, `table_view_save`, `table_view_delete` | Shows a table or a file as a card in the conversation; the Chief of Staff keeps `card_file` only |
| `quickReplies` | (none) | Lets the agent end a message with up to three one-click replies |
| `askUser` | `ask_user` | Asks a question with suggested answers and pauses the run |
| `requestApproval` | `request_approval` | Asks for a go-ahead before a consequential action and pauses the run |
| `suggestService` | `suggest_service` | Suggests catalog apps to set up and pauses the run |
| `requestSecret` | `request_secret` | Asks for a key through a masked form that stores it as an agent variable |

`install_complete` sits outside the families because it answers to a state rather than a setting: it only exists while the agent still has a guided setup to run (`config.setup.required` true, `completedAt` null, `INSTALL.md` present). Calling it also switches on the schedules and triggers the agent carries, because a captured template usually arrives with its crons off and this is the moment its folder is finally configured (see `POST /agents/:id/automations/activate` in API.md).

### MCP

Each agent can declare MCP servers in `config.mcpServers`, and draws on the servers of the Vault items it holds. On a run they are connected (stdio, SSE or streamable HTTP) via the official `@modelcontextprotocol/sdk` and kept in a pool across runs, and their tools are merged into the agent's tool set under `"<server>_<tool>"` names (`mcp__<server>__<tool>` on `claude` and `codex`, which connect to them themselves) (`src/tools/mcp.ts`, `src/tools/mcp-pool.ts`). `mcp_register` lets an agent add one to its own config at runtime.

Every tool sent to the model costs its name, description and JSON schema on each step of the run. When the MCP tools of an agent weigh more than 40,000 characters (`MCP_EAGER_PAYLOAD_CHARS`, about 10,000 tokens), the engine's own loop stops sending them (`src/tools/mcp-search.ts`, `src/tools/mcp-wire.ts`):

- the system prompt lists each server with its number of tools, and the agent gets two more tools, `mcp_search` and `mcp_call`;
- `mcp_search` takes a few words or exact tool names, and optionally a `server`. It returns the name, the description and the input schema of up to 8 tools by default (20 at most). With a `server` alone it lists that server's tool names;
- `mcp_call` takes a `tool` name and its `arguments`, and runs that tool;
- the list of tools sent to the model is the same on every step and every message of the conversation. A list that changed would change the start of the prompt, and the provider would read the whole conversation again outside its prompt cache. The schemas travel in the result of `mcp_search` instead, which is a message of the conversation and is cached like the others;
- `mcp_call` only exists between the engine and the model. A middleware renames the call to the tool it names before the loop sees it, and writes it back as `mcp_call` in the conversation sent to the model, so the stored messages, the `tool_calls` table, the statistics and the app all show `"<server>_<tool>"`;
- a held-back tool called directly by its name still runs;
- the compaction threshold counts the tools that are sent, not the ones held back. Once a compaction has summarised the result of a search, the agent searches again.

Below that weight nothing changes: every MCP tool is sent on every step, and `mcp_search` and `mcp_call` do not exist. The `claude` and `codex` providers are not concerned, since the CLI lists and loads the servers' tools itself.

A server that needs a credential never carries it inline: it references an agent variable as `${KEY}`, resolved from the agent `.env` at connect time (`src/tools/mcp-resolve.ts`); a Vault item's server resolves against that item's `.env` only. The agent gets that value into the `.env` by calling `request_secret`, which pauses the run and shows the user a masked form; the app writes the values through `PATCH /agents/:id/keys` and the agent is told only which variable names were filled. The secret never enters the conversation.

---

## 9. Skills

A skill is a **folder**. `SKILL.md` carries the frontmatter and the procedure; everything else in the folder is a bundled file loaded only when the procedure calls for it, by convention under `references/`:

```
agents/<id>/skills/web-research/
├── SKILL.md
└── references/source-quality.md
```

```markdown
---
name: Web Research
description: How to research a topic on the web
---

1. Identify sources: read `references/source-quality.md` before ranking them
2. Fetch the pages with web_fetch
3. Summarize the findings
```

How they are used, in three layers of progressive disclosure:

- The system prompt only contains a **one-line index** of each skill (name + description).
- When relevant, the agent calls `skill_read <slug>` to load the full procedure and the list of bundled files.
- It calls `skill_read_file <slug> <path>` for a bundled file only at the step that names it. This is what keeps a large corpus out of the context until it is needed.

The agent writes its own skills: `skill_create` / `skill_edit` for the procedure, `skill_write_file` / `skill_delete_file` for the bundled files, `skill_import` to adopt a markdown file or a whole skill folder sitting in its workspace. A skill can read a sibling skill's file (`../other-skill/references/x.md`); it cannot write outside its own folder, nor read outside `skills/`.

`skill_propose` is the other way in: the agent offers to save (or update) a skill from what it just did, the user sees a card in the conversation, and accepting it (`POST /agents/:id/skill-proposals/:pid/accept`) writes the skill in the background.

A skill installed by a **connector** is the exception: the agent reads it, never writes it. The app records each install's footprint in the agent workspace at `.rerun/services.json`, and `src/services/registry.ts` turns the `skills` of that footprint into a slug → connector map. Every writing skill tool consults it at call time, so a connector attached mid-conversation is protected from the very next tool call: `skill_update`, `skill_edit`, `skill_delete`, `skill_write_file` and `skill_delete_file` refuse by slug, `skill_create` and `skill_import` refuse on `slugify(name)` because `writeSkill` overwrites whatever sits at that slug. `skill_list` and `skill_read` say so up front, so the model does not try. The HTTP routes stay open: they are how the connector installs its own skills.

Manage them over the API (`GET/POST /agents/:id/skills`, `GET/PATCH/DELETE /agents/:id/skills/:slug`, `/agents/:id/skills/:slug/files`, `GET /agents/:id/skills/:slug/archive`) or with `rerun skill list <agentId>`.

---

## 10. Scheduled tasks (cron)

Agents can run **on a schedule**, with no user message: the engine's equivalent of cron jobs / background tasks. A scheduled task is a file (file-first, just like skills):

```
agents/<id>/schedules/daily-digest.md
```

```markdown
---
name: Daily digest
description: Morning summary
enabled: true
cron: '0 8 * * *'          # recurring  (OR runAt for a one-shot)
runAt: null                # e.g. '2026-06-03T15:00:00Z'
timezone: Europe/Paris
lastRunAt: null            # written back by the scheduler after each fire
createdAt: '2026-06-02T...'
---
Summarize yesterday's notes and email me a digest.
```

The markdown **body is the prompt** the agent runs when the task fires. A task is either **recurring** (`cron`, standard 5-field expression) or **one-shot** (`runAt`, an ISO 8601 instant).

How it works (`src/runtime/scheduler.ts`):

- `startScheduler()` is launched from `rerun run` (once the data-dir is ready) and ticks every 30 seconds.
- Each tick lists every agent on disk, loads its schedules, and asks `isDue(schedule, now)` (`src/schedules/cron.ts`, backed by [`croner`](https://www.npmjs.com/package/croner)).
- For each due task it starts a **fresh session** (`schedule: <slug>`) and calls the same `runAgent` used by the HTTP routes, so the run is recorded in the `runs` table. Continuity across fires comes from the agent's memory, not the session.
- On success it writes `lastRunAt` back into the file (and disables one-shots). A **failed** run is **not** marked, so it is retried on the next tick. An in-memory guard prevents the same task from overlapping itself.
- `rerun restore-finalize` marks the tasks an archived data-dir slept through as just fired, so a restore does not fire them all at once.

Manage tasks over the API (`GET/POST /agents/:id/schedules`, `GET/PATCH/DELETE /agents/:id/schedules/:slug`, `POST /agents/:id/schedules/:slug/run`), with `rerun schedule list <agentId>`, or let the agent manage its own with the `schedule_*` tools (gated by `config.tools.schedule`).

---

## 11. Memory and RAG

Memories are markdown files; the agent's `system.db` indexes them for retrieval (`src/memory/`).

```
agents/<id>/memory/<memId>.md
```

```markdown
---
id: 4laqkyyphjq7bsnsci8hq
kind: preference
tags: [style]
createdAt: '2026-06-02T14:27:54.214Z'
---

The user prefers concise answers in English.
```

- **Write** (`memory_write` or `POST /agents/:id/memories`): write the `.md` file, embed the text, and upsert a row into the `memories` table (vector + FTS), keeping the file path.
- **Recall** (`memory_recall` or `POST /agents/:id/memories/recall`): embed the query, run libSQL `vector_top_k` KNN, merge with an FTS5 keyword search, dedupe, and re-read the canonical text from the `.md` files.
- **Decay**: each memory has a strength that falls with time and rises when it is recalled. Below a threshold it is `dormant` and left out of recall unless asked for (`includeDormant`).
- Relevant memories are also injected into the system prompt automatically at the start of each run.

Embeddings use OpenAI `text-embedding-3-small` (1536 dims), computed by the app's `/api/embed` endpoint: the engine POSTs the text there (reached via `RERUN_HUB_BASE_URL`, authenticated with `RERUN_API_KEY`) so the provider key lives only in the app. **Without a reachable app, recall still works using FTS keyword search only** (no vectors).

---

## 12. Self-improvement (the curator)

When `selfImprovement.enabled` and `autoMemory` are true, after each run a curator step (`src/runtime/curator.ts`) reviews the exchange and decides, with a structured output call, whether a durable fact is worth keeping. It stores it as a memory, or updates the existing memory it refines. Anything that says how the work is done belongs to a skill, not a memory, so the curator leaves it out: skills come from `skill_propose`, which the user approves.

Combined with the `self` tools (`soul_update`, `verbosity_set`, `tool_install`, `mcp_register`), an agent can extend its own capabilities and accumulate knowledge across conversations.

---

## 13. Security and sandboxing

- **Path jail:** the file tools resolve every path inside their root (the agent's `workspace/`, the global `shared/` space, a skill folder); traversal (`../...`) and absolute paths outside the root are rejected (`resolveWithin` in `src/tools/sandbox.ts`). The same jail backs the HTTP file endpoints. The shared space is deliberately readable and writable by every agent: it is a collaboration surface, not an isolation boundary. The same holds for the shared database behind the `shared_db_*` tools.
- **No cross-database reach:** `ATTACH` is rejected on every SQL path, so an agent cannot open a database file it was not granted through its tools.
- **Command policy:** `shell_exec` blocks a denylist of destructive commands (e.g. `rm -rf /`, `mkfs`, fork bombs). It is not a jail: the shell runs as the engine's user.
- **Secrets never leave:** agent, connection and Vault `.env` files are `chmod 600` and never returned by the API; reads answer variable names only.
- **The Chief of Staff is read-only over HTTP** but for chat, its runs, its files and its model (`src/http/foreman-guard.ts`).
- **Containment:** self-improvement is powerful by design (real shell, real `npm install`). The intended deployment is the engine **inside its own Docker container**, one per workspace, so the blast radius is that container.
- **API auth:** set `RERUN_API_KEY` to require a bearer token on every route except `/health`. The desktop WebSocket takes a short-lived signed ticket instead.

---

## 14. Deployment

### Docker

Build from the repository root, the Dockerfile copies the whole workspace:

```bash
docker build -f apps/engine/Dockerfile -t rerun-engine .
docker run -d -p 127.0.0.1:3000:3000 -v rerun-engine:/data --shm-size 2g \
  -e RERUN_API_KEY=secret -e RERUN_HUB_BASE_URL=<app url> rerun-engine
```

The image runs one Node process as the `rerun` user, with Chromium, the desktop packages and the Codex CLI. `/data` is the data-dir and a volume, so agents and databases persist across restarts and image updates. Keep `RERUN_HOST` at its `0.0.0.0` default inside the container and publish the port on `127.0.0.1` when a reverse proxy on the same machine serves it.

---

## 15. End-to-end test

```bash
B=http://localhost:3000

# a connection holding the provider key
CID=$(curl -s -X POST $B/connections -H 'content-type: application/json' -d '{
  "name": "Anthropic", "provider": "anthropic", "models": ["claude-sonnet-4-6"],
  "keys": { "ANTHROPIC_API_KEY": "sk-ant-..." }
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# an agent on it
AID=$(curl -s -X POST $B/agents -H 'content-type: application/json' -d '{
  "config": { "name": "Scout", "connectionId": "'$CID'", "provider": "anthropic", "model": "claude-sonnet-4-6" },
  "soul": "You are Scout, concise. Use your tools when asked."
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# stream a chat that runs a tool
curl -N -X POST $B/agents/$AID/chat -H 'content-type: application/json' \
  -d '{"message":"Create hello.txt in your workspace with the text hi, then confirm."}'

# the file landed inside the sandbox
curl "$B/agents/$AID/files/read?path=hello.txt"

# memory + skills
curl -s -X POST $B/agents/$AID/memories -H 'content-type: application/json' -d '{"content":"User likes short answers.","kind":"preference"}'
curl -s -X POST $B/agents/$AID/memories/recall -H 'content-type: application/json' -d '{"query":"answer length"}'
curl -s $B/agents/$AID/skills
```

---

## 16. Where things live in the code

| Area | Path |
| --- | --- |
| Entry / CLI | `src/cli/bin.ts`, `src/cli/commands/` |
| Config | `src/config/env.ts`, `src/config/paths.ts` |
| Data-dir ladder and checks | `src/datadir/` (`migrations.ts`, `ladder.ts`, `checks.ts`) |
| Databases | `src/db/` (`client.ts` for `rerun.db`, `systemDb.ts`, `agentDb.ts`, `sharedDb.ts`, `brainDb.ts`, `ladder.ts`, `repos/`) |
| Agents | `src/agents/` (`types.ts`, `factory.ts`, `loader.ts`, `registry.ts`, `providers.ts`, `systemPrompt.ts`, `foreman.ts`, `archive.ts`, `import.ts`) |
| Connections | `src/connections/` |
| Vault | `src/vault/` |
| Brain | `src/brain/` |
| Run loop | `src/runtime/` (`loop.ts`, `stream.ts`, `curator.ts`, `context.ts`, `scheduler.ts`, `notify.ts`, `run-events.ts`) |
| Tools | `src/tools/` (`catalog.ts`, `registry.ts`, `sandbox.ts`, `mcp.ts`, `mcp-pool.ts`, `mcp-search.ts`, `mcp-wire.ts`, `builtin/`) |
| Files store | `src/files/store.ts` (root-scoped fs ops shared by tools and HTTP) |
| Skills | `src/skills/` |
| Schedules / triggers | `src/schedules/`, `src/triggers/` |
| Memory | `src/memory/` (`files.ts`, `embed.ts`, `store.ts`, `decay.ts`) |
| Desktop | `src/desktop/` |
| HTTP | `src/http/` (`server.ts`, `auth.ts`, `foreman-guard.ts`, `routes/`) |
| Docs | `README.md`, `docs/API.md`, `docs/GUIDE.md` |
