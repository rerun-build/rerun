# rerun-engine: API

Base URL: `http://localhost:3000` (configurable via `RERUN_PORT` / `RERUN_HOST`).

One engine serves one workspace: every coworker of that workspace, its connections, its Vault, its
shared files and database, its company brain. The Rerun app (the "hub" in the code) is its usual
caller.

## Authentication

If `RERUN_API_KEY` is set, every route except `GET /health` requires:

```
Authorization: Bearer <RERUN_API_KEY>
```

A wrong or missing key answers `401 { "error": "Unauthorized" }`. If `RERUN_API_KEY` is unset, the
API is open (dev mode). A server paired from the app's Servers page makes up its own key at first
start. The desktop WebSocket is the one exception: it takes a signed ticket (see
[Desktop](#desktop)).

## Conventions

- Request and response bodies are JSON (`Content-Type: application/json`), except the streams
  (`POST /agents/:id/chat`, `GET /agents/:id/runs/:rid/stream`), the archives (`.tar.gz`), the raw
  file routes, the table exports and `POST /agents/import`.
- Errors return `{ "error": "<message>" }` with an appropriate status: `400` invalid body (a schema
  failure lists each field as `path: message`) or path outside its root, `401` unauthorized, `403`
  forbidden, `404` not found, `409` conflict, `500` internal. A few carry a `code` as well.
- IDs are 21-character strings of `[0-9a-z]`. Timestamps are ISO 8601.

### The Chief of Staff

`foreman` is the agent id of the Chief of Staff, the built-in agent the engine rewrites from code at
every boot. It is not in `GET /agents`. Under `/agents/foreman` only these routes are open: `GET`
itself, `POST /chat`, `GET /sessions` and `/sessions/:sid/messages`, `GET /runs`, `/runs/:rid`,
`/runs/:rid/stream`, `/runs/:rid/steps`, `POST /runs/:rid/cancel` and
`/runs/:rid/tasks/:taskId/cancel`, `GET /files/read`, `GET|PUT|POST /files/raw`, `DELETE /files`,
and a `PATCH` that only carries `connectionId`, `provider` and `model`. Anything else answers
`403 { "error": "The foreman is managed by the engine and cannot be changed" }`.

---

## Health

### `GET /health`

No auth. Liveness, what is running, what this build can do, and the data-dir migration ladder: the
version the folder is at against the one this build takes it to.

```json
{
  "status": "ok",
  "activeAgents": 2,
  "activeRuns": 1,
  "claimedSessions": 1,
  "desktopViewers": 0,
  "capabilities": ["files.stream", "foreman.files", "schedules.rename", "update.artifact", "connections.opencode", "connections.custom", "vault", "desktop"],
  "commit": "e70322d",
  "startedAt": "2026-11-16T09:12:03.512Z",
  "layout": "release",
  "lastUpdate": { "status": "success", "commit": "e70322d", "at": "2026-11-16T09:11:40.020Z" },
  "dataVersion": 6,
  "dataVersionTarget": 6
}
```

- `activeAgents` are the agents loaded in memory, `activeRuns` the runs in flight, `claimedSessions`
  the conversations holding a run (the two should move together), `desktopViewers` the open screen
  connections.
- `capabilities`: `files.stream` (`PUT .../files/raw`), `foreman.files` (the Chief of Staff's file
  routes), `schedules.rename` (a schedule `PATCH` takes `name`), `update.artifact` (`POST /update`
  takes a prebuilt artifact), `connections.opencode`, `connections.custom`, `vault`, and `desktop`
  only when the desktop packages are installed.
- `commit` is the short commit of the build, `null` when unknown. `layout` is `release`,
  `monorepo` or `image`. `lastUpdate` is what the last `rerun update` did (`status` `running`,
  `restarting`, `success` or `error`, with `error` then), `null` before the first one.

### `GET /doctor`

Read-only checks of the data-dir, the same as `rerun doctor`: `data-version` (ladder version),
`index` (`rerun.db` and its agent rows), `agents-on-disk` (index against agent folders, every
`config.json` readable), `system-db` (every `system.db` at its ladder's version), `connections`
(readable, the Rerun connection present), `vault` (informative: items attached to coworkers that are
gone, apps not adopted yet), `shared-db`. Nothing is migrated. `agentIds` is the engine's agent
index.

```json
{
  "ok": false,
  "dataVersion": 6,
  "dataVersionTarget": 6,
  "agentIds": ["a1"],
  "checks": [
    { "name": "data-version", "ok": true, "detail": "v6" },
    { "name": "agents-on-disk", "ok": false, "detail": "folder without an index row: a2" }
  ]
}
```

---

## Update

### `POST /update`

Starts a self-update in a detached `rerun update`: a git pull and rebuild, or the prebuilt release
named in the body, then the migration and a restart of the systemd service. Its output goes to
`update.log` in the data-dir; `GET /health` reports the outcome in `lastUpdate`.

```json
{ "force": false, "artifact": { "url": "https://.../rerun-engine.tar.gz", "sha256": "<64 hex>", "commit": "e70322d", "bytes": 52428800 } }
```

Both fields are optional. `artifact.url` must be `https`, `sha256` 64 hex characters, `commit` a git
hash; otherwise `400`. Answers:

- `202 { "started": true, "commit": "<current>", "lastUpdate": { ... } }`
- `200 { "started": false, "reason": "busy", "activeRuns": 1 }` while a run, a screen viewer or a
  browser takeover is live, unless `force` is true
- `200 { "started": false, "reason": "already-updating" }`

---

## Desktop

A screen per agent, for a person to watch and drive. Present when `/health` lists the `desktop`
capability, which means `openbox`, `x11vnc` and `xdotool` are installed. Every agent has its own
Xvfb display, so what one agent has open never shows on another's screen. Nothing runs until a
session is asked for, and an agent's window manager and VNC server stop five minutes after its last
viewer left, unless a takeover is still open. The screens are separate, the files are not: every
app runs as the engine's user.

The display is an Xvfb at 1920x1080 on the first free number (`-displayfd`), shared by the agent's
Chromium and its desktop, and stopped a minute after nothing holds it. Display `:N` is served by
x11vnc on `127.0.0.1:5900+N`. An engine started with `DISPLAY` set starts no Xvfb: every agent then
shares that display. `shell_exec` does not get the agent's display, so a program with a window
started from it shows on no screen; the terminal of the desktop does.

Every agent's processes run as that one user in one process namespace, so a command that stops
programs by name (`pkill -f`, `killall`) stops them for every agent of the engine.

Where `tint2` and `hsetroot` are installed too, the screen is a small computer: a wallpaper, a top
bar with the agent's name and the time, and a dock that opens the browser, the files and the
terminal. A screen reports it as `dock: true`; without it the caller draws its own launcher.

Every route under `/agents/:id/desktop` answers `404` for an unknown agent.

### `GET /desktop`

```json
{ "available": true, "screens": [{ "agentId": "researcher", "viewers": 1, "takeover": false, "dock": true, "agentDriving": false }] }
```

`screens` lists the desktops that are running. `agentDriving` is true while a run of the agent has its
hands on the screen through the `computer` tools.

### `POST /agents/:id/desktop/session`

Starts the agent's desktop if it is not running. Returns the same status. An optional
`{ "timeZone": "Europe/Paris" }` sets the clock of a screen that is starting: the engine keeps UTC.

### `POST /agents/:id/desktop/apps`

Opens an app on the agent's screen, or brings its window forward when it is already open. Returns
the status.

```json
{ "app": "files" }
```

`app` is `browser`, `files` or `terminal`. The last two open on the agent's workspace. `browser`
is a takeover with no page, which also closes once nobody has watched the screen for a minute. The
dock of the screen calls this route itself.

### `POST /agents/:id/desktop/takeover`

Opens the agent's own browser profile in a window on its screen, optionally on a page, and keeps it open so a
person can sign in or pass a check. The profile stays locked meanwhile: a `browser_navigate` of the
same agent waits. It closes on `DELETE`, when the window is closed, or after fifteen minutes.
Returns the status.

```json
{ "url": "https://www.linkedin.com/login" }
```

### `DELETE /agents/:id/desktop/takeover`

Closes that browser and returns the page it was on. With `?keepOpen=1` the window stays and the
browser goes back to the run that asked for it (`request_takeover`), which carries on in it; `open`
is then true.

```json
{ "url": "https://www.linkedin.com/feed/", "open": false }
```

### `GET /desktop/ws?ticket=…` (WebSocket)

The VNC stream of one agent's screen, as a WebSocket a noVNC client speaks to directly. It is the only route
meant to be reached from a browser, so it does not take the bearer key: the ticket is
`base64url(JSON { "exp": <ms epoch>, "agent": "<agent id>", "mode": "watch" | "drive" }) + "." + base64url(HMAC-SHA256(payload, RERUN_API_KEY))`,
minted by the hub for one minute. The agent in the ticket is the screen that opens, so a ticket for
one agent never shows another. A `drive` connection keeps the agent's own `computer` tools off the
screen until it closes or sends no mouse or key event for two minutes; a `watch` connection does
not. A ticket without a mode drives. A bad ticket answers `401`, any other upgrade path `404`.

---

## Tools

### `GET /tools`

The static catalog of every tool family and the tools it contains (name + description). This is the source of truth for which `config.tools` flags exist. For an agent's enabled state, use `GET /agents/:id/tools`.

```json
{ "families": [ { "family": "filesystem", "description": "...", "tools": [ { "name": "fs_edit", "description": "..." } ] } ] }
```

`computer` is left out on an engine without a screen, `paidData` where the app offers no paid data.

---

## Connections

An AI provider credential held by the engine, not by an agent. Plugging a subscription or an API key
once makes it available to every agent, and each agent points at one through `config.connectionId`.
Several connections can share a provider, which is the point: one Claude subscription per person.

`provider` is one of `rerun`, `anthropic`, `claude`, `codex`, `openai`, `google`, `openrouter`,
`opencode`, `custom` (`providerSchema` in `packages/contracts/src/agent.ts`). `claude` and `codex`
are the Claude and ChatGPT subscriptions, run through the Claude Code and Codex CLIs.

Credentials live in `connections/<id>/.env` (chmod 600) and are **never returned** by any
endpoint. A Codex connection also owns `connections/<id>/.codex/`, so the agents sharing a
ChatGPT plan share one refresh lineage instead of racing to rotate their own copies.

The engine always carries a connection with id `rerun`: the keyless Rerun models, proxied by the
app. It cannot be renamed or deleted, only re-curated.

### `GET /connections`

```json
{
  "connections": [ { "id": "abc...", "name": "Claude Clement", "provider": "claude", "models": ["opus", "sonnet"], "extraModels": [], "connected": true, "createdAt": "2026-08-22T..." } ],
  "default": { "connectionId": "abc...", "model": "opus" }
}
```

`connected` says whether the credential is present, without disclosing it. `default` is the engine
default model (see below), `null` when nobody set one.

### `PUT /connections/default`

The connection and model every agent that named none of its own runs on. One record for the whole
engine, stored in `connections/default.json`.

```json
{ "connectionId": "abc...", "model": "opus" }
```

`404` when the connection is unknown, `400` when it does not offer that model. `DELETE
/connections/default` clears it (`{ "default": null }`), and resolution falls back to the keyless
`rerun` connection until a connection adopts the default again (see `POST /connections`).

### `POST /connections`

```json
{
  "name": "Claude Clement",
  "provider": "claude",
  "models": ["opus", "sonnet"],
  "keys": { "CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat-...", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN": "..." }
}
```

`models` is the curated list this connection offers: it is what a model picker shows, and what an
automation is checked against before it runs. Response `201`, same shape as the list entries.

The first connected connection on an engine adopts the engine default, on its first curated model:
with no default written, every agent that named no model of its own stays on `rerun`, so plugging in
a credential would otherwise change nothing until someone set the default by hand. It only fires
while no other connection outside `rerun` holds a credential, and `PATCH /connections/:id/keys`
does the same when the credential arrives after the connection.

### `PATCH /connections/:id`

Any subset of `name`, `models`, `baseUrl`, `extraModels`, replaced wholesale. The provider is fixed
at creation: changing it would leave a credential no provider reads, which reads as "connected"
while every run fails.

`baseUrl` points an `openrouter` connection at an OpenRouter-compatible router of your own (same
wire format, different host); empty falls back to `https://openrouter.ai/api/v1`. `extraModels`
lists model ids beyond the UI's curated catalog, served through that same connection.

```json
{ "name": "Team plan", "models": ["sonnet"], "baseUrl": "https://router.example.com/v1", "extraModels": ["acme/router-large"] }
```

### OpenCode connections

`provider: "opencode"` takes one key, `OPENCODE_API_KEY` (`oc_sk_…`), valid on both OpenCode
catalogs: **Go**, a subscription, and **Console**, paid per token from the account's credits. Model
ids carry their plan: `go/deepseek-v4-pro`, `console/claude-sonnet-5-5`. The same model sold on
both sides is two ids, and only the id without its plan is sent to OpenCode.

There is no CLI: the engine runs OpenCode in its own loop, on the SDK of the format each model is
served on (Anthropic messages, OpenAI responses, OpenAI chat, Google). Every request carries
`x-opencode-session` (the conversation id, refused without it) and follows no redirect.

- The catalog is read live from `https://opencode.ai/inference/{go/,}v1/models` (public, no key):
  at boot, on `GET /connections` when older than 30 minutes, before a new connection adopts the
  default, and after a `400 Model is unavailable`. The snapshot built into `@rerun/contracts` stands
  in until it answers. `providerModels` on the summary lists what the catalog reaches today.
- `planLimits` reads `https://opencode.ai/zen/go/v1/usage`: the five-hour `session`, `weekly` and
  `monthly` windows of the Go plan, for the whole account.
- A step records its real cost: `0` on Go, OpenCode's list price on Console.
- A refusal is rewritten into a sentence the chat knows: `402` → "OpenCode Console credits used
  up", `429` on Go once the usage read taken on the spot says a window is spent → "OpenCode Go limit
  reached", `401` → "OpenCode key refused".
- On a model without vision, the `vision_analyze` tool asks another model of the connection that
  sees, and the computer tools are not offered.

### Custom connections

`provider: "custom"` is any server that speaks the OpenAI chat format: Ollama, LM Studio, vLLM,
LiteLLM, Groq, Together, Mistral, DeepSeek, a router of your own. `baseUrl` is required (the `/v1`
root, `/chat/completions` is appended) and the key is optional, stored as `CUSTOM_API_KEY` and sent
as `Authorization: Bearer`. The connection counts as connected as soon as it has an address.

- Requests carry nothing of OpenRouter's dialect (`reasoning`, `usage`, `provider`, `cache_control`,
  `prompt_cache_key`). A `reasoning_content` the server streams back shows as the model's thought.
- `GET {baseUrl}/models` is read at boot, on `GET /connections` when older than 30 minutes, on
  create and when `baseUrl` changes. `discoveredModels` on the summary lists what it answered, with
  the window when the server states one (`context_length`, `max_model_len`). A failed read keeps the
  previous one.
- Compaction budgets against the listed window, then the connection's `contextWindow`, then 128k.
- `vision` (default `false`) says whether the models see images: without it no screenshot is sent
  and the computer tools are not offered.
- A run that cannot reach the server fails with "Could not reach the custom endpoint at
  host:port (ECONNREFUSED)".

```json
{ "name": "Ollama", "provider": "custom", "baseUrl": "http://localhost:11434/v1", "models": ["qwen3:4b"], "contextWindow": 32768, "vision": false, "keys": {} }
```

### `POST /connections/probe`

Asks an endpoint before a connection exists, from the engine rather than the app: on a self-hosted
install the server sits on the owner's machine or network, which only the engine reaches.

```json
{ "baseUrl": "http://localhost:11434/v1", "apiKey": "optional", "model": "optional" }
```

Without `model` it reads `GET /models`; with one it also asks that model for one token, for a
server that does not list its models. A loopback address that does not answer is tried again as
`host.docker.internal`, and `baseUrl` in the answer is the address that answered.

```json
{ "baseUrl": "http://host.docker.internal:11434/v1", "models": [{ "id": "qwen3:4b", "contextWindow": null }], "problem": null, "detail": null }
```

`problem` is `unreachable`, `unauthorized`, `not_listed` or `model_refused`, with the server's
answer in `detail`. Advertised by the `connections.custom` capability on `GET /health`.

### `PATCH /connections/:id/keys`

```json
{ "set": { "ANTHROPIC_API_KEY": "sk-ant-..." }, "remove": ["OPENAI_API_KEY"] }
```

Returns the resulting key names. `400` on the keyless `rerun` connection.

### `GET /connections/:id/usage`

What a delete would move back onto the engine default model.

```json
{ "agents": [ { "id": "abc...", "name": "Scout" } ], "automations": [ { "agentId": "abc...", "kind": "schedule", "slug": "weekly-digest" } ], "isBoxDefault": false }
```

An agent only counts as pointing at a connection when it also pinned a model: a `connectionId`
sitting next to `"model": null` is a leftover, and that agent already follows the engine default.
`isBoxDefault` says whether this connection holds the engine default.

### `DELETE /connections/:id`

Never refuses over usage. Every agent, schedule and trigger pointing at the connection is released
first (`connectionId`, `provider` and `model` back to `null`, which means "run whatever the engine
runs") and the engine default is cleared if this connection held it. `400` for `rerun`.

```json
{ "deleted": "abc...", "released": { "agents": [ { "id": "abc...", "name": "Scout" } ], "automations": [], "isBoxDefault": true } }
```

---

## Agents

Every route under `/agents/:id` answers `404 { "error": "agent not found" }` for an unknown agent.

### `GET /agents`

List the agent index (the Chief of Staff is not in it).

```json
{ "agents": [ { "id": "abc...", "name": "Scout", "status": "idle", "createdAt": "2026-06-02T..." } ] }
```

### `POST /agents`

Create an agent. Scaffolds `agents/<id>/` (SOUL.md, config.json, .env, workspace/, skills/, memory/), plus INSTALL.md when an `install` prompt is sent. The new agent gets the Vault items shared with everyone at once.

Request:

```json
{
  "config": {
    "name": "Scout",
    "description": "A research agent",
    "connectionId": "abc...",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "tools": { "filesystem": true, "shell": true, "web": true, "schedule": true },
    "mcpServers": [],
    "selfImprovement": { "enabled": true, "allowToolInstall": true, "allowSoulEdit": true, "autoMemory": true },
    "setup": { "required": true, "completedAt": null }
  },
  "soul": "You are Scout, a curious researcher.",
  "install": "Ask the user for their SERP API key with request_secret, then run one test search.",
  "keys": { "SERP_API_KEY": "..." }
}
```

Only `config.name` is required; everything else has defaults, and `kind` cannot be set. `keys` are written to the agent's `.env` (chmod 600) and **never returned**; they are the agent's own secrets (MCP servers, connectors, shell variables), not provider credentials: those live on a connection. Vector memory recall is handled centrally by the app's `/api/embed` endpoint (see GUIDE.md), so no per-agent embedding key is required.

`install` is the guided setup an agent runs on its own the first time its owner opens it, and it lands in `INSTALL.md`. It is only replayed when `config.setup.required` is `true` and `config.setup.completedAt` is `null`; while that holds, the agent also gets an `install_complete` tool, which is how it closes its own setup. `required` is three-valued on purpose: `null` means nobody answered the question yet, which is not the same as "this agent needs nothing". An import resets `completedAt` to `null`, so every copy of an agent installs itself once.

Response `201`: the agent, in the shape of `GET /agents/:id`.

### `GET /agents/:id`

Return an agent's config, soul and install prompt (no keys).

```json
{ "id": "abc...", "config": { ... }, "soul": "You are Scout...", "install": "Ask the user...", "resolvedConnectionId": "abc...", "resolvedProvider": "anthropic", "resolvedModel": "claude-sonnet-4-6" }
```

The `resolved*` fields are what the engine would actually run this agent on once its pin, the engine default and the fallbacks are applied: a resolution, not a setting.

### `PATCH /agents/:id`

Partially update `config.json` and hot-reload the agent. Body = any subset of `config` fields, plus `soul` and `install`. The nested `tools`, `selfImprovement` and `setup` objects are deep-merged, so you can toggle a single flag without resetting the others. `mcpServers` is refused here (`400`): use `PATCH /agents/:id/mcp-servers`.

```json
{ "model": "claude-opus-4-8", "tools": { "shell": false } }
```

`install` is written wholesale, and unlike `soul` it can be cleared: sending `""` deletes `INSTALL.md`, which is what answering "no setup needed" means.

```json
{ "setup": { "required": true }, "install": "Ask for the Stripe key, then test it." }
```

A new `name` is rewritten wherever the other agents mention the old one; a new `displayName` is rewritten in the soul. Returns the agent, as `GET /agents/:id`.

`model: null` is the switch between "this agent picked a model" and "it runs whatever the engine does". A null model follows the engine default and moves with it, whatever `connectionId` or `provider` is still sitting next to it. Sending `null` for the three is how a pinned agent goes back to that.

`connectionId` is the connection a pinned agent draws its credentials from. `null` means it has none of its own, and the engine resolves one at load time: the oldest connection matching `provider`, then the engine default, then the keyless `rerun` one. That fallback is what makes an imported template runnable: a connection id from another engine means nothing here, so an archive carries `provider` and drops `connectionId`.

```json
{ "connectionId": "abc...", "provider": "claude", "model": "opus" }
{ "connectionId": null, "provider": null, "model": null }
```

### `DELETE /agents/:id`

Closes its screen and takeover, unloads it, detaches it from every Vault item, removes the index row and deletes `agents/<id>/` recursively.

```json
{ "deleted": "abc..." }
```

### `GET /agents/:id/tools`

List every tool family, its tools (name + description), and whether it is currently `enabled` for this agent. Use this to drive a toggle UI.

```json
{ "families": [ { "family": "browser", "description": "...", "enabled": true, "tools": [ { "name": "browser_navigate", "description": "..." } ] } ] }
```

### `GET /agents/:id/keys`

The names of the agent's own env variables, never their values, and the `RERUN_*` variables the engine itself has set.

```json
{ "keys": ["STRIPE_API_KEY"], "engineKeys": ["RERUN_API_KEY", "RERUN_DATA_DIR"] }
```

### `PATCH /agents/:id/keys`

```json
{ "set": { "STRIPE_API_KEY": "sk_test_..." }, "remove": ["OLD_KEY"] }
```

Merged into the agent's `.env` and hot-reloaded; returns `{ "keys": [...] }`, the resulting key
names. Provider credentials do not belong here: use `PATCH /connections/:id/keys`.

### `PATCH /agents/:id/mcp-servers`

Adds or replaces MCP servers by name, and removes others, in one write.

```json
{ "upsert": [{ "name": "linear", "transport": "http", "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer ${LINEAR_API_KEY}" } }], "remove": ["old-server"] }
```

`400` for a name outside `MCP_SERVER_NAME_RE` and for `rerun`, the name the engine reserves for the
bridge that serves its own tools to the CLIs. Returns the agent, as `GET /agents/:id`.

### `GET /agents/:id/mcp-servers/status`

Dials each server for real, so it is slow by nature: pass `?name=<server>` (repeatable) to ask only
for the ones you need. The Vault's servers count, the bridge does not.

```json
{ "servers": [{ "name": "linear", "status": "needs_auth", "transport": "http", "toolCount": 0, "error": "401" }] }
```

`status` is `connected`, `needs_auth` or `error`.

### `PUT /agents/:id/mcp/:name/token` · `DELETE /agents/:id/mcp/:name/token`

Store the OAuth token of one of the agent's own MCP servers, in `mcp/<name>.json`, or forget it.
Both answer `{ "ok": true }`.

```json
{ "accessToken": "...", "refreshToken": "...", "expiresAt": 1763290000000, "scope": "read", "tokenEndpoint": "https://.../token", "clientId": "...", "clientSecret": "..." }
```

Only `accessToken` is required; `obtainedAt` defaults to now.

### `POST /agents/:id/automations/activate`

Switch on every schedule and trigger of the agent that is currently off, and return the slugs that changed:

```json
{ "schedules": ["daily-digest"], "triggers": ["inbound"] }
```

This is what closes an installation. The engine calls it by itself when an agent is imported with no setup pending, and when the agent calls `install_complete`; the route exists for the third case, an install the user skipped. Already-running automations are left untouched, a one-shot whose `runAt` has passed stays off, and a cron is rebaselined to now so it fires at its next genuine occurrence rather than in catch-up. An agent with `config.enabled: false` is a no-op: the host paused its schedules on purpose.

### `POST /agents/:id/duplicate`

A copy on this same engine, so it takes JSON rather than an archive: nothing leaves the engine.

```json
{ "name": "scout-2", "displayName": "Scout 2" }
```

Response `201`:

```json
{ "id": "xyz...", "name": "scout-2", "displayName": "Scout 2", "description": "", "schedules": ["daily-digest"], "triggers": ["inbound"], "memoriesIndexed": 12 }
```

Every trigger of the copy gets a URL of its own, and its schedules count from now. The copy is
attached to every Vault item the source was attached to.

### `GET /agents/:id/archive/plan`

What the archive of this agent would carry, before it is built: the review a template capture
shows. `?exclude=<path>` (repeatable) leaves paths out.

```json
{
  "agentId": "abc...", "name": "scout", "displayName": "Scout", "description": "", "provider": "anthropic", "model": "claude-sonnet-4-6",
  "tools": ["filesystem", "web"],
  "files": [{ "path": "workspace/notes.md", "bytes": 120, "flagged": [], "defaultExcluded": false, "note": "" }],
  "totalBytes": 4096,
  "connectorSlugs": ["linear"],
  "skills": [{ "slug": "web-research", "name": "Web Research", "description": "" }],
  "schedules": [{ "slug": "daily-digest", "name": "Daily digest", "cron": "0 8 * * *" }],
  "triggers": [{ "slug": "inbound", "name": "Inbound", "description": "", "methods": ["POST"], "enabled": true }],
  "strippedConfigKeys": [], "envKeys": ["SERP_API_KEY"], "mcpAuth": [{ "server": "linear", "kind": "oauth" }],
  "redactions": [], "memoryCount": 3,
  "setup": { "required": true, "completedAt": null, "prompt": "Ask the user..." },
  "engineCommit": "e70322d"
}
```

`flagged` names the secret patterns a file matched, and `defaultExcluded` what a review starts with
unchecked.

### `GET /agents/:id/archive`

The agent folder as a `.tar.gz` (`Content-Disposition: attachment; filename="<id>.tar.gz"`), with
the same `?exclude=`. It carries `SOUL.md`, `INSTALL.md`, `config.json`, `.env`, `skills/`,
`schedules/`, `triggers/`, `workspace/`, `memory/` and `data/agent.db`; never the browser profile,
the MCP tokens nor `system.db`. Literal secrets in `config.json` become `${VAR}` references, `.env`
ships its names with empty values, and every trigger ships with an empty token. `400` when a file is
over 25 MB or the whole over 150 MB.

What the agent holds from the Vault is carried as its own: the items' servers in `config.json`,
their variables as empty keys in `.env`, their apps in the connector registry back to `needs_auth`
or `needs_config`. No value and no item id leaves the engine.

### `POST /agents/import`

The body is the gzipped archive itself (not multipart), streamed to disk. `?name=` (required) is the
copy's `name`, `?displayName=` its display name.

```bash
curl -X POST "$B/agents/import?name=scout-copy&displayName=Scout" --data-binary @scout.tar.gz
```

Response `201`:

```json
{ "id": "xyz...", "name": "scout-copy", "displayName": "Scout", "description": "", "soul": "...", "envKeys": ["SERP_API_KEY"], "mcpAuth": [{ "server": "linear", "kind": "oauth" }], "connectorSlugs": ["linear"], "triggers": ["inbound"], "memoriesIndexed": 3, "skippedPaths": [] }
```

`envKeys` are the variables the copy must be given again, `mcpAuth` the servers to re-authorize,
`triggers` the webhooks it now owns behind new URLs, `skippedPaths` the entries refused on the way
in (a path outside the agent folder). `400` for a body that is not an agent archive, has no
readable `config.json`, or holds more than 100,000 entries.

---

## Chat

### `POST /agents/:id/chat`

Creates a session if `sessionId` is omitted, appends the user message, runs the agent loop
(multi-step tool calling until the model stops calling tools or asks the user something), persists
the assistant and tool messages, and runs the curator when `selfImprovement.enabled`.

```json
{
  "sessionId": "optional-existing-session",
  "message": "Write hello.txt in your workspace",
  "connectionId": "abc...",
  "provider": "claude",
  "model": "opus",
  "source": "dashboard",
  "author": { "id": "user-uuid", "name": "Ana" },
  "callableAgentIds": ["abc...", "def..."],
  "install": false,
  "userLanguage": "fr"
}
```

Only `message` is required.

- `connectionId`, `provider` and `model` override the agent's own for this turn only; omit them to
  run on what `config.json` carries. A connection that cannot serve the model is not silently
  substituted here: that repair only happens for automations.
- `source` names where the conversation comes from: `dashboard` (default), `builder`, `schedule`,
  `agent`, `delegate`, `api`, `trigger`.
- `author` is the person who typed, kept on the message (the engine has no users of its own).
- `callableAgentIds` narrows the coworkers `call_agent` offers to the ones the author reaches; absent,
  every coworker can be called.
- `install: true` on a new conversation starts the agent's guided setup there, and `userLanguage`
  tells it the language the user reads the app in.
- `foreman` is read only on `/agents/foreman/chat`: the instructions and the tools the app hands the
  Chief of Staff for this turn.

Returns an **SSE stream** (AI SDK UI message stream protocol). The session id is in the
`x-session-id` response header and the run id in `x-run-id`. Event lines look like:

```
data: {"type":"start"}
data: {"type":"text-delta","id":"0","delta":"Hi"}
data: {"type":"text-end","id":"0"}
```

Errors, before the stream opens:

- `403 { "error": "This coworker is switched off and cannot run." }` when `config.enabled` is false.
- `404 { "error": "session not found for this agent" }` for a `sessionId` the agent does not have.
- `409 { "error": "...", "code": "run_in_flight", "runId", "sessionId", "startedAt", "authorId" }`
  while another run holds the session: one run per conversation at a time.
- `409 { "error": "...", "code": "install_in_flight", "sessionId" }` for an `install` while the
  setup already runs in another conversation.

A client that lost the stream picks it up with `GET /agents/:id/runs/:rid/stream`.

---

## Sessions

### `GET /agents/:id/sessions`

List the agent's sessions, most recently updated first.

```json
{ "sessions": [ { "id": "xyz...", "agentId": "abc...", "title": "Untitled", "status": "open", "source": "dashboard", "originAgentId": null, "originSessionId": null, "createdAt": "...", "updatedAt": "..." } ] }
```

`originAgentId` and `originSessionId` name the coworker and conversation that opened it through
`call_agent`.

### `GET /agents/:id/sessions/:sid`

One session, same shape. `404 { "error": "session not found" }` when it belongs to another agent.

### `GET /agents/:id/sessions/:sid/messages`

Full transcript of a session (ordered). `404` if the session does not belong to the agent.

```json
{ "messages": [ { "id": "...", "sessionId": "...", "role": "user", "contentJson": "\"hi\"", "toolCallsJson": null, "authorId": "user-uuid", "authorName": "Ana", "createdAt": "..." } ] }
```

`role` is `user` | `assistant` | `tool`. `contentJson` is the JSON-encoded AI SDK message content (string for user text; arrays of parts for assistant/tool).

---

## Memories

Memories are markdown files (`agents/<id>/memory/<memoryId>.md`) indexed in the agent's
`system.db` for retrieval. Each has a strength that decays with time and grows when it is recalled;
below a threshold it is `dormant`.

### `GET /agents/:id/memories`

List all memory entries.

```json
{ "memories": [ { "id": "...", "kind": "preference", "tags": [], "createdAt": "...", "content": "The user prefers concise answers.", "lastAccessedAt": null, "accessCount": 0, "strength": 0.97, "status": "active" } ] }
```

### `POST /agents/:id/memories`

Write a memory (file + index, embedded when the app's `/api/embed` is reachable).

```json
{ "content": "The user prefers concise answers.", "kind": "preference", "tags": ["style"] }
```

Returns `{ "id": "..." }` `201`. `kind` defaults to `note`.

### `POST /agents/:id/memories/recall`

Hybrid recall: vector KNN (if embeddings are available) + FTS5 keyword, merged. `limit` defaults to
5 (max 20); dormant memories are left out unless `includeDormant` is true. A recall through this
route does not reinforce what it finds.

```json
{ "query": "how should I answer", "limit": 5, "includeDormant": false }
```

```json
{ "memories": [ { "id": "...", "content": "The user prefers concise answers.", "kind": "preference", "tags": ["style"], "createdAt": "...", "strength": 0.97, "status": "active" } ] }
```

### `DELETE /agents/:id/memories/:memoryId` · `DELETE /agents/:id/memories`

Delete one memory, or all of them (file and index). Both answer `204`.

---

## Skills

A skill is a **folder** on disk: `agents/<id>/skills/<slug>/`. `SKILL.md` holds the frontmatter (`name`, `description`) and the procedure; anything else in the folder is a bundled file the agent reads on demand, by convention under `references/`.

```
skills/web-research/
├── SKILL.md
└── references/sources.md
```

`files` lists those bundled files as paths relative to the skill folder.

These routes write any skill, including one a connector installed. That is deliberate: the install path itself goes through them. The read-only rule for a connector's skills is enforced one layer up, in the agent's `skill_*` tools and in the app's own writes (see [GUIDE.md](./GUIDE.md#9-skills)).

### `GET /agents/:id/skills`

```json
{ "skills": [ { "slug": "web-research", "name": "Web Research", "description": "...", "body": "1. ...", "files": ["references/sources.md"] } ] }
```

`?summary=1` leaves out each body and file list, for a listing that only shows names.

### `POST /agents/:id/skills`

```json
{ "name": "Web Research", "description": "How to research a topic", "body": "1. Identify sources\n2. Fetch\n3. Summarize" }
```

Returns the created skill `201`. The slug is derived from the name.

### `POST /agents/:id/skills/import`

Import a whole skill from raw markdown, with its bundled files.

```json
{ "content": "---\nname: Web Research\n---\n\n1. ...", "files": [{ "path": "references/sources.md", "content": "..." }], "overwrite": false }
```

`name` and `description` fill a frontmatter that lacks them. `slug` names an existing skill to
replace (`404` when there is none); `overwrite: true` replaces the skill that has the derived slug.
`201` for a new skill, `200` for a replaced one, `400` on invalid markdown or an out-of-folder path,
`409` if the name is taken. Limits: 200 reference files, 10 MB per file, 50 MB total including
`SKILL.md`.

### `GET /agents/:id/skills/:slug`

Return one skill (frontmatter + body + bundled `files`). `404` if unknown.

### `GET /agents/:id/skills/:slug/archive`

The whole skill folder as a `.tar.gz`, rooted at `<slug>/`.

### `PATCH /agents/:id/skills/:slug`

Update a skill. Body: `{ "description"?, "body"? }`. Bundled files are untouched.

### `DELETE /agents/:id/skills/:slug`

Delete the skill folder. `204`.

### `/agents/:id/skills/:slug/files`

The [file routes](#files), rooted at the skill folder. `SKILL.md` cannot be deleted through it
(`400`): delete the skill instead.

---

## Skill proposals

What an agent offers to save as a skill with `skill_propose`. The user decides on a card in the
conversation; nothing is written before they accept. `status` is `proposed`, `accepted` (being
written), `applied`, `failed` or `dismissed`.

### `GET /agents/:id/skill-proposals?session=<sid>`

The proposals of one conversation. `session` is required (`400`).

```json
{ "proposals": [ { "id": "...", "sessionId": "...", "toolCallId": "...", "mode": "create", "slug": null, "title": "Weekly report", "summary": "...", "instructions": ["..."], "status": "proposed", "appliedSlug": null, "error": null, "createdAt": "..." } ] }
```

`mode` is `create` or `edit` (then `slug` names the skill to change). A rule the agent proposes
later in the same conversation joins the proposal still `proposed` as one more entry of
`instructions`, and its `title` and `summary` replace the previous ones, so they name every rule.

### `POST /agents/:id/skill-proposals/:pid/accept`

Starts writing the skill in the background and answers at once, `202 { "proposal": { ... "status": "accepted" } }`.
A proposal already past `proposed` or `failed` is returned as it is, `200`. The job opens no run and
adds nothing to the conversation; the proposal ends `applied` (with `appliedSlug`) or `failed`
(with `error`, and can be accepted again).

### `POST /agents/:id/skill-proposals/:pid/dismiss`

`{ "proposal": { ... "status": "dismissed" } }`. Both routes answer `404` for an unknown proposal.

---

## Files

Three roots share one router:

- **Per-agent (private):** `/agents/:id/files` → the agent's `agents/<id>/workspace/`. This is the same jail the `fs_*` tools use.
- **Shared (global):** `/shared/files` → `shared/`, a common space every agent can read and write (the `shared_*` tools). Use it to move files between agents.
- **Skill folder:** `/agents/:id/skills/:slug/files` → `agents/<id>/skills/<slug>/`.

All paths are relative to the root. Traversal (`../…`) or absolute paths outside the root return
`400 Path escapes the root`. A missing file answers `404 { "error": "file not found" }`, a full disk
`507`. Below, `<base>` is any of the three prefixes.

### `GET <base>?path=<dir>`

List a directory (default `path=.`). Directories sort first.

```json
{ "entries": [ { "name": "notes", "type": "dir", "size": 96, "modifiedAt": "2026-06-02T..." }, { "name": "todo.md", "type": "file", "size": 7, "modifiedAt": "..." } ] }
```

### `GET <base>/read?path=<file>&offset=<characters>`

Read a text (UTF-8) file in pages of 100,000 characters. `offset` defaults to `0`; pass the returned `nextOffset` to continue.

```json
{ "path": "notes/todo.md", "content": "# hello", "offset": 0, "nextOffset": null, "totalChars": 7, "truncated": false }
```

### `GET <base>/raw?path=<file>`

Download raw bytes. `Content-Type` is guessed from the extension (fallback `application/octet-stream`), with `Content-Disposition: inline`. A `Range: bytes=…` header answers `206` with that slice (`416` when it is outside the file). Use this for images, PDFs, video and other binary files.

### `PUT <base>`

Write a text file (creates parent directories). Body:

```json
{ "path": "notes/todo.md", "content": "# hello" }
```

Returns `{ "path": "notes/todo.md", "bytes": 7 }` `201`.

### `POST <base>/raw`

Upload a binary file as `multipart/form-data` with a `file` field. The target path is `?path=<file>`, or `?dir=<dir>` to keep the uploaded filename (defaults to the filename at the root).

```bash
curl -X POST "$BASE/shared/files/raw?dir=images" -F file=@photo.png
```

Returns `{ "path": "images/photo.png", "bytes": 12345 }` `201`.

Holds the whole file in memory. Prefer `PUT <base>/raw` for anything large.

### `PUT <base>/raw`

Upload a binary file as the raw request body, piped straight to disk. The target path is `?path=<file>`, or `?dir=<dir>&name=<file>`. Pass `?size=<bytes>` to be refused early when the file is over the limit (`Content-Length` is a forbidden header for `fetch`, hence the query parameter). Files are capped at 100 MB.

```bash
curl -X PUT "$BASE/shared/files/raw?dir=images&name=photo.png" --data-binary @photo.png
```

Returns `{ "path": "images/photo.png", "bytes": 12345 }` `201`, `400` over the cap, `507` when the disk is full.

### `POST <base>/move`

Move or rename. Body `{ "from": "...", "to": "..." }`. Returns the same.

### `POST <base>/dir`

Create a directory. Body `{ "path": "..." }`. Returns `201`.

### `DELETE <base>?path=<entry>`

Delete a file or directory (recursive). Returns `{ "path": "..." }`.

```bash
# write to one agent's private workspace, then list it
curl -X PUT $B/agents/$AID/files -H 'content-type: application/json' -d '{"path":"report.md","content":"draft"}'
curl "$B/agents/$AID/files?path=."

# hand a file to every agent via the shared space
curl -X PUT $B/shared/files -H 'content-type: application/json' -d '{"path":"datasets/users.csv","content":"id,name\n1,ana"}'
curl "$B/shared/files/read?path=datasets/users.csv"
```

---

## Data

The SQL databases, with one router mounted under two prefixes:

- `/agents/:id/data` → the agent's own `data/agent.db` (the `db_*` tools).
- `/shared/data` → `shared-db/shared.db`, shared by every agent (the `shared_db_*` tools).

Every route below exists under both. The engine's bookkeeping tables (saved views, and in the shared
database the table of who created what) are hidden from them. A failed statement answers `400` with
the database's message.

### `GET <base>/tables`

```json
{ "tables": [ { "name": "leads", "columns": [ { "name": "id", "type": "INTEGER", "pk": true, "notnull": false } ] } ] }
```

### `POST <base>/query`

A read-only statement (anything that writes is refused). `limit` defaults to 100, max 1000.

```json
{ "sql": "SELECT * FROM leads WHERE city = ?", "params": ["Paris"], "limit": 100 }
```

```json
{ "columns": ["id", "name"], "rows": [{ "id": 1, "name": "Ana" }], "rowCount": 1, "truncated": false }
```

### `POST <base>/execute`

One statement (`sql` + `params`), or several in one batch (`statements: [{ sql, params }]`).
`ATTACH` is refused.

```json
{ "statements": 1, "rowsAffected": 3, "lastInsertRowid": "42" }
```

### `GET <base>/tables/:name/rows`

A page of rows: `limit` (default 50, max 500), `offset`, `sort` + `dir`, `q` (text search),
`columns` (comma-separated) and `where` (JSON array of `{ "column", "equals" }`).

```json
{ "columns": ["id", "name"], "rows": [{ "id": 1, "name": "Ana" }], "total": 120 }
```

### `GET <base>/tables/:name/groups?groupBy=<column>`

Row counts per value of a column (`groupBy` required), at most 50 groups, with an optional `sum`
column, and the same `where` and `q`: `{ "groups": [{ "value": "Paris", "total": 12, "sum": 3400 }] }`.

### `PATCH <base>/tables/:name/rows/:rowid`

`{ "values": { "status": "won" } }`. Answers `{ "row": { ... } }`.

### `DELETE <base>/tables/:name/rows`

`{ "rowids": [1, 2] }`. Answers `{ "deleted": 2 }`. `POST <base>/tables/:name/purge` empties the
table the same way.

### `DELETE <base>/tables/:name`

Drops the table and its saved views. `204`.

### `GET <base>/tables/:name/export?format=csv|json`

The whole table as a download (`csv` by default), with the same `sort`, `dir`, `q`, `where` and
`columns` as the rows route.

### `GET <base>/tables/:name/views` · `POST` · `PUT /views/:id` · `DELETE /views/:id`

Saved views of a table: a name (max 60 characters) and a layout (`table`, `list`, `gallery`,
`board`) with what it shows. The list answers `{ "views": [...] }`, a save `{ "view": { ... } }`
(`POST` creates, `400` when the name is taken; `PUT` updates by id), a delete `204`.

### `POST <base>/sources`

Which paid data calls the given rows came from, for a table built from `paid_data` answers. Body
`{ "rows": [ { ... } ] }`, at most 100 rows.

```json
{ "calls": { "c1": { "capability": "leads.search", "servedBy": "...", "at": "..." } }, "rows": [ { "sources": ["c1"], "cells": { "email": { "call": "c1", "field": "email" } } } ] }
```

---

## Brain

The company brain of the workspace: markdown pages in `brain/<slug>.md`, indexed in
`brain-db/brain.db`, with their revisions and the changes coworkers propose. The app is the only
caller and passes who acts as `author` / `decidedBy` (`seed`, `user:<id>` or `agent:<name>`). A
slug is lowercase kebab-case, at most 64 characters (`400` otherwise). `type` is one of `company`,
`offering`, `market`, `team`, `voice`, `stack`, `priorities` (the identity card, one page each) or
`customer`, `competitor`, `person`, `product`, `decision`, `note`.

### `GET /brain/pages`

`{ "pages": [ { "slug", "title", "type", "hash", "updatedAt", "updatedBy" } ] }`

### `GET /brain/pages/:slug`

```json
{
  "page": { "slug": "pricing", "title": "Pricing", "type": "offering", "hash": "...", "updatedAt": "...", "updatedBy": "user:...", "content": "...", "sources": [], "unconfirmed": [], "links": ["acme"], "backlinks": [{ "slug": "company", "title": "Company" }] },
  "revisions": [ { "id": "...", "slug": "pricing", "title": "Pricing", "hash": "...", "author": "user:...", "proposalId": null, "createdAt": "..." } ]
}
```

`unconfirmed` lists the headings of sections imported from the public web that nobody confirmed.
`404` for an unknown page.

### `PUT /brain/pages/:slug`

Create or edit a page. `baseHash` is `null` to create, and the `hash` the edit was made against
otherwise: `409` when the page moved since, or no longer exists.

```json
{ "title": "Pricing", "type": "offering", "content": "...", "sources": ["https://..."], "baseHash": "...", "author": "user:..." }
```

Answers the page, as `GET`. `content` is at most 60,000 characters.

### `DELETE /brain/pages/:slug`

`{ "ok": true }`, `404` for an unknown page.

### `GET /brain/pages/:slug/revisions/:rid`

`{ "revision": { ... }, "content": "..." }`, `404` for an unknown revision.

### `POST /brain/pages/:slug/revert/:rid`

`{ "author": "user:...", "expectedHash": "..." }` puts the page back to that revision; `409` when
`expectedHash` is given and the page moved since. Answers the page.

### `POST /brain/pages/:slug/confirm`

`{ "headings": ["Plans"] }` marks those imported sections as confirmed, `null` every section.
Answers the page.

### `GET /brain/proposals` · `GET /brain/proposals/count`

The changes coworkers proposed with `brain_propose`, optionally `?status=proposed|accepted|dismissed`,
and the count of open ones (`{ "count": 2 }`).

```json
{ "proposals": [ { "id": "...", "agentId": "...", "agentName": "scout", "sessionId": "...", "slug": "acme", "mode": "edit", "title": "Acme", "headline": "Acme moved to Lyon", "highlights": [{ "label": "City", "before": "Paris", "after": "Lyon" }], "type": "customer", "content": "...", "reason": "...", "sources": [], "baseHash": "...", "status": "proposed", "outdated": false, "currentContent": "...", "createdAt": "...", "decidedAt": null, "decidedBy": null } ] }
```

`outdated` is true when the page moved since the coworker read it.

### `POST /brain/proposals/:pid/accept` · `POST /brain/proposals/:pid/dismiss`

`{ "decidedBy": "user:..." }`; an accept may also carry the `content`, `title` and `type` the person
retouched. Both answer `{ "proposal": { ... } }`, `404` for an unknown proposal.

### `POST /brain/seed`

`{ "pages": [ { "slug", "title", "type", "content", "sources" } ] }`, at most 100 pages: writes
each page the seed still owns and leaves the ones a person or a coworker wrote since.
`{ "written": ["company"], "skipped": ["pricing"] }`.

---

## Schedules

Scheduled tasks are markdown files (`agents/<id>/schedules/<slug>.md`) scanned from disk by the in-process scheduler every 30 seconds. A task is either **recurring** (`cron`) or **one-shot** (`runAt`). When due, the engine starts a fresh session and runs the task `body` as the agent's instruction, no user message needed. Each fire is recorded in the `runs` table like any other run, and its completion is pushed to the app (see [Notifications](#notifications)).

### `GET /agents/:id/schedules`

```json
{ "schedules": [ { "slug": "daily-digest", "name": "Daily digest", "description": "...", "enabled": true, "cron": "0 8 * * *", "runAt": null, "timezone": "Europe/Paris", "lastRunAt": null, "connectionId": "abc...", "provider": "openrouter", "model": "...", "body": "Summarize yesterday's notes.", "createdAt": "..." } ] }
```

### `POST /agents/:id/schedules`

Provide exactly one of `cron` or `runAt`. The slug is derived from the name.

```json
{ "name": "Daily digest", "description": "Morning summary", "body": "Summarize yesterday's notes and email me.", "cron": "0 8 * * *", "timezone": "Europe/Paris", "provider": "openrouter", "model": "..." }
```

One-shot:

```json
{ "name": "Reminder", "body": "Ping me about the meeting.", "runAt": "2026-06-03T15:00:00Z" }
```

Returns the created schedule `201`. `400` for an invalid cron, `runAt` or time zone.

### `GET /agents/:id/schedules/:slug`

Return one schedule. `404` if unknown.

### `PATCH /agents/:id/schedules/:slug`

Update a schedule. Body: any subset of `{ "name"?, "description"?, "body"?, "cron"?, "runAt"?, "timezone"?, "enabled"?, "connectionId"?, "provider"?, "model"? }`. Set `"enabled": false` to pause it without deleting. A new `name` (max 120 characters) is written into the file; the slug does not change.

`model: null` means "whatever the agent runs", which is itself the engine default when the agent picked nothing: the routine follows instead of freezing today's pair. It is what a schedule created without a model gets.

An automation that does pin a pair keeps it. When that pair stops being runnable (the credential was removed, or the model was switched off on the connection) the engine falls back rather than failing: the agent's own model, then the engine default, then the keyless `rerun` connection, then the first connection that can serve something. The substitution is logged as a warning, because it changes both the bill and the answer.

### `POST /agents/:id/schedules/:slug/run`

Fires the schedule now, in a fresh session, without touching `lastRunAt`: `202 { "runId", "sessionId" }`.
A manual run is a deliberate probe: it may clear a paused credit or subscription limit, or show
the failure again. `409` while the agent's guided setup is pending and the schedule is still off.

### `DELETE /agents/:id/schedules/:slug`

```json
{ "deleted": "daily-digest" }
```

Agents can also manage their own schedules at runtime with the `schedule_*` tools (gated by `config.tools.schedule`).

---

## Triggers

Triggers are the event-driven counterpart of schedules: markdown files (`agents/<id>/triggers/<slug>.md`) that expose a public URL. When an external service calls it, the engine starts a fresh session and runs the trigger `body` with the caller's payload attached below it.

The URL is served by the Rerun app, not by the engine: `<app URL>/api/t/<app agent id>/<slug>/<token>`. The app resolves the agent and forwards the payload to `POST /agents/:id/triggers/:slug/fire` with the engine's API key. So an engine with no app can define triggers, but only the app can hand out their URLs.

An agent archive carries its triggers with an empty token, and the engine that imports it mints new ones: the token of a live URL never travels into every install of a published template.

### `GET /agents/:id/triggers`

```json
{ "triggers": [ { "slug": "github-push", "name": "GitHub push", "description": "...", "enabled": true, "token": "...", "methods": ["POST"], "lastFiredAt": null, "fireCount": 0, "connectionId": "abc...", "provider": "openrouter", "model": "...", "body": "Review the incoming commit.", "createdAt": "..." } ] }
```

### `POST /agents/:id/triggers`

The slug is derived from the name and never changes afterwards, since the public URL is built from it. `methods` defaults to `["POST"]`.

```json
{ "name": "GitHub push", "description": "On main", "body": "Review the incoming commit.", "methods": ["POST"], "provider": "openrouter", "model": "..." }
```

Returns the created trigger `201`, token included.

### `GET /agents/:id/triggers/:slug` · `PATCH` · `DELETE`

Same shape as schedules, including the connection fallback. `PATCH` takes any subset of `{ "description"?, "body"?, "methods"?, "enabled"?, "connectionId"?, "provider"?, "model"? }`, never the name.

### `POST /agents/:id/triggers/:slug/rotate`

Issue a new token, which changes the public URL. Every service still calling the old one stops working.

### `POST /agents/:id/triggers/:slug/fire`

Called by the Rerun app on behalf of an anonymous caller, never by a user directly.

```json
{ "token": "...", "method": "POST", "query": "source=zapier", "contentType": "application/json", "body": "{\"ref\":\"refs/heads/main\"}", "bodyBytes": 25 }
```

Returns `202 { "runId": "...", "sessionId": "...", "triggerSlug": "..." }`.

Every rejection answers **`404`** (unknown slug, unsafe slug, wrong token, disabled trigger) so an anonymous caller cannot probe which triggers exist. The one exception is a verb the trigger does not accept, which answers **`405`** with the allowed list. The token is compared in constant time, and the payload is truncated at 64 KB before it reaches the model.

Agents can manage their own triggers at runtime with the `trigger_*` tools (gated by `config.tools.trigger`). `trigger_get` is the only one that returns the URL.

---

## Runs

Every execution (chat, scheduled fire, trigger, a call from another coworker) is recorded in the
agent's `runs` table, with each model step in `run_steps` and each tool call in `tool_calls`.

`status` is `running`, `done`, `error` or `cancelled`. A run cut by a restart is closed `error`
(`interrupted: engine restarted`) at the next boot.

### `GET /agents/:id/runs`

List runs for an agent, newest first. `?limit=` (default `50`, max `200`), `?session=<sid>`,
`?status=<status>`.

```json
{ "runs": [ { "id": "...", "agentId": "abc...", "sessionId": "...", "status": "done", "stepCount": 4, "usageJson": "{\"inputTokens\":1200,\"outputTokens\":340}", "provider": "anthropic", "model": "claude-sonnet-4-6", "triggerSource": "schedule", "triggerSlug": "daily-digest", "costMicros": 1830, "inputTokens": 1200, "outputTokens": 340, "cachedInputTokens": 0, "reasoningTokens": 0, "totalTokens": 1540, "startedAt": "...", "finishedAt": "...", "error": null } ] }
```

### `GET /agents/:id/runs/:rid`

One run plus its final assistant `output` (the text produced during the run, from the session
transcript). `404` if the run is unknown or belongs to another agent.

To see the full transcript (tool calls included), use the run's `sessionId` with
`GET /agents/:id/sessions/:sid/messages`.

### `GET /agents/:id/runs/:rid/stream`

Joins the live stream of a run in flight, in the same format as `POST /chat`, with a keepalive
comment line while it waits. `204` when the run is over or unknown.

### `GET /agents/:id/runs/:rid/steps`

`{ "steps": [...] }`, one per model step in order: `stepNumber`, `provider`, `model`,
`finishReason`, the token counts, `costMicros`, `toolCallCount`, `textLength`, `durationMs`.

### `GET /agents/:id/runs/:rid/tools`

`{ "tools": [...] }`, one per tool call in order: `stepNumber`, `toolCallId`, `toolName`,
`inputJson`, `resultJson`, `isError`, `durationMs`.

### `POST /agents/:id/runs/:rid/cancel`

Stops the run. `{ "ok": true, "aborted": true }`, `aborted` false when no live loop held it (a row
left over from a restart): the row is closed `cancelled` anyway and the app is told, so the
conversation does not stay "working".

### `POST /agents/:id/runs/:rid/tasks/:taskId/cancel`

Stops one sub-agent of a `delegate_tasks` call, by the task id the stream announced; the run
carries on. `{ "ok": true, "aborted": true }`.

---

## Usage and stats

### `GET /agents/:id/usage?range=24h|7d|30d|all`

Token and cost totals of the agent's `done` runs, per day and model (`range` defaults to `7d`).

```json
{ "buckets": [ { "day": "2026-11-15", "model": "claude-sonnet-4-6", "inputTokens": 12000, "outputTokens": 3400, "cachedInputTokens": 0, "reasoningTokens": 0, "totalTokens": 15400, "costMicros": 18300, "runCount": 7 } ] }
```

### `GET /agents/:id/stats`

A time series for a chart. `dataset` and `metric` are required, `groupBy` defaults to `none`,
`range` to `7d` (`24h`, `7d`, `30d`, `90d`, `all`; hourly buckets on `24h`, daily otherwise).

| `dataset` | `metric` | `groupBy` |
| --- | --- | --- |
| `runs` | `count`, `totalTokens`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `reasoningTokens`, `cost`, `avgDurationMs`, `errorCount`, `errorRate` | `model`, `status`, `triggerSource` |
| `runSteps` | `count`, `totalTokens`, `inputTokens`, `outputTokens`, `avgDurationMs` | `model`, `finishReason`, `stepNumber` |
| `toolCalls` | `count`, `errorCount`, `errorRate`, `avgDurationMs` | `toolName` |
| `sessions` | `count` | `source`, `status` |

`runs` also takes `status` (`all`, `done`, `error`, `cancelled`, `running`). Any other combination
answers `400 { "error": "invalid stats query" }`.

```json
{ "points": [ { "bucket": "2026-11-15", "group": "claude-sonnet-4-6", "value": 15400, "count": 7 } ] }
```

---

## Notifications

The engine pushes lifecycle events to the app it is linked to, at `POST $RERUN_HUB_BASE_URL/api/webhooks/engine`, authenticated with its own `RERUN_API_KEY`. There is no per-schedule webhook URL: everything goes to the app, which decides what to email or show. If either variable is unset nothing is sent.

Events (`src/runtime/notify.ts`):

- `agent.message.completed`: an interactive run finished, failed or was stopped, or a coworker called through `call_agent` answered.
- `agent.schedule.completed`: a scheduled run finished, failed or was stopped.
- `agent.trigger.completed`: a webhook-triggered run finished, failed or was stopped.
- `agent.session.created`: a session was opened by a schedule, a trigger or another coworker.
- `agent.notification`: the agent needs the user: it called `notify_user`, a human-in-the-loop tool paused the run, or it proposed a skill.
- `agent.schedule.created` · `agent.trigger.created`: an automation now exists, whoever made it.
- `box.connection.connected`: a connection got its credential.
- `box.vault.signed_out`: a Vault item lost its sign-in: its token was refused or expired with nothing to refresh it.

Payload (`content-type: application/json`):

```json
{
  "event": "agent.trigger.completed",
  "kind": "done",
  "agentId": "abc...",
  "sessionId": "...",
  "runId": "...",
  "message": "Trigger \"GitHub push\" completed",
  "metadata": { "source": "trigger", "status": "done", "triggerSlug": "github-push", "sourceName": "GitHub push", "stepCount": 4, "usage": {}, "provider": "anthropic", "model": "claude-sonnet-4-6", "costMicros": 0, "finalText": "..." },
  "title": null,
  "source": "trigger",
  "originAgentId": null,
  "timestamp": "..."
}
```

`kind` is one of `info` | `question` | `approval` | `connector` | `done` | `error`. The run events
carry `done` or `error`; `metadata.status` is `cancelled` for a run that was stopped, and
`metadata.error` holds the message of a failure. `agentId` is `null` for the engine-wide events
(`box.*`), and `sessionId` / `runId` / `metadata` may be `null`. Delivery is best-effort with a 5 s
timeout: a non-2xx response or a network error is logged and never affects the run. The app
validates `event` against a closed list, so adding one here means updating the app first.

### Agent notifications (`notify_user`)

An agent can notify its user out-of-band by calling the `notify_user` tool (the `notify` tool family, enabled by default). This is for something the user must see while they may not be watching the conversation: a result to review, a risk, a decision. The tool does **not** pause the run: it only delivers a message, then the agent keeps going. The end of a run and its errors are notified on their own, and questions go through `ask_user`.

```json
{
  "event": "agent.notification",
  "kind": "info",
  "agentId": "abc...",
  "sessionId": "...",
  "runId": "...",
  "message": "The supplier changed its prices: three quotes are now wrong.",
  "metadata": null,
  "timestamp": "..."
}
```

`notify_user` always sends `kind: "info"`, the one kind that outlives the run: the app flags the
conversation as needing an acknowledgement, and it stays flagged after the run completes until the
user marks it as read or sends the next message. The human-in-the-loop tools send `question`
(`ask_user`), `connector` (`suggest_service`, `request_secret`, `request_mcp_sign_in`) or `approval`
(`request_approval`, `request_takeover`, `request_spend`, and a skill proposal), with the tool's
`toolCallId`, `toolName` and `input` in `metadata`. When the tool is called with nothing configured,
it tells the agent the notification was not delivered.

---

## Vault

The workspace's shared accounts and keys. An item is signed in to (or filled in) once and attached to the
coworkers that use it, one by one or all at once with `sharedWithAll`. It lives in
`vault/<id>/`: `item.json` (what it is and who holds it), `.env` (its secrets, chmod 600) and
`tokens/<server>.json` (its OAuth tokens). Nothing of the Vault is copied into a coworker's folder
but the skills of the items it holds, which the engine writes into `skills/` and keeps in step.

At run time a coworker gets the MCP servers of its items before its own (an item wins over one of
its own servers of the same name), and their variables in its shell. A `${VAR}` in an item's server
resolves against that item's `.env` only, never another item's nor the coworker's. The Chief of
Staff holds no item; a delegate draws on the coworker it works for.

`GET /health` lists `vault` in `capabilities`. Every read answers names, never a value: `envKeys`
are the variables an item holds, `tokens` the servers holding an OAuth token.

Kinds: `service` (a catalog app, `slug` set), `mcp` (a custom MCP server), `secret` (variables only).
Statuses: `active`, `needs_auth`, `needs_config`.

### `GET /vault`

`?agent=<id>` narrows the list to the items that coworker draws on, its own and the shared ones.

```json
{
  "items": [
    {
      "id": "v1x...",
      "kind": "service",
      "slug": "linear",
      "name": "Linear",
      "label": "ops@acme.test",
      "status": "active",
      "config": {},
      "mcpServers": [{ "name": "linear", "transport": "http", "url": "https://mcp.linear.app/mcp", "args": [], "env": {}, "headers": {} }],
      "skills": [{ "slug": "linear-usage", "name": "Linear", "description": "", "body": "..." }],
      "oauth": { "serverName": "linear", "url": "https://mcp.linear.app/mcp" },
      "agentIds": ["abc..."],
      "sharedWithAll": false,
      "createdBy": "user-uuid",
      "createdAt": "...",
      "updatedAt": "...",
      "envKeys": [],
      "tokens": ["linear"]
    }
  ]
}
```

### `POST /vault`

Create an item. `env` holds its secrets and is never returned. `agentIds` must name coworkers of the
engine. A paid app (`app` set) is never `sharedWithAll` (400).

```json
{ "kind": "secret", "name": "Stripe live key", "env": { "STRIPE_API_KEY": "sk_live_..." }, "agentIds": ["abc..."] }
```

Response `201`: the item, as in the list.

### `GET /vault/:id`

One item, as in the list. `404` when it does not exist.

### `PATCH /vault/:id`

Change anything but the kind, the attachments and the secrets: `slug`, `name`, `label`, `status`,
`authMethodId`, `config`, `mcpServers`, `skills`, `oauth`, `managed`, `composio`, `app`,
`sharedWithAll`. `null` removes an optional field. Answers the item.

### `PATCH /vault/:id/env`

`{ "set": { "KEY": "value" }, "remove": ["OTHER"] }`. Answers the names the item now holds:
`{ "keys": ["KEY"] }`.

### `PUT /vault/:id/agents/:agentId` · `DELETE /vault/:id/agents/:agentId`

Attach the item to a coworker, or detach it. Both answer the item and are idempotent.

### `PUT /vault/:id/tokens/:server` · `DELETE /vault/:id/tokens/:server`

Store the OAuth token of one of the item's servers (same body as `PUT /agents/:id/mcp/:name/token`),
or forget it. A token the server refuses to refresh puts the item back to `needs_auth` and sends
`box.vault.signed_out` to the app.

### `GET /vault/:id/usage`

The coworkers that lose the item if it goes, for the UI to name them before a delete:
`{ "agentIds": ["abc..."] }`. For an item shared with everyone, every coworker of the engine.

### `DELETE /vault/:id`

Delete the item, its secrets and its tokens: `{ "deleted": "v1x...", "detached": ["abc..."] }`.

### Conflicts

A coworker never holds two items that set the same variable, carry a server under the same name or
a skill under the same slug: it would get one of them at random. A create, a change, an attachment
or a share that would do it answers `409`, naming each clash (`"*"` for two items shared with
everyone, which clash on every coworker, present and future):

```json
{
  "error": "This coworker already gets the variable LINEAR_API_KEY from another item of the Vault",
  "conflicts": [{ "agentId": "abc...", "itemId": "v2y...", "kind": "env", "name": "LINEAR_API_KEY" }]
}
```

### Archives and duplicates

`GET /agents/:id/archive` carries what a coworker holds from the Vault as its own (see
[the archive](#get-agentsidarchive)). `POST /agents/:id/duplicate` attaches the copy to every item
the source was attached to. `DELETE /agents/:id` detaches the coworker from every item.

---

## Quick smoke test

```bash
B=http://localhost:3000
# 1. a connection holding the provider key, then an agent on it
CID=$(curl -s -X POST $B/connections -H 'content-type: application/json' -d '{
  "name": "Anthropic", "provider": "anthropic", "models": ["claude-sonnet-4-6"],
  "keys": { "ANTHROPIC_API_KEY": "sk-ant-..." }
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
AID=$(curl -s -X POST $B/agents -H 'content-type: application/json' -d '{
  "config": { "name": "Scout", "connectionId": "'$CID'", "provider": "anthropic", "model": "claude-sonnet-4-6" },
  "soul": "You are Scout, concise. Use your tools when asked."
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 2. stream a chat that runs a tool
curl -N -X POST $B/agents/$AID/chat -H 'content-type: application/json' \
  -d '{"message":"Create notes.txt in your workspace with the text hello, then confirm."}'

# 3. memory + skills
curl -s -X POST $B/agents/$AID/memories -H 'content-type: application/json' -d '{"content":"User likes short answers.","kind":"preference"}'
curl -s -X POST $B/agents/$AID/memories/recall -H 'content-type: application/json' -d '{"query":"answer length"}'
curl -s $B/agents/$AID/skills
```
