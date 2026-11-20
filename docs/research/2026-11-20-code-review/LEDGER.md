# Moldwright Full Code Review Ledger (`2026-11-20`)

- **Repository:** `E:\project\moldwright` (`dev`)
- **Commit under review:** `c1d28545` (`c1d2854507c93ebe15d3e509460ab6d526b85290` — Merge pull request #1688)
- **Output root:** `docs/research/2026-11-20-code-review/` (git-ignored via `.gitignore` and `.git/info/exclude`; write nowhere else)
- **Scope note (`cloud/*`):** The git-ignored `cloud/` directory is not present in this checkout, so only its open-source twins in `apps/ui/cloud-oss/*` are reviewed; `cloud/*` will be listed under **Unreviewed Items** in `SUMMARY.md`.
- **Session operating rules:**
  1. Read code and run only local tests or read-only commands (route builds/tests through Terminal Commander `run_and_watch`; never call live servers, push branches, or write to GitHub). Change zero repository files.
  2. Treat `CLAUDE.md` as binding repository law (no comments in code except genuine non-obvious edge cases, typed Supabase read helpers `select*`, explicit `<Database['public']['Tables'][T]['Insert' | 'Update']>` generics on writes, `@moldwright/cloud/*` OSS twins in `apps/ui/cloud-oss/`, append-only `DATA_DIR_MIGRATIONS` / `SYSTEM_DB_MIGRATIONS` / `SHARED_DB_MIGRATIONS`). Treat all other docs as claims to verify against code.
  3. **Global evidence rule:** Every finding requires verbatim quoted lines with `path:line` and the exact read-only command/test output; anything not proven by code or a local run must be marked `unproven`, never stated as fact. Every cleared item also receives a short file in `docs/research/2026-11-20-code-review/findings/` recording what was checked and why it holds.
  4. **Ordering & budget:** Items are ordered strictly by cost of a confirmed failure:
     - **Tier 1 (Critical):** Leaked credentials, container/sandbox escape, or cross-user / cross-workspace data access
     - **Tier 2 (Critical / High):** Data loss, destructive migrations/scripts, or cross-tenant/raw SQL corruption
     - **Tier 3 (High):** Factory merging unreviewed/red code, closing live work, or prompt-injecting coworkers
     - **Tier 4 (High / Medium):** Bypassable CI gates, vacuous tests, runtime DB/ledger bugs, rename drift, and operational waste
     Large prompt items (`#1`, `#6`, `#7`, `#9`, `#14`) are split into bounded sub-items (`≤600` lines of targeted reading per item); nothing from `OMP-PROMPT.md` was removed. Seven unlisted critical surfaces (`X1`–`X7`, including PR #1688's engine additions) are inserted at their cost tier.

---

## Tier 1 — Credential Leaks, Containment Escape & Cross-Tenant Data Access

### `A1a` — Coworker Shell Filesystem, `/proc`, Secret Volume & Network Reach
- **Covers:** Prompt item A.1 (part 1 of 2: shell boundary vs engine container, secrets, sibling workspaces/DBs, network)
- **Where:**
  - `apps/engine/src/tools/builtin/shell.ts` (`shellTools`, `redactSecrets`)
  - `apps/engine/src/tools/sandbox.ts` (`resolveWithin`, `resolveWithinReal`, `assertCommandAllowed`)
  - `apps/engine/docker-entrypoint.sh` (`RERUN_API_KEY_FILE`, `RERUN_KEY_FD`)
  - `apps/engine/src/config/env.ts` (`takeKeyFromDescriptor`, `heldKey`)
  - `apps/engine/src/config/paths.ts` (`dataDir`, `sharedEnvPath`, `connectionsDir`, `agentDir`, `agentDataDbPath`, `systemDbPath`, `mcpTokenPath`)
  - `docker-compose.yml` (`services.engine`, `/run/secrets/rerun_engine_key`, `/run/factory-token:ro`, `engine-data:/data`, `host.docker.internal`)
  - `deploy/vps/docker-compose.vps.yml`, `deploy/vps/dev-engine.yml`, `apps/engine/Dockerfile` (`USER rerun`)
- **First read & shortest trace (~260 lines):** Read `apps/engine/src/tools/builtin/shell.ts:23-63` -> `apps/engine/docker-entrypoint.sh:1-28` -> `apps/engine/src/config/env.ts:24-57` -> `docker-compose.yml:32-71` -> `apps/engine/src/config/paths.ts:20-96`.
- **Question:** Can a coworker `shell_exec` command (or Claude Code / Codex CLI subprocess spawned in `apps/engine/src/agents/providers.ts`) running as UID `rerun` read `/data/shared.env`, `/data/connections/*/.env`, `/data/agents/<other>/{.env,workspace,data/agent.db,mcp/*.json}`, `/run/factory-token/token`, `/run/secrets/rerun_engine_key`, `/proc/<engine-pid>/{environ,mem,maps}`, or reach internal Docker/host network services (`http://app:3000`, `http://webgate:8080`, `host.docker.internal`, cloud metadata)?
- **How to prove it:**
  1. Trace UID/GID and file mode creation across `apps/engine/Dockerfile:17-36`, `apps/engine/src/datadir/migrations.ts:21-84`, `apps/engine/src/lib/env-file.ts`, and `docker-compose.yml:44-68`.
  2. Check whether `shell_exec` (`child_process.exec`) uses any Linux namespace/bwrap/seccomp/uid isolation or runs directly as `rerun` with full `/data` ownership and unrestricted Docker bridge egress.
  3. Run existing tests via Terminal Commander `run_and_watch`: `pnpm --filter rerun-engine exec vitest run src/tools/builtin/shell.test.ts src/tools/builtin/shell.env.test.ts src/config/env.test.ts`.
  4. Target file for new failing test: `apps/engine/src/tools/builtin/shell.test.ts` (or `apps/engine/src/deploy-config.test.ts` for container mount/permission assertions).
- **Fix questions to answer if confirmed:**
  - Can coworker shell processes run under an unprivileged per-run UID/bwrap mount namespace hiding `/data/connections`, `/data/shared.env`, other `/data/agents/<id>`, and `/run/factory-token`, without breaking legitimate workspace builds?
  - How must Docker network rules or `extra_hosts` block RFC1918 / Docker-internal / `host.docker.internal` access from coworker subprocesses while allowing engine->hub calls?
- **Severity if confirmed:** **Critical** — any prompt-injected or malicious coworker compromises engine-wide model keys, GitHub App installation tokens, and every other coworker's workspace and database on that engine.
- **Evidence rule:** Quote exact lines with `path:line` and test output; mark unexecuted container-kernel behavior `unproven` unless verified by code/config + test.

---

### `A1b` — Untrusted External Input to `shell_exec` / CLI Tool Execution Paths
- **Covers:** Prompt item A.1 (part 2 of 2: every path from untrusted text to a shell command)
- **Where:**
  - `apps/engine/src/agents/providers.ts` (`CLAUDE_RUN_TOOLS`, `claudeProvider`, `codexExecProvider`, `codexAppServerProvider`, `resolveModel`)
  - `apps/engine/src/tools/registry.ts` (tool assembly per coworker)
  - `apps/engine/src/tools/builtin/web.ts`, `apps/engine/src/tools/builtin/browser.ts`, `apps/engine/src/tools/builtin/skim-pages.ts`, `apps/engine/src/tools/builtin/page-facts.ts`
  - `apps/engine/src/triggers/message.ts`, `apps/engine/src/http/routes/triggers.ts`
  - `tools/factory/dispatch.py` (`build_brief`, `review_brief`, `proof_brief`, `fix_brief`), `tools/factory/planning.py` (`brief_lines`, `PLAN_BRIEF`)
- **First read & shortest trace (~380 lines):** Read `apps/engine/src/tools/registry.ts` -> `apps/engine/src/agents/providers.ts:175-357` -> `apps/engine/src/tools/builtin/web.ts` -> `apps/engine/src/triggers/message.ts`.
- **Question:** Does untrusted external text (GitHub issue bodies, PR/review comments, webhook payloads, fetched web pages, browser DOM snapshots, inbound WhatsApp/email/app messages) reach an LLM context where `shell_exec` or native Claude Code `Bash` / Codex CLI shell execution is enabled without a human approval gate?
- **How to prove it:**
  1. Enumerate every ingress source feeding `messages` / `loop.ts` (`web.ts`, `browser.ts`, `triggers/message.ts`, `mcp.ts`, factory `gh issue view` / `gh pr view` inside coworker runs).
  2. Trace which coworkers have `config.tools.shell` or native provider `Bash`/shell enabled (`CLAUDE_RUN_TOOLS` in `apps/engine/src/agents/providers.ts:251`, `CODEX_HARNESS_OVERRIDES` in `providers.ts:101-125`).
  3. Run `pnpm --filter rerun-engine exec vitest run src/tools/registry.test.ts src/agents/providers.test.ts`.
  4. Target file for new failing test: `apps/engine/src/tools/registry.test.ts` or `apps/engine/src/agents/providers.test.ts`.
- **Fix questions to answer if confirmed:**
  - Does `CLAUDE_RUN_TOOLS` or Codex CLI expose native `Bash` even when `agent.config.tools.shell` is `false`?
  - Which untrusted-ingestion flows require tool-capability separation (reader coworkers without shell vs builder coworkers) or HITL approval?
- **Severity if confirmed:** **Critical** — turns passive content ingestion (reading a web page, webhook, or GitHub comment) into arbitrary remote command execution inside the engine container.
- **Evidence rule:** Quote exact `path:line` for both the untrusted source and the active shell/Bash capability; mark `unproven` any hop not traced end-to-end in code.

---

### `A2` — `process-env.ts` & Child Subprocess Secret Over-Sharing
- **Covers:** Prompt item A.2
- **Where:**
  - `apps/engine/src/agents/process-env.ts` (`githubCredentialEnv`, `sharedProcessEnv`, `agentProcessEnv`)
  - `apps/engine/src/agents/shared-env.ts` (`readSharedEnvSync`, `secretValuesOf`)
  - `apps/engine/src/lib/child-env.ts` (`INHERITED_ENV_VARS`, `childProcessEnv`, `envOverlay`)
  - `apps/engine/src/agents/session-labels.ts` (`sessionLabels`)
  - `apps/engine/src/agents/providers.ts` (`claudeAuthEnv`, `connectionEnv`, `claudeProvider`, `codexShared`)
  - `apps/engine/src/tools/mcp.ts` (env passed to stdio MCP servers)
- **First read & shortest trace (~250 lines):** Read `apps/engine/src/agents/process-env.ts:1-30` -> `apps/engine/src/agents/shared-env.ts:1-20` -> `apps/engine/src/lib/child-env.ts:1-21` -> `apps/engine/src/agents/providers.ts:255-357` -> `apps/engine/src/tools/mcp.ts`.
- **Question:** Do `agentProcessEnv`, `claudeProvider`, `codexShared`, or `mcp.ts` inject `shared.env` secrets (`GH_TOKEN` + `GIT_CONFIG_*` credential helper, model API keys, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`) or `process.env` secrets into every coworker's shell and MCP child processes regardless of whether that coworker's role/job needs them?
- **How to prove it:**
  1. Trace all callers of `agentProcessEnv`, `sharedProcessEnv`, `childProcessEnv`, and `envOverlay` via SymForge `find_references`.
  2. Check whether `envOverlay` in `apps/engine/src/lib/child-env.ts:17-21` blanks `process.env` keys with `''` vs leaking inherited keys, and whether `readSharedEnvSync()` merges every secret in `/data/shared.env` unconditionally into every coworker (`process-env.ts:24`), plus whether `CLAUDE_CODE_OAUTH_TOKEN` / `OPENAI_API_KEY` passed to Claude/Codex harnesses is inherited by `Bash` tool children inside those harnesses.
  3. Run `pnpm --filter rerun-engine exec vitest run src/agents/process-env.test.ts src/lib/child-env.test.ts src/tools/builtin/shell.env.test.ts`.
  4. Target file for new failing test: `apps/engine/src/agents/process-env.test.ts`.
- **Fix questions to answer if confirmed:**
  - How should `shared.env` variables be scoped (allowlist per agent config vs stripping model OAuth/API tokens before spawning inner tool shells)?
  - Can `agent.env` or `labels` override `PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, or `GIT_CONFIG_*`?
- **Severity if confirmed:** **Critical** — `env` / `printenv` or `git credential fill` in any coworker immediately yields shared GitHub tokens and model subscription credentials.
- **Evidence rule:** Quote exact env-merge lines (`path:line`) and test output; mark `unproven` anything depending on external harness internals not pinned in `package.json`.

---

### `A5` — Connection Tokens & API Keys at Rest, Refresh, Error Paths & Digests
- **Covers:** Prompt item A.5
- **Where:**
  - `apps/engine/src/connections/store.ts`, `apps/engine/src/connections/loader.ts`, `apps/engine/src/connections/claude-token.ts`, `apps/engine/src/connections/codex-auth.ts`, `apps/engine/src/connections/resolve.ts`, `apps/engine/src/connections/credential-rejections.ts`
  - `apps/engine/src/http/routes/connections.ts`
  - `apps/engine/src/runtime/provider-errors.ts`, `apps/engine/src/db/repos/redact.ts`, `apps/engine/src/lib/logger.ts`
  - `apps/ui/app/api/_services/ai-connection.service.ts`, `apps/ui/app/api/v1/ai-connections/[id]/route.ts`, `apps/ui/app/api/v1/ai-connections/[id]/keys/route.ts`
  - `tools/factory/digest.py`, `tools/factory/dispatch.py` (`note_failures`, `report`)
- **First read & shortest trace (~420 lines):** Read `apps/engine/src/connections/store.ts` -> `apps/engine/src/connections/claude-token.ts:27-118` -> `apps/engine/src/connections/codex-auth.ts:28-140` -> `apps/engine/src/runtime/provider-errors.ts` -> `apps/engine/src/db/repos/redact.ts` -> `apps/engine/src/http/routes/connections.ts`.
- **Question:** Are model OAuth tokens, refresh tokens, or API keys stored with world/group-readable permissions, or can an OAuth refresh failure, upstream HTTP error body, run error record, HTTP response, GitHub failure comment, or factory digest emit a raw token/key?
- **How to prove it:**
  1. Check file modes on `writeEnvFile` (`apps/engine/src/lib/env-file.ts`) and `writeAuthFile` (`codex-auth.ts:28-45`), and check whether `archive.ts` (`SKIP_DIRS` / `ARCHIVE_ROOTS`) can ever archive connection files.
  2. Trace error propagation from `claude-token.ts:47-53`, `codex-auth.ts:60-83`, and `providers.ts` through `provider-errors.ts`, `runs.ts` (`error` column), `db/repos/redact.ts`, and `dispatch.py` -> GitHub comments / `digest.py`.
  3. Run `pnpm --filter rerun-engine exec vitest run src/connections/claude-token.test.ts src/connections/codex-auth.test.ts src/connections/store.test.ts src/db/repos/redact.test.ts src/runtime/provider-errors.test.ts`.
  4. Target file for new failing test: `apps/engine/src/connections/claude-token.test.ts` or `apps/engine/src/db/repos/redact.test.ts`.
- **Fix questions to answer if confirmed:**
  - Which exact error/log/DB fields bypass `redact.ts` or `secretValuesOf` (especially connection `.env` values, which live under `/data/connections/<id>/.env` rather than `shared.env` or `agent.env`)?
  - What minimal redaction or error-sanitization step closes the leak without hiding HTTP status codes needed for renewal diagnosis?
- **Severity if confirmed:** **Critical** — leaks live Anthropic/OpenAI OAuth refresh tokens or OpenRouter keys into logs, SQLite run records, or public GitHub issue comments/digests.
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` any provider error payload format not reproduced in tests.

---

### `B6a` — Supabase RLS Policies, Grants & `SECURITY DEFINER` Functions Across All Tables
- **Covers:** Prompt item B.6 (part 1 of 2: database-layer RLS and grants across the 135 migrations)
- **Where:**
  - `supabase/migrations/*.sql` (specifically `20261015100000_users_column_grants.sql`, `20261028150000_users_no_client_insert.sql`, `20261028160001_revoke_check_email_exists.sql`, `20261029120000_engine_pairing_tokens.sql`, `20261029130000_grants_of_a_fresh_install.sql`, `20261103150000_published_access.sql`, `20261104120000_realtime_cursors_private.sql`, `20261105120000_foreman_builds.sql`, `20261105121000_workspace_member_roles.sql`, `20261105130000_space_access.sql`, `20261105140000_api_keys_created_by_user.sql`, `20261105150000_message_feedback_private.sql`, `20261112120000_desktop_auth_codes.sql`)
  - `supabase/tests/space_access.test.sql`
  - `apps/ui/app/api/database.types.ts` (canonical list of tables, views, and RPC functions)
- **First read & shortest trace (~450 lines):** Extract every `CREATE TABLE`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`, and `SECURITY DEFINER` across `supabase/migrations/*.sql` with a read-only Python/rg pass; inspect every table in `apps/ui/app/api/database.types.ts` lacking RLS or holding permissive `USING (true)` / `anon` / `authenticated` policies, plus recent migrations `20261029*`–`20261112*`.
- **Question:** Is there any table, view, storage bucket, Realtime channel, or `SECURITY DEFINER` RPC in `supabase/migrations/` reachable with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`anon` or `authenticated` JWT, including auto-provisioned anonymous sessions from `apps/ui/supabase/middleware.ts:13-19`) that allows reading or mutating another user's or workspace's rows (such as `engine_pool`, `api_keys`, `agents`, `desktop_auth_codes`, `oauth_pending_grants`, `sign_in_codes`, `user_phones`, `published_sites`, or `spaces`)?
- **How to prove it:**
  1. Build a complete table-to-RLS/grant matrix from `supabase/migrations/*.sql` in chronological order and cross-check every table in `Database['public']['Tables']` (`apps/ui/app/api/database.types.ts`).
  2. Check `SECURITY DEFINER` functions for missing `SET search_path` or missing `auth.uid()` / workspace membership checks.
  3. Inspect `supabase/tests/space_access.test.sql` for existing pgTAP assertions.
  4. Target file for new failing test: `supabase/tests/space_access.test.sql` (or a new SQL test alongside it).
- **Fix questions to answer if confirmed:**
  - Which exact migration statements (`REVOKE`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, or `ALTER FUNCTION ... SET search_path = ''`) lock the exposed object without breaking `apps/ui` client reads (`useAgentsRealtime.ts`, `SessionProvider.tsx`)?
- **Severity if confirmed:** **Critical** — any visitor (including anonymous auto-signed-in visitors) can query PostgREST directly with the public publishable key to steal another workspace's data, API keys, or engine credentials.
- **Evidence rule:** Quote exact SQL lines (`supabase/migrations/<file>.sql:line`) and confirm no later migration revokes/alters the policy; mark `unproven` if effective PostgreSQL default privileges cannot be determined from migrations alone.

---

### `B6b` — `createServiceRoleClient()` Callers on User-Triggerable Paths (`apps/ui`)
- **Covers:** Prompt item B.6 (part 2 of 2: service-role queries triggered by normal users) + `CLAUDE.md` raw `.from()` read audit
- **Where:**
  - `apps/ui/supabase/serviceRole.ts`, `apps/ui/supabase/server.ts` (`getRequestWorkspaceId` `Number.NaN` edge case at line 24)
  - `apps/ui/app/api/_auth/ownership.ts`, `apps/ui/app/api/_auth/access.ts`, `apps/ui/app/api/_auth/workspace-target.ts`, `apps/ui/app/api/_auth/box-scope.ts`
  - High-risk user-reachable `serviceRole` callers (109 files total; split here to auth/routes/actions first, services in `B6c`):
    - `apps/ui/app/api/chat/route.ts`, `apps/ui/app/api/fetch/route.ts`, `apps/ui/app/api/search/route.ts`, `apps/ui/app/api/hub/route.ts`
    - `apps/ui/app/api/v1/me/account/route.ts`, `apps/ui/app/api/v1/me/devices/route.ts`
    - `apps/ui/app/api/mcp/apps/[slug]/route.ts`, `apps/ui/app/api/mcp/composio/[slug]/route.ts`
    - `apps/ui/app/api/public/attachments/[ticket]/[name]/route.ts`, `apps/ui/app/p/[slug]/route.ts`, `apps/ui/app/published-view/[slug]/page.tsx`, `apps/ui/app/published-site/[slug]/[[...path]]/route.ts`
    - `apps/ui/app/api/_actions/*.ts` (`account.actions.ts`, `members.actions.ts`, `workspace.actions.ts`, `workspace-restore.actions.ts`, `agent.actions.ts`, `agent-share.actions.ts`, `publish.actions.ts`, `template.actions.ts`, `message-feedback.actions.ts`)
- **First read & shortest trace (~500 lines):** Read `apps/ui/supabase/server.ts:20-28` -> `apps/ui/app/api/_auth/ownership.ts` -> `apps/ui/app/api/_auth/access.ts` -> inspect every `createServiceRoleClient()` call in `apps/ui/app/api/**/route.ts`, `apps/ui/app/published-*/**`, and `apps/ui/app/api/_actions/*.ts`.
- **Question:** Can an authenticated (or anonymous-session) user pass a forged `workspaceId`, `agentId`, `sessionId`, `spaceId`, `slug`, or `x-workspace-id` header (`NaN` / another workspace's integer ID) to any Next.js route handler, page, or `'use server'` action that calls `createServiceRoleClient()`, reading or mutating rows outside their own workspace/box scope?
- **How to prove it:**
  1. Verify every `'use server'` export in `apps/ui/app/api/_actions/*.ts` and `apps/ui/app/actions/onboarding.ts` calls `requireWorkspaceContext` / `assertAgentAccess` / `assertSpaceAccess` *before* touching `createServiceRoleClient()`, and verify `eq('workspace_id', ctx.workspaceId)` (or `select*` filter object) is bound on every service-role query (watch for `undefined` / `NaN` filter values in `supabase-helpers.ts`).
  2. Check `apps/ui/supabase/supabase-helpers.ts` for how `undefined` or `NaN` values in filter objects behave (whether `{ workspace_id: undefined }` silently drops the `.eq()` clause!).
  3. Run `pnpm --filter rerun exec vitest run app/api/_auth/access.test.ts app/api/_auth/ownership.test.ts supabase/supabase-helpers.test.ts`.
  4. Target file for new failing test: `apps/ui/app/api/_auth/access.test.ts` or `apps/ui/supabase/supabase-helpers.test.ts`.
- **Fix questions to answer if confirmed:**
  - Does `supabase-helpers.ts` throw if a filter value is `undefined` or `Number.isNaN(v)`? If not, what breaks if it rejects `undefined`/`NaN` immediately?
  - Which specific action or route handler needs an explicit `workspace_id` / `user_id` predicate added?
- **Severity if confirmed:** **Critical** — bypasses RLS completely via `SUPABASE_SECRET_KEY`, exposing or overwriting arbitrary customer workspaces, coworkers, or private storage objects.
- **Evidence rule:** Quote exact caller and helper lines (`path:line`) and vitest output; mark `unproven` any path not traced from HTTP/action entry to DB query.

---

### `B6c` — `createServiceRoleClient()` in `_services/` & Foreman/MCP Hub Dispatchers
- **Covers:** Prompt item B.6 (remainder of `serviceRole` callers in `apps/ui/app/api/_services/` and `apps/ui/lib/`)
- **Where:**
  - `apps/ui/app/api/_services/agent.service.ts`, `chat.service.ts`, `conversation.service.ts`, `box.service.ts`, `space.service.ts`, `mcp-account.service.ts`, `mcp-shares.service.ts`, `services.service.ts`, `foreman-hub.service.ts`, `team-hub.service.ts`, `desktop-auth.service.ts`, `workspace-engine.service.ts`, `sandbox.service.ts`, `notification.service.ts`
  - `apps/ui/app/api/hub/route.ts` (note lines 41–43: `foreman call without token (tolerated)`!)
  - `apps/ui/lib/foreman/hub-token.ts`, `apps/ui/lib/foreman/conversation.ts`, `apps/ui/lib/foreman/onboarding-tools.ts`, `apps/ui/lib/agents/share-access.ts`
- **First read & shortest trace (~480 lines):** Read `apps/ui/app/api/hub/route.ts:15-74` -> `apps/ui/lib/foreman/hub-token.ts` -> `apps/ui/app/api/_services/foreman-hub.service.ts` -> `apps/ui/app/api/_services/team-hub.service.ts` -> `apps/ui/app/api/_services/mcp-account.service.ts` -> `apps/ui/app/api/_services/agent.service.ts`.
- **Question:** Can a coworker in a restricted/private box (`space_access`), or the Foreman when `foremanHubTokenRequired()` is false (`apps/ui/app/api/hub/route.ts:39-43`), invoke `/api/hub` or `_services/*` functions backed by `createServiceRoleClient()` to escalate to workspace-admin `workspaceActor(engine.workspaceId)` privileges or read/modify coworkers, secrets, or services in private boxes the calling member cannot access?
- **How to prove it:**
  1. Trace `foremanHubTokenRequired()` in `apps/ui/lib/foreman/hub-token.ts` and check when a coworker or caller with engine bearer auth can send `x-rerun-agent: foreman` without `x-rerun-foreman-token` to obtain `workspaceActor(engine.workspaceId)` (full admin actor!).
  2. Note connection to `A1a`/`A2`: if a coworker in a restricted box can reach `RERUN_HUB_BASE_URL` (`http://app:3000/api/hub`) or spoof `x-rerun-agent`, check what `/api/hub` permits.
  3. Check `_services/*.ts` for functions taking an `agentId` or `sessionId` without `workspaceId` binding.
  4. Run `pnpm --filter rerun exec vitest run app/api/hub/route.test.ts lib/foreman/hub-token.test.ts`.
  5. Target file for new failing test: `apps/ui/app/api/hub/route.test.ts`.
- **Fix questions to answer if confirmed:**
  - Can `foremanHubTokenRequired()` be unconditional whenever `x-rerun-agent === 'foreman'`, and how are engine->hub calls authenticated per coworker so one coworker cannot impersonate `foreman` or another `engine_agent_id`?
- **Severity if confirmed:** **Critical** — horizontal/vertical privilege escalation inside a workspace (member restricted from private HR/finance boxes reads or mutates them through Foreman or hub tools) or cross-coworker impersonation on `/api/hub`.
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` any claim not backed by traced caller + service code.

---

### `B7` — Engine HTTP Auth, Unauthenticated Routes, Desktop Tokens, `foremanGuard` & Multi-Workspace Isolation
- **Covers:** Prompt item B.7
- **Where:**
  - `apps/engine/src/http/server.ts`, `apps/engine/src/http/auth.ts`, `apps/engine/src/http/foreman-guard.ts`
  - `apps/engine/src/desktop/session.ts` (`desktopTokenMatches`), `apps/engine/src/desktop/ticket.ts`
  - `apps/engine/src/http/routes/health.ts`, `triggers.ts`, `desktop.ts`, `files.ts`, `data.ts`, `chat.ts`, `runs.ts`, `memories.ts`, `schedules.ts`, `agents.ts`, `connections.ts`, `update.ts`, `screenshot.ts`, `brain.ts`
  - `apps/ui/app/api/_services/workspace-engine.service.ts`, `apps/ui/lib/engine/client.ts`
- **First read & shortest trace (~460 lines):** Read `apps/engine/src/http/server.ts:36-109` -> `apps/engine/src/http/auth.ts:1-27` -> `apps/engine/src/http/foreman-guard.ts:1-36` -> `apps/engine/src/desktop/session.ts` -> `apps/engine/src/http/routes/health.ts`, `triggers.ts`, `desktop.ts`, `update.ts`, `files.ts`.
- **Question:** (1) What routes bypass `auth` (when `RERUN_API_KEY` is unset, on `healthRoutes`, on trigger fire endpoints, or via `isDesktopPanelRequest` / desktop WebSocket/VNC tickets); (2) does `auth.ts:25` (`token !== key`) use non-constant-time comparison; (3) does `foremanGuard` (`patchesOnlyTheModel` reading `c.req.json()` or regex path normalization) allow tampering or ReDoS/body-consumption bugs; and (4) if two workspaces or restricted boxes share an engine or a coworker calls engine HTTP on `localhost:3000`, can one coworker/workspace read or start another's runs, files, `/shared/files`, `/shared/data`, `/brain`, memories, or schedules?
- **How to prove it:**
  1. Check every route mounted before `api.use('*', auth)` in `server.ts:39` (`healthRoutes` — check if `triggers` fire route is mounted under `api` requiring `RERUN_API_KEY` or under `healthRoutes`!).
  2. Check `localhost:3000` reachability from inside the engine container when `RERUN_API_KEY` is set vs unset, and check how `apps/ui` maps workspaces to engines (`1 workspace : 1 engine` vs shared pool in `workspace-engine.service.ts`).
  3. Check `foreman-guard.ts:15-19` (`PUT / POST / DELETE /agents/foreman/files*` are in `FOREMAN_OPEN_ROUTES`!) and `foreman-guard.ts:32` (`c.req.path.replace(/\/$/, '')` vs `//` or URL-encoded `%66oreman`).
  4. Run `pnpm --filter rerun-engine exec vitest run src/http/auth.enabled.test.ts src/http/auth.desktop-token.test.ts src/http/foreman-guard.test.ts`.
  5. Target file for new failing test: `apps/engine/src/http/auth.enabled.test.ts` or `apps/engine/src/http/foreman-guard.test.ts`.
- **Fix questions to answer if confirmed:**
  - Should `auth.ts` refuse to boot in production (`NODE_ENV === 'production'`) when `RERUN_API_KEY` is empty unless explicitly opted out, and use `timingSafeEqual`?
  - Does `c.req.param('id')` vs URL-encoded `/agents/%66oreman` or `/agents/foreman//...` bypass `FOREMAN_OPEN_ROUTES` or `foremanGuard`?
- **Severity if confirmed:** **Critical** — unauthenticated RCE if `RERUN_API_KEY` is unset or leaked via timing/localhost, or cross-agent/foreman tampering via path/guard bypass.
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` any multi-workspace engine sharing scenario unless confirmed in `workspace-engine.service.ts` / `cloud-oss/engines.ts`.

---

### `X1` — Unlisted Surface: Next.js SSRF, Arbitrary File/Site Serving & Open Redirects (`fetch`, `published-site`, `public`, `mcp`)
- **Covers:** Added critical surface (OMP-PROMPT rule 5: web app public/proxy endpoints)
- **Where:**
  - `apps/ui/app/published-site/[slug]/[[...path]]/route.ts`, `apps/ui/lib/published/gate.ts`, `apps/ui/lib/published/host.ts`
  - `apps/ui/app/api/fetch/route.ts`, `apps/ui/app/api/search/route.ts`
  - `apps/engine/src/lib/public-fetch.ts` (DNS rebinding between `resolvesToPublicAddresses` and `fetch`!)
  - `apps/ui/app/api/public/attachments/[ticket]/[name]/route.ts`, `apps/ui/app/api/public/job-reading/route.ts`
  - `apps/ui/proxy.ts` (`publishedHost`, `brandGate`)
- **First read & shortest trace (~420 lines):** Read `apps/engine/src/lib/public-fetch.ts:1-74` -> `apps/ui/app/api/fetch/route.ts` -> `apps/ui/app/published-site/[slug]/[[...path]]/route.ts:115-298` -> `apps/ui/lib/published/gate.ts:47-106` -> `apps/ui/app/api/public/attachments/[ticket]/[name]/route.ts`.
- **Question:** (1) Does `fetchPublic` (`public-fetch.ts:42-74`) or `/api/fetch` suffer from DNS-rebinding TOCTOU (resolving hostname first, then calling `fetch(url)` which re-resolves DNS to `127.0.0.1` / `169.254.169.254` / `http://engine:3000` / `http://webgate:8080`) or IPv4-mapped IPv6 bypasses; and (2) can `published-site` serve stored HTML/SVG on the main app origin (cookie-stealing XSS when `publishedSiteOrigin` is unset in self-hosted installs) or suffer path/key traversal or brute-forceable access codes?
- **How to prove it:**
  1. Inspect `NON_PUBLIC` IP regex/ranges and `fetch()` dispatcher pinning in `apps/engine/src/lib/public-fetch.ts` and `apps/ui/app/api/fetch/route.ts`.
  2. Inspect `originOf` (`published-site/[slug]/[[...path]]/route.ts:52-54`), `CSP` / `BASE_HEADERS` (`lines 33-37`), `checkPassword` (`lines 228-236`), and `checkCode` (`lines 247-255`) for rate limits, timing attacks, and same-origin HTML execution.
  3. Run `pnpm --filter rerun-engine exec vitest run src/lib/public-fetch.test.ts` and `pnpm --filter rerun exec vitest run app/api/fetch/route.test.ts proxy.test.ts`.
  4. Target file for new failing test: `apps/engine/src/lib/public-fetch.test.ts` or `apps/ui/proxy.test.ts`.
- **Fix questions to answer if confirmed:**
  - How do we pin the resolved IP in `undici` `Agent` `connect.lookup` inside `fetchPublic` so DNS cannot rebind on the second lookup?
  - If `publishedSiteOrigin(slug)` is null (no wildcard subdomain configured), does `serveObject` sandbox HTML/SVG with `Content-Security-Policy: sandbox` so published coworker files cannot read `moldwright` session cookies?
- **Severity if confirmed:** **Critical** — same-origin XSS on published sites steals victim session cookies; SSRF DNS rebinding reaches internal Docker containers (`engine`, `supabase`, `webgate`).
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` any runtime header behavior not verified in code/tests.

---

### `X2` — Unlisted Surface: Coworker Archive Import/Export Symlink & Secret Scrubbing (`import.ts`, `archive.ts`)
- **Covers:** Added critical surface (OMP-PROMPT rule 5: tarball import/share boundary)
- **Where:**
  - `apps/engine/src/agents/import.ts` (`extractArchive`, `normalizeEntryPath`, `isAllowed`, `importAgent`, `readStagedEnv`)
  - `apps/engine/src/agents/archive.ts` (`walk`, `scrubConfig`, `redactionFor`, `stageArchive`, `buildArchive`)
  - `apps/ui/lib/agents/share-create.ts`, `apps/ui/lib/agents/share-install.ts`
- **First read & shortest trace (~380 lines):** Read `apps/engine/src/agents/import.ts:29-249` -> `apps/engine/src/agents/archive.ts:30-245`.
- **Question:** (1) Can a crafted `.tar.gz` imported via `importAgent` plant symlinks/hardlinks inside `workspace/`, `skills/`, or `mcp/`, exceed decompression bomb limits cleanly, or smuggle malicious `mcpServers` stdio commands (`command: "sh"`, `env: { LD_PRELOAD: ... }`) that execute immediately on connect; and (2) can `buildArchive` / `share-create.ts` leak unredacted secrets in `agent.db`, `memories/`, `workspace/`, `config.json`, or `.env` when a user shares a coworker link publicly?
- **How to prove it:**
  1. Trace tar entry type filtering in `extractArchive` (`import.ts:49-91`) — check `SymbolicLink`, `Link`, `PAX` headers, and `mcpServers` command execution in `importAgent` (`import.ts:199-230`).
  2. Trace `ARCHIVE_ROOTS`, `SKIP_PATHS`, `scrubConfig`, and `redactionFor` in `archive.ts:30-242` (check whether `data/agent.db` or `workspace/.env*` files are included in shared archives!).
  3. Run `pnpm --filter rerun-engine exec vitest run src/agents/import.test.ts src/agents/archive.test.ts`.
  4. Target file for new failing test: `apps/engine/src/agents/import.test.ts` or `apps/engine/src/agents/archive.test.ts`.
- **Fix questions to answer if confirmed:**
  - Which tar entry types, `mcpServers` stdio fields, or `archive.ts` paths must be stripped or gated on user confirmation during import/export?
- **Severity if confirmed:** **Critical** — arbitrary file read/write or RCE on coworker import; credential/PII leak when sharing a coworker template link.
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` anything not demonstrated in `tar` parser code or tests.

---

### `X3` — Unlisted Surface: Electron Desktop App IPC Origin Guard, Navigation & Deep-Link Token Handling
- **Covers:** Added critical surface (OMP-PROMPT rule 5: `apps/desktop-app` native privilege boundary)
- **Where:**
  - `apps/desktop-app/src/main/main-window.ts` (`appWindowOptions`, `guardChildWindow`, `guardNavigation`, `openExternal`)
  - `apps/desktop-app/src/main/ipc-guard.ts` (`senderAudience`), `apps/desktop-app/src/main/ipc-handlers.ts`
  - `apps/desktop-app/src/main/deep-links.ts` (`parseDeepLink`), `apps/desktop-app/src/main/browser-sign-in.ts`, `apps/desktop-app/src/main/url-policy.ts`
  - `apps/desktop-app/src/preload/index.ts`
- **First read & shortest trace (~360 lines):** Read `apps/desktop-app/src/preload/index.ts` -> `apps/desktop-app/src/main/ipc-guard.ts` -> `apps/desktop-app/src/main/ipc-handlers.ts` -> `apps/desktop-app/src/main/main-window.ts:63-202` -> `apps/desktop-app/src/main/deep-links.ts` -> `apps/desktop-app/src/main/url-policy.ts`.
- **Question:** Can an untrusted link, iframe, published page, or crafted `moldwright://` / `rerun://` deep link bypass `senderAudience` / `guardNavigation` / `openExternal` (e.g. `file://`, `smb://`, `ms-msdt:`, or custom self-hosted server URL) to invoke privileged Electron IPC handlers, steal desktop auth codes, or execute local binaries?
- **How to prove it:**
  1. Check `webPreferences` (`sandbox`, `contextIsolation`, `nodeIntegration`) in `main-window.ts:178-201`, protocol allowlist in `openExternal` (`main-window.ts:63-67`) and `url-policy.ts`, and `senderFrame` validation in `ipc-guard.ts` + every `ipcMain.handle` in `ipc-handlers.ts`.
  2. Check OAuth `state` validation in `deep-links.ts` + `browser-sign-in.ts` against login CSRF / auth-code injection.
  3. Run `pnpm --filter rerun-desktop test` via Terminal Commander `run_and_watch`.
  4. Target file for new failing test: `apps/desktop-app/test/ipc-guard.test.ts` or `apps/desktop-app/test/url-policy.test.ts`.
- **Fix questions to answer if confirmed:**
  - Which exact IPC channels, URL schemes in `openExternal`, or deep-link `state` checks need tightening, and does `sandbox: true` break anything in `preload/index.ts`?
- **Severity if confirmed:** **Critical** — host OS RCE (`shell.openExternal` non-http schemes or unsandboxed preload) or account takeover via deep-link CSRF.
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` OS-specific protocol handler behavior not verifiable in unit tests.

---

## Tier 2 — Data Loss, Unauthorized Triggers, Rename Drift & SQLite/Migration Corruption

### `B8` — Webhooks & Triggers: Signature Verification, Replay Protection & Unauthenticated Start Surface
- **Covers:** Prompt item B.8
- **Where:**
  - `apps/engine/src/triggers/loader.ts` (`Trigger`, `newTriggerToken`, `readTrigger`, `markFired`), `apps/engine/src/triggers/message.ts`, `apps/engine/src/triggers/url.ts`
  - `apps/engine/src/http/routes/triggers.ts` (`tokenMatches`, `POST /agents/:id/triggers/:slug/fire`)
  - `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.ts` (public trigger ingress on web app)
  - `apps/ui/app/api/webhooks/bird/route.ts`, `apps/ui/app/api/webhooks/linkup/route.ts`, `apps/ui/app/api/webhooks/engine/route.ts`, `apps/ui/app/api/webhooks/supabase-auth-email/route.ts`
- **First read & shortest trace (~380 lines):** Read `apps/engine/src/http/routes/triggers.ts` -> `apps/engine/src/triggers/loader.ts:11-105` -> `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.ts` -> `apps/ui/app/api/webhooks/bird/route.ts` -> `apps/ui/app/api/webhooks/linkup/route.ts` -> `apps/ui/app/api/webhooks/supabase-auth-email/route.ts`.
- **Question:** Can an unauthenticated caller (or replayed webhook delivery) forge or replay calls to `/api/t/[agentId]/[slug]/[token]`, `/api/webhooks/{bird,linkup,engine,supabase-auth-email}`, or `/agents/:id/triggers/:slug/fire` due to missing HMAC/timestamp replay windows, `tokenMatches` length-leak/empty-token bugs, URL-logged bearer tokens, or paused/deleted workspace bypasses, starting paid model runs or injecting messages?
- **How to prove it:**
  1. Inspect `tokenMatches` in `apps/engine/src/http/routes/triggers.ts:11-15` (check empty string, UTF-8 byte-length mismatch throwing in `timingSafeEqual`, and disabled trigger handling) and `/api/t/[agentId]/[slug]/[token]/route.ts` (check workspace pause/credit/rate-limit gates and provider signature verification).
  2. Inspect signature + timestamp replay checks on `bird`, `linkup`, and `supabase-auth-email` webhook routes.
  3. Run `pnpm --filter rerun-engine exec vitest run src/http/routes/triggers.auth.test.ts src/http/routes/triggers.fire.test.ts` and `pnpm --filter rerun exec vitest run "app/api/t/[agentId]/[slug]/[token]/route.test.ts" app/api/webhooks/bird/route.test.ts app/api/webhooks/supabase-auth-email/route.test.ts`.
  4. Target file for new failing test: `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.test.ts` or `apps/engine/src/http/routes/triggers.auth.test.ts`.
- **Fix questions to answer if confirmed:**
  - Which webhook/trigger routes lack signature verification, timestamp replay bounds, or workspace-paused/quota checks, and how can they be enforced without breaking existing webhook URLs?
- **Severity if confirmed:** **High** (Critical if `supabase-auth-email` or `bird` allows auth-code interception or arbitrary account state mutation) — unauthenticated callers trigger unbounded model spend and coworker tool execution.
- **Evidence rule:** Quote exact `path:line` and test output; mark `unproven` external webhook header formats not pinned by provider SDKs or tests.

---

### `B9a` — Rerun -> Moldwright Rename Split-Brain: Auth, Cookies (2026-11-19 Drop), Headers, CORS & Allowed Hosts
- **Covers:** Prompt item B.9 (part 1 of 2: auth, cookies, headers, CORS, allowed hosts)
- **Where:**
  - `apps/ui/proxy.ts`, `apps/ui/supabase/middleware.ts` (`PROVISIONED_COOKIE`, `SESSION_HINT_COOKIE`), `apps/ui/supabase/server.ts`, `apps/ui/app/(authflow)/auth/callback/route.ts`
  - `packages/contracts/src/session-hint.ts`, `packages/contracts/src/consent.ts`, `packages/contracts/src/brand-gate.ts`, `packages/contracts/src/foreman.ts` (`x-rerun-foreman-token`), `packages/analytics/src/client.ts`
  - `apps/ui/lib/published/gate.ts` (`__rerun`, `accessCookieName`), `apps/ui/lib/auth/pending-invite.ts`, `apps/ui/lib/auth/last-sign-in-cookie.ts`, `apps/ui/lib/staging-gate.ts`
  - `apps/engine/src/tools/mcp-hub-headers.ts`, `apps/ui/app/api/hub/route.ts` (`x-rerun-agent`), `apps/desktop-app/src/main/url-policy.ts`, `apps/desktop-app/src/main/deep-links.ts`
- **First read & shortest trace (~430 lines):** Inspect commit `01149262` (`git show 01149262 -- apps/ packages/`) -> read `apps/ui/proxy.ts` -> `apps/ui/supabase/middleware.ts` -> `apps/ui/app/(authflow)/auth/callback/route.ts` -> `packages/contracts/src/session-hint.ts` -> `apps/engine/src/tools/mcp-hub-headers.ts` -> `apps/desktop-app/src/main/url-policy.ts`.
- **Question:** Did dropping the parent-domain cookie rule on `2026-11-19` (`01149262`) or partially renaming `rerun` -> `moldwright` leave any cookie (`Domain` mismatch on logout/clear vs set, published-site subdomain auth, analytics/consent cookie), HTTP header (`x-rerun-*`), custom URL scheme (`rerun://` vs `moldwright://`), CORS rule, or allowed-host check where setter and reader use different names or attributes?
- **How to prove it:**
  1. Pair every cookie `set` with its `get` and `delete` across `apps/ui` and `packages/` (especially checking whether users with legacy `.robagentic.tech` / parent-domain cookies now carry duplicate cookies shadowing the host-only cookie!).
  2. Pair every custom `x-rerun-*` / `x-workspace-id` header producer with its consumer across `apps/engine`, `apps/ui`, `apps/mobile`, and `apps/desktop-app`.
  3. Run `pnpm --filter rerun exec vitest run proxy.test.ts supabase/middleware.test.ts "app/(authflow)/auth/callback/route.test.ts"`.
  4. Target file for new failing test: `apps/ui/supabase/middleware.test.ts` or `apps/ui/proxy.test.ts`.
- **Fix questions to answer if confirmed:**
  - Do existing browsers holding an older `Domain=.moldwright...` / parent-domain cookie send two cookies of the same name after `01149262`, causing stale `SESSION_HINT_COOKIE` or `PROVISIONED_COOKIE` reads unless explicitly expired on parent domain?
  - Which mismatched setter/reader pairs must be unified?
- **Severity if confirmed:** **High** — broken sign-out, auth redirect loops, bypassed gates, or dropped auth headers between UI, engine, mobile, and desktop.
- **Evidence rule:** Quote both setter `path:line` and reader `path:line` plus test output; mark `unproven` browser cookie-jar upgrade states not simulated in unit tests.

---

### `B9b` — Rerun -> Moldwright Rename Split-Brain: Environment Variables, Connection IDs & Deploy Configs
- **Covers:** Prompt item B.9 (part 2 of 2: `RERUN_` vs `MOLDWRIGHT_` settings across 171 source files and deploy configs)
- **Where:**
  - `.env.example`, `apps/engine/.env.example`, `docker-compose.yml`, `deploy/vps/docker-compose.vps.yml`, `deploy/vps/dev-engine.yml`, `deploy/vps/factory-runner.yml`, `deploy/vps/moved-host.yml`, `deploy/vps/make-env.sh`, `deploy/vps/set-env.sh`, `deploy/vps/doctor.sh`, `deploy/vps/rotate-engine-key.sh`
  - `apps/engine/src/config/env.ts`, `apps/engine/src/connections/store.ts` (`ensureMoldwrightConnection`), `apps/engine/src/connections/migrate.ts`, `apps/engine/src/connections/resolve.ts`
  - `apps/ui/lib/engine/ai-sources.ts`, `apps/ui/lib/engine/constants.ts`, `apps/ui/cloud-oss/llm.ts`, `apps/ui/cloud-oss/billing.ts`, `apps/ui/cloud-oss/engines.ts`
  - `tools/factory/dispatch.py`, `tools/factory/resolver.py`, `tools/factory/engine.py`
- **First read & shortest trace (~450 lines):** Cross-reference all `process.env.RERUN_*` / `process.env.MOLDWRIGHT_*` / `os.environ` readers against `.env.example`, `docker-compose*.yml`, and `deploy/vps/*.sh`; then read `apps/engine/src/connections/store.ts:106-118` + `migrate.ts` + `apps/ui/lib/engine/ai-sources.ts` for connection ID/provider key mismatches (`rerun` vs `moldwright`).
- **Question:** Is there any env var, connection ID (`rerun` vs `moldwright`), Docker Compose service/volume/secret name, or CLI binary name (`rerun` vs `moldwright`) where a writer/deploy script sets one name while runtime code reads the other?
- **How to prove it:**
  1. Run a deterministic Python/rg cross-check extracting all env keys read in `apps/`, `packages/`, `tools/factory/`, and `deploy/vps/` vs keys written in `docker-compose*.yml`, `.env.example`, and `deploy/vps/*.sh`.
  2. Check `ensureMoldwrightConnection` (`apps/engine/src/connections/store.ts:106-118`) vs `apps/ui/lib/engine/ai-sources.ts` and `apps/engine/src/connections/migrate.ts`.
  3. Run `pnpm --filter rerun-engine exec vitest run src/deploy-config.test.ts src/connections/migrate.test.ts src/connections/store.test.ts` and `python3 -I -m unittest tools/factory/test_env_scripts.py tools/factory/test_deploy_files.py`.
  4. Target file for new failing test: `apps/engine/src/deploy-config.test.ts` or `tools/factory/test_deploy_files.py`.
- **Fix questions to answer if confirmed:**
  - Should the reader accept a fallback alias or should the setter be updated, and does changing a persisted connection ID require a `DATA_DIR_MIGRATIONS` step per `CLAUDE.md`?
- **Severity if confirmed:** **High** — silent feature/auth/deploy failure (e.g. `RERUN_API_KEY` ignored, managed model connection broken, or key rotation updating the wrong key).
- **Evidence rule:** Quote exact writer `path:line` and reader `path:line`; mark `unproven` any `.env` value existing only on the live VPS.

---

### `X4` — Unlisted Surface: Engine SQL Browser & Raw SQL Guard Bypass (`sqlStore.ts`, `data.ts`, `db.ts`, `shared-db.ts`)
- **Covers:** Added critical surface (OMP-PROMPT rule 5: SQLite `ATTACH` / `load_extension` / SQL guard surface)
- **Where:**
  - `apps/engine/src/db/sqlStore.ts` (`blankSqlStringsAndComments`, `assertNoSqlFileAccess`, `assertReadOnlySql`, `assertNoAttach`, `queryStore`, `executeStore`, `quoteIdent`, `updateTableRow`)
  - `apps/engine/src/http/routes/data.ts` (`createDataRouter`)
  - `apps/engine/src/tools/builtin/db.ts`, `apps/engine/src/tools/builtin/shared-db.ts`
  - `apps/engine/src/db/sharedDb.ts` (`recordTableOwnership`, `SHARED_HIDDEN_TABLES`), `apps/engine/src/db/agentDb.ts` (`AGENT_HIDDEN_TABLES`)
- **First read & shortest trace (~360 lines):** Read `apps/engine/src/db/sqlStore.ts:107-330` -> `apps/engine/src/http/routes/data.ts:34-192` -> `apps/engine/src/tools/builtin/db.ts` -> `apps/engine/src/tools/builtin/shared-db.ts` -> `apps/engine/src/db/sharedDb.ts:48-115`.
- **Question:** Can SQL passed to `queryStore` / `executeStore` (via HTTP `/data` routes or coworker `db` / `shared-db` tools) bypass `blankSqlStringsAndComments`, `assertNoAttach`, `assertNoSqlFileAccess`, or `assertReadOnlySql` (e.g., via SQLite CTEs `WITH ... DELETE/INSERT`, `PRAGMA`, dollar/hex/blob literals, `ALTER TABLE`, triggers, or hidden-table reads), or can CSV export (`toCsvValue` in `data.ts:27-32`) emit unescaped formula injection?
- **How to prove it:**
  1. Inspect regexes `WRITE_KEYWORDS`, `STRINGS_AND_COMMENTS`, `FILE_ACCESS_FUNCTIONS`, `VACUUM_INTO`, and `assertNoAttach` in `sqlStore.ts:270-300` against SQLite grammar (`ATTACH`, `load_extension`, `fts3_tokenizer`, `PRAGMA writable_schema`, `PRAGMA database_list`, multi-statement `executeMultiple`, hidden `_rerun_*` tables).
  2. Check `shared-db.ts` table ownership enforcement: can one coworker drop/modify another coworker's table in `shared.db`?
  3. Run `pnpm --filter rerun-engine exec vitest run src/db/sqlStore.test.ts src/http/routes/data.sql.test.ts src/tools/builtin/db.test.ts src/tools/builtin/shared-db.test.ts`.
  4. Target file for new failing test: `apps/engine/src/db/sqlStore.test.ts`.
- **Fix questions to answer if confirmed:**
  - Can SQLite authorizer / `PRAGMA query_only = ON` replace regex keyword denylists for read-only queries, and which exact SQLite constructs must `assertNoAttach` / `assertNoSqlFileAccess` block?
- **Severity if confirmed:** **High** (Critical if `ATTACH DATABASE '/data/rerun.db'` or `load_extension` succeeds) — arbitrary file read/write on engine disk or cross-coworker DB corruption via SQL tool/route.
- **Evidence rule:** Quote exact `path:line` and run a local libsql test or read-only node one-liner if needed; never modify repo test files.

---

### `E18` — Supabase Migrations: Ordering, Destructive Steps & Column/Type Agreement After Rename
- **Covers:** Prompt item E.18
- **Where:**
  - `supabase/migrations/*.sql` (135 files)
  - `apps/ui/app/api/database.types.ts`
  - `packages/db/src/database.types.ts`
  - `supabase/seed.sql`
- **First read & shortest trace (~420 lines):** Run a read-only Python verification script across all 135 `supabase/migrations/*.sql` files + `apps/ui/app/api/database.types.ts` + `packages/db/src/database.types.ts` to detect duplicate/out-of-order version prefixes, non-idempotent/destructive DDL (`DROP TABLE`, `DROP COLUMN`, `ALTER TYPE`, `DELETE`, `TRUNCATE`, `NOT NULL` without `DEFAULT`), drift between `apps/ui/app/api/database.types.ts` and `packages/db/src/database.types.ts`, and any renamed `rerun_*` vs `moldwright_*` column/RPC mismatch in `apps/ui`.
- **Question:** Do any of the 135 migrations have timestamp/order collisions, unguarded data-destroying DDL on live upgrades, divergence between `apps/ui/app/api/database.types.ts` and `packages/db/src/database.types.ts`, or column/table/RPC names that disagree with queries in `apps/ui` and `packages/` after the Rerun -> Moldwright rename?
- **How to prove it:**
  1. Compare `apps/ui/app/api/database.types.ts` vs `packages/db/src/database.types.ts` table-by-table and RPC-by-RPC.
  2. Inspect every migration containing `DROP`, `RENAME`, `TRUNCATE`, `DELETE FROM`, or `ALTER TABLE ... ADD COLUMN ... NOT NULL` (especially recent `202610*` and `202611*` files) and check `supabase/seed.sql` compatibility.
  3. Check `CLAUDE.md` rule compliance: scan `apps/ui` diff/code for any raw `.from(table).select(...)` read bypassing typed helpers or untyped write payloads that hide column-name mismatches.
  4. Target file for new failing test: `apps/ui/supabase/supabase-helpers.test.ts` or CI `migrations` step test in `supabase/tests/space_access.test.sql`.
- **Fix questions to answer if confirmed:**
  - Since shipped migrations on live Supabase have already run, which new forward migration + regenerated `database.types.ts` / caller fix resolves the mismatch safely without editing applied migrations?
- **Severity if confirmed:** **High** — failed production `supabase db push` in `deploy/vps/update.sh`, permanent customer data loss, or runtime PostgREST 400 errors on renamed columns.
- **Evidence rule:** Quote exact SQL and TypeScript lines (`path:line`); mark `unproven` live production row shapes not visible in repo migrations.

---

### `E19` — Engine LibSQL Databases: Concurrent Writers, `"client is closed"` Races & Per-Coworker Migrations
- **Covers:** Prompt item E.19
- **Where:**
  - `apps/engine/src/db/client.ts`, `apps/engine/src/db/sqlStore.ts` (`pool`, `opening`, `openStore`, `closeStore`, `withBusyRetry`)
  - `apps/engine/src/db/systemDb.ts` (`pool`, `opening`, `getSystemDb`, `closeSystemDb`, `SYSTEM_DB_MIGRATIONS`), `apps/engine/src/db/agentDb.ts` (`closeAgentDb`, `checkpointAgentDb`), `apps/engine/src/db/sharedDb.ts` (`SHARED_DB_MIGRATIONS`, `ready`), `apps/engine/src/db/brainDb.ts`
  - `apps/engine/src/db/ladder.ts`, `apps/engine/src/db/migrate.ts`
  - `apps/engine/src/datadir/migrations.ts` (`DATA_DIR_MIGRATIONS`), `apps/engine/src/datadir/ladder.ts`
  - Callers of `closeSystemDb` / `closeAgentDb` / `closeStore` (`agents/duplicate.ts`, `agents/import.ts`, `cli/commands/snapshot.ts`, `http/routes/agents.ts`, test teardown)
- **First read & shortest trace (~400 lines):** Read `apps/engine/src/db/client.ts` -> `apps/engine/src/db/sqlStore.ts:1-60` -> `apps/engine/src/db/systemDb.ts:238-353` -> `apps/engine/src/db/agentDb.ts` -> `apps/engine/src/db/sharedDb.ts:1-46` -> `apps/engine/src/db/ladder.ts` -> `apps/engine/src/datadir/migrations.ts`, and use SymForge `find_references` on `closeSystemDb`, `closeAgentDb`, and `closeStore`.
- **Question:** (1) What exact race causes `@libsql/client` `LibsqlError: CLIENT_CLOSED: The client is closed` (e.g., an in-flight async run/repo query holding a `SystemDb` / `Client` reference across `closeSystemDb` / `closeStore`, or `opening` promise racing `closeSystemDb`, or `sharedDb.ts` caching `ready` after `closeStore`); (2) how do concurrent writers across `rerun.db`, `system.db`, `agent.db`, `shared.db`, and coworker subprocesses (`RERUN_AGENT_DB` / `RERUN_SHARED_DB`) handle `SQLITE_BUSY` (`busy_timeout` PRAGMA vs `withBusyRetry`); and (3) are `DATA_DIR_MIGRATIONS`, `SYSTEM_DB_MIGRATIONS`, and `SHARED_DB_MIGRATIONS` re-runnable and safe for archived-coworker restores?
- **How to prove it:**
  1. Trace every caller of `closeSystemDb`, `closeAgentDb`, `closeStore`, and `client.close()`, checking what happens to concurrent `loop.ts` / `runs.ts` / `messages.ts` / `stats.ts` writes and whether `PRAGMA busy_timeout` is set on `client.ts`, `systemDb.ts`, and `sqlStore.ts`.
  2. Check `importAgent` (`apps/engine/src/agents/import.ts`): when an older archived coworker (`system.db` / `agent.db`) is imported onto a newer engine, does `getSystemDb` / `getAgentDb` run all missing migrations cleanly?
  3. Run `pnpm --filter rerun-engine exec vitest run src/db/systemDb.test.ts src/db/sqlStore.test.ts src/db/ladder.test.ts src/datadir/ladder.test.ts`.
  4. Target file for new failing test: `apps/engine/src/db/systemDb.test.ts` or `apps/engine/src/db/sqlStore.test.ts`.
- **Fix questions to answer if confirmed:**
  - How should reference-counting / drain-before-close or `PRAGMA busy_timeout = 5000` be wired into `systemDb.ts`, `sqlStore.ts`, and `client.ts` so neither tests nor live agent deletion/snapshot/duplicate triggers `CLIENT_CLOSED` or `SQLITE_BUSY`?
- **Severity if confirmed:** **High** — crashes in-flight runs, corrupts or drops run/message state under concurrency, and causes flaky CI failures.
- **Evidence rule:** Quote exact `path:line` and vitest output; reproduce the `CLIENT_CLOSED` race deterministically by trace (and existing test runs if observable).

---

### `F21` — VPS Deploy, Keeper & Doctor Root Scripts (`deploy/vps/update.sh`, `keeper.sh`, `doctor.sh`, `rotate-engine-key.sh`)
- **Covers:** Prompt item F.21
- **Where:**
  - `deploy/vps/update.sh`, `deploy/vps/keeper.sh`, `deploy/vps/doctor.sh`, `deploy/vps/rotate-engine-key.sh`, `deploy/vps/tidy.sh`, `deploy/vps/move-host.sh`, `deploy/vps/make-env.sh`, `deploy/vps/set-env.sh`
  - `.gitattributes` (`*.sh text eol=lf`)
  - `tools/factory/test_keeper.py`, `tools/factory/test_doctor.py`, `tools/factory/test_rotate_engine_key.py`
- **First read & shortest trace (~440 lines):** Read `deploy/vps/update.sh:1-90` -> `deploy/vps/keeper.sh:1-194` -> `deploy/vps/doctor.sh:1-62` -> `deploy/vps/rotate-engine-key.sh` -> `deploy/vps/tidy.sh`.
- **Question:** Running as `root`, can `update.sh`, `keeper.sh`, `doctor.sh`, `rotate-engine-key.sh`, or `tidy.sh` (1) delete live volumes/containers/worktrees, (2) leave the server half-updated (e.g., migrations pushed in step 3/4 before `docker compose up -d` fails, or `PW` password containing `&`/`#`/`@`/`/` breaking `SUPABASE_DB_URL` in `update.sh:61-67`, or shell-quoting injection via `$REPO`), or (3) execute a script/systemd unit with `CRLF` line endings if transferred outside `.gitattributes`?
- **How to prove it:**
  1. Trace `update.sh` line-by-line: `su ... "git -C '$REPO' pull"` (`line 38`), self-re-exec (`line 39`), `trap undrain EXIT` (`line 42` vs `DISPATCHER=` reset at `line 79`!), `PW` URL interpolation without percent-encoding (`lines 61-67`), `NET` concatenation when `supabase-db` is attached to >1 Docker network (`line 63` `{{range ...}}{{$k}}{{end}}`!), and `docker stop/rm $OLD` (`lines 77-78`).
  2. Trace `keeper.sh` root housekeeping (`chore()`, `run()`, systemd unit install) and `tidy.sh` cleanup rules.
  3. Check every `.sh` file in repo for `\r` bytes and check `.gitattributes` coverage (including files without `.sh` extension like `apps/engine/docker-entrypoint.sh` or `deploy/vps/webgate/server.mjs`).
  4. Run `python3 -I -m unittest tools/factory/test_keeper.py tools/factory/test_doctor.py tools/factory/test_rotate_engine_key.py` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `tools/factory/test_keeper.py`, `tools/factory/test_doctor.py`, or `tools/factory/test_deploy_files.py`.
- **Fix questions to answer if confirmed:**
  - Note the two immediate candidates visible in `update.sh`: `line 63` (`{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}` concatenates network names with no separator if >1 network exists!) and `line 64` (unencoded `$PW` in `postgresql://` URI). What minimal POSIX `sh` fixes harden `update.sh` and `keeper.sh` without adding dependencies?
- **Severity if confirmed:** **High** — failed root deploy mid-migration, stranded drained factory, or destructive cleanup on the production/factory VPS.
- **Evidence rule:** Quote exact shell lines (`path:line`) and unit test results; never execute root deploy commands.

---

## Tier 3 — Factory Merging Wrong Code, Closing Live Work, Crash Duplication & Prompt Injection

### `C10` — `dispatch.py` `checks()` Merge Integrity, Head-Move Re-Review & `dev_hold` Enforcement
- **Covers:** Prompt item C.10
- **Where:**
  - `tools/factory/dispatch.py` (`checks` L1724–1790, `dev_hold` L1804–1808, `step` L1476–1617, `open_proven` L1336–1403, `checks_verdict` L503–517)
  - `tools/factory/resolver.py` (`records`, `dev red` ticket handling)
  - `tools/factory/ciwait.py` (`unfinished`, `cancelled_ids`)
  - `tools/factory/test_dispatch.py`, `tools/factory/test_merge_dev_gate.py`, `tools/factory/test_dispatch_proven.py`, `tools/factory/test_dispatch_proven_guards.py`
- **First read & shortest trace (~420 lines):** Read `tools/factory/dispatch.py:1336-1403,1476-1617,1724-1809` -> `tools/factory/resolver.py:72-188`.
- **Question:** Is there any code path where `dispatch.py` merges a PR (1) without `--match-head-commit` equal to the exact SHA that passed review (and prover when `cfg["proof"]` is enabled) and CI, (2) without returning to `review_wait` if `headRefOid` changed after review/proof, or (3) while `dev` is red (for any job other than the resolver's own fix issue `r.get("filed") == j["issue"]`)?
- **How to prove it:**
  1. Search all occurrences of `"merge"` / `open_proven` across `tools/factory/*.py` to confirm `dispatch.py:1780` is the sole PR merge call (or check if `runner_loop.py` / `resolver.py` / `open_proven` has another merge path!).
  2. Trace `j["head"]`, `j["reviewed_head"]` / `j["proved"]`, `now_head` (`dispatch.py:1727-1729`), and `proof_wait` (`dispatch.py:1770-1771`): check whether a head move *during* `proof_wait` or *between* `now_head` check (`L1727`) and `gh pr merge --match-head-commit j["head"]` (`L1780`) or after `except Error:` (`L1781-1788` — if `gh pr merge` fails with head mismatch, someone else merged a *different* head so `state == "MERGED"`, does `L1788` wrongly mark `j["own_merge"] = True` on an unreviewed head?!).
  3. Check `dev_hold` (`L1804-1808`): is there a gap between a merge commit turning `dev` red in `dev_results()` and `self.resolver.records(self).get("dev red")` becoming populated?
  4. Run `python3 -I -m unittest tools/factory/test_dispatch.py tools/factory/test_merge_dev_gate.py tools/factory/test_dispatch_proven.py tools/factory/test_dispatch_proven_guards.py` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `tools/factory/test_merge_dev_gate.py` or `tools/factory/test_dispatch.py`.
- **Fix questions to answer if confirmed:**
  - Check both `L1782` (`state == "MERGED"` without verifying `mergedCommit` / `headRefOid == j["head"]`) and the gap before `resolver` registers `"dev red"`: what minimal check in `checks()` / `dev_hold()` closes any window?
- **Severity if confirmed:** **High** (Critical if unreviewed code merges) — factory auto-merges unreviewed commits onto `dev` or piles merges onto a broken `dev` branch.
- **Evidence rule:** Quote exact `tools/factory/*.py:line` and unittest output; mark `unproven` any GitHub API eventual-consistency behavior not reproducible with `fakegh`.

---

### `C11` — `labelcheck.fix` & `labelcheck.close_gaps` Restart Caps, Live-Work Guards & Duplicate Coverage Proof
- **Covers:** Prompt item C.11
- **Where:**
  - `tools/factory/labelcheck.py` (`check` L25–55, `fix` L58–76, `busy` L83–88, `covered` L95–102, `close_gaps` L105–144)
  - `tools/factory/escapes.py` (`repairs`)
  - `tools/factory/dispatch.py` (`once` / `beat_end` / `digest` callers of `labelcheck.fix` and `labelcheck.close_gaps`)
  - `tools/factory/test_labelcheck.py`, `tools/factory/test_drift.py`, `tools/factory/test_escapes.py`
- **First read & shortest trace (~280 lines):** Read `tools/factory/labelcheck.py:1-144` -> `tools/factory/escapes.py` -> callers of `labelcheck` in `tools/factory/dispatch.py` and `tools/factory/digest.py`.
- **Question:** (1) Do the once-per-issue (`rec.get("plan")`, `rec.get("closed")`, `rec.get("kept")`, `TRIES = 3`) and per-pass (`FIXES = 5`) caps in `labelcheck.fix` and `labelcheck.close_gaps` hold across crashes and restarts; (2) can `busy(n, data)` (`labelcheck.py:83-88`) miss live work (such as `recheck:{n}`, `instr:{n}`, `classify:{n}`, `ready_chunks`, `queue`, or a child issue `Part of #{n}` currently running!); and (3) can `covered(gh, repo, dup, n)` (`lines 95-102`) return `None` (allowing closure!) when *both* the older gap issue and the newer gap issue have *empty* `escapes.repairs(...)` sets (`set() - set() == set()`!) even though they describe completely different non-`**Repairs**` prose gaps?
- **How to prove it:**
  1. Check `covered()` (`labelcheck.py:99-102`): `extra = set(escapes.repairs(body(gh, repo, n))) - set(escapes.repairs(kept))` — if the older gap issue has zero parsed `**Repairs**` numbers (or lists prose gaps alongside one shared repair number), `extra` is empty! Verify `escapes.repairs` in `tools/factory/escapes.py`.
  2. Check `busy(n, data)` (`labelcheck.py:83-88`) against all stations in `registry.py:126` (`recheck`, `job`, `accept`, `plan`, `instr`, `classify`) and open child issues of gap issue `n`.
  3. Check `LIMIT = "1000"` in `labelcheck.read` and `CAP = 30` truncation in `labelcheck.check` (`lines 50-55`).
  4. Run `python3 -I -m unittest tools/factory/test_labelcheck.py tools/factory/test_drift.py tools/factory/test_escapes.py` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `tools/factory/test_labelcheck.py`.
- **Fix questions to answer if confirmed:**
  - Should `covered()` refuse to close `n` whenever `escapes.repairs(old_body)` is empty (or when `old_body` has gap bullets not backed by `**Repairs**`), and which station keys (`recheck:%d`, `instr:%d`, `classify:%d`, open children) must `busy()` check?
- **Severity if confirmed:** **High** — `close_gaps` permanently closes non-duplicate open gap issues as `"not planned"` or closes an issue that is actively in `recheck`/`classify`/child execution.
- **Evidence rule:** Quote exact `tools/factory/labelcheck.py:line` and `escapes.py:line` plus unittest output.

---

### `C12` — `acceptance.py`: Premature Parent Closure with Open Children/Gaps & `revive` Round Bounds
- **Covers:** Prompt item C.12
- **Where:**
  - `tools/factory/acceptance.py` (`due` L21–31, `open_children` L127–134, `start` L154–183, `poll` L209–233, `ask_again` L234–242, `revive` L243–250, `accept` L252–256, `gaps` L258–269)
  - `tools/factory/cutshape.py` (`parse`)
  - `tools/factory/dispatch.py` (how `acceptance.once` is invoked and what `jobs` list it receives)
  - `tools/factory/test_acceptance.py`, `tools/factory/test_dispatch_acceptance.py`
- **First read & shortest trace (~300 lines):** Read `tools/factory/acceptance.py:1-269` -> `tools/factory/cutshape.py` -> `acceptance` call sites in `tools/factory/dispatch.py`.
- **Question:** (1) Can `acceptance.py` accept and close a parent issue while a cut child issue or an open `"Gaps of #<parent>:"` issue is still open (for example: while an `running` acceptance run is already in flight in `poll()` -> `accept()` after a new child/gap opened, or when a gap issue omits `Part of #<parent>` so `open_children` misses it, or when a child failed/blocked so `due(jobs)` or `HELD` behaves unexpectedly); and (2) can `revive()` (`L243-250`) ever grant more than one fresh round across crashes/restarts or state transitions?
- **How to prove it:**
  1. Read `due(jobs)` (`acceptance.py:21-31` — elided earlier; inspect exact predicate!), `HELD` (`L16`: `"gaps"` is *not* in `HELD`!), `open_children(n)` (`L127-134`: checks `Part of\W*#%d\b` in open issues up to `1000`, and check whether `poll() -> accept()` re-checks `open_children(n)` before closing the parent at `L254`!).
  2. Trace `revive()` (`L243-250`): `row.get("revived")` in `kv` (`"1"` string is truthy), check if anything ever resets `"revived"` or `store.forget("accept:%d" % n)` or if a crash mid-loop in `L247-248` (`revived=1`, `sends=0`, *crash before `state=unsent`*) strands the parent in `left` with `revived=1` so it gets *zero* fresh rounds!
  3. Run `python3 -I -m unittest tools/factory/test_acceptance.py tools/factory/test_dispatch_acceptance.py` via Terminal Commander `run_and_watch`.
  4. Target file for new failing test: `tools/factory/test_acceptance.py`.
- **Fix questions to answer if confirmed:**
  - Must `accept()` re-verify `not self.open_children(n)` (and check open `Gaps of #<n>:` titles regardless of body text) immediately before `gh issue close`, and must `revive()` write `state="unsent"` last/atomically after setting `sends=0` before `revived=1`?
- **Severity if confirmed:** **High** — closes an epic/parent issue as `Accepted` while child slices or filed gap issues remain unfinished, or strands `revive` on crash.
- **Evidence rule:** Quote exact `tools/factory/acceptance.py:line` and unittest output.

---

### `C13` — `dev_healed` Workflow-ID Self-Heal vs Path-Filtered Workflows (`dispatch.py`)
- **Covers:** Prompt item C.13
- **Where:**
  - `tools/factory/dispatch.py` (`checks_verdict` L503–517, `dev_healed` L1810–1824, `dev_results` L1826–1856, `note_problems` L2184–2193)
  - `tools/factory/problems.py` (`Watch.find` L18–61)
  - `.github/workflows/ci.yml`, `.github/workflows/factory-tools.yml` (`paths: ['tools/factory/**', 'deploy/vps/**', ...]`), `.github/workflows/images.yml` (`paths-ignore: ['docs/**', 'tools/factory/**', 'deploy/vps/**']`)
  - `tools/factory/test_dispatch_devresult.py`, `tools/factory/test_problems.py`
- **First read & shortest trace (~260 lines):** Read `tools/factory/dispatch.py:1810-1857,2184-2193` -> `tools/factory/problems.py:1-61` -> compare with `.github/workflows/ci.yml`, `factory-tools.yml`, `images.yml` -> read `tools/factory/test_dispatch_devresult.py`.
- **Question:** Can `dev_healed(sha, failed)` (`dispatch.py:1810-1824`) or `problems.py` clear a `"dev red"` state via a later green `dev` commit that did not actually re-run the failing job/check (e.g., `ci.yml` matrix sub-jobs, `docker-inputs` / `images` job skipped inside `ci.yml` while `workflow_id` still concludes `success`, `per_page=100` pagination truncation, or `problems.py` watching a different set of jobs than `dev_results`)?
- **How to prove it:**
  1. Check how `workflow_id` behaves for path-filtered workflows (`factory-tools.yml`, `images.yml` — when skipped by path filter, no workflow run is created so `workflow_id not in passed`, `failed <= passed` is `False`) **vs** conditional jobs *inside* a single workflow (`ci.yml` has `docker-inputs` / `images` conditional jobs: on `push` to `dev`, `images` in `ci.yml:145` has `github.ref != 'refs/heads/dev'`, whereas `images.yml` runs on `push` to `dev` unless `paths-ignore` matches!).
  2. Check `dev_results` (`L1838`): `failed` only collects `conclusion in ("failure", "timed_out")` — what if one workflow failed and another workflow on `sha` was `cancelled` or `action_required` (`verdict` when both `bad` and `cancelled` exist: `checks_verdict` returns `"FAIL"` at `L510` before checking `cancelled` at `L513`, so `failed` omits the cancelled `workflow_id`!)?
  3. Check `dev_healed` comparing `head` (tip of `dev` only) vs intermediate green commits, and check `problems.py` interaction with `dev_result`.
  4. Run `python3 -I -m unittest tools/factory/test_dispatch_devresult.py tools/factory/test_problems.py` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `tools/factory/test_dispatch_devresult.py`.
- **Fix questions to answer if confirmed:**
  - Should `failed` in `dev_results` (`L1838`) also include any workflow on `sha` whose conclusion was not `"success"` / `"skipped"` (e.g. `"cancelled"`, `"startup_failure"`, `"action_required"`), and are there any intra-workflow conditional jobs on `dev` that can turn green without running?
- **Severity if confirmed:** **High** — falsely clears `dev red` and unblocks PR merges onto a still-broken `dev` branch.
- **Evidence rule:** Quote exact `dispatch.py:line`, `.github/workflows/*.yml:line`, and unittest output.

---

### `C14a` — SQLite Ledger (`store.py`) Multi-Write Crash Windows in `dispatch.py` & `runner_loop.py`
- **Covers:** Prompt item C.14 (part 1 of 2: `store.py` autocommit primitives + `dispatch.py` / `runner_loop.py` multi-step transitions)
- **Where:**
  - `tools/factory/store.py` (`Store.__init__` `isolation_level=None` L78, `intent`, `fired`, `close_run`, `dequeue_to_intent`, `_write_job`, `put_job`, `set`, `forget`)
  - `tools/factory/dispatch.py` (`save`, `to`, `intake`, `send`, `finished_run`, `open_proven`, `checks`, `end`)
  - `tools/factory/runner_loop.py` (`ingest`, `resolve_pending`, `check`, `finish_build`, `start_queued`, `fire_batch`, `start_ready`)
  - `tools/factory/test_store.py`, `tools/factory/test_dispatch_crash.py`, `tools/factory/test_runner_loop.py`
- **First read & shortest trace (~480 lines):** Read `tools/factory/store.py:69-423` -> `tools/factory/dispatch.py:603-611,760-940,1100-1205,1336-1403,1778-1791,1867-1873` -> `tools/factory/runner_loop.py:182-314,385-508`.
- **Question:** Because `sqlite3.connect(path, isolation_level=None)` (`store.py:78`) autocommits every SQL statement unless wrapped in `with self.db:` / `BEGIN IMMEDIATE`, which multi-write transitions in `store.py`, `dispatch.py`, and `runner_loop.py` leave torn state if the process crashes (`SIGKILL` / OOM / container restart) mid-transition, causing a duplicate GitHub PR/comment/label/merge, a double-fired model run, or a permanently stranded/lost job?
- **How to prove it:**
  1. Inventory every method in `store.py` executing ≥2 SQL statements without an explicit transaction (`set` L161–165, `forget` L171–173, `dequeue_to_intent` L203–214, `_write_job` L287–299, `import_json` L393–419) and every sequence in `dispatch.py` / `runner_loop.py` mixing `store.*` writes with `account(...)` or `gh(...)` side effects (`send` L1100–1140, `intake`, `open_proven`, `checks` merge + `end`, `runner_loop.start_queued` / `fire_batch`).
  2. For each multi-write sequence, trace what the next beat's `reconcile` / `stop_lost` / `resolve_pending` does when restarted right after write $k$ of $N$.
  3. Run `python3 -I -m unittest tools/factory/test_store.py tools/factory/test_dispatch_crash.py tools/factory/test_runner_loop.py` via Terminal Commander `run_and_watch`.
  4. Target file for new failing test: `tools/factory/test_store.py` or `tools/factory/test_dispatch_crash.py`.
- **Fix questions to answer if confirmed:**
  - Which `store.py` methods should wrap multi-statement mutations in `with self.db:` transactions, and which external `gh`/`account` calls need durable pre-intent markers before firing?
- **Severity if confirmed:** **High** — crash during normal VPS deploy/restart double-spends expensive Opus/Sonnet runs, posts duplicate GitHub issues/PRs, or orphans active jobs.
- **Evidence rule:** Quote exact `path:line` of each SQL write and external call in sequence, plus restart recovery handler `path:line`.

---

### `C14b` — SQLite Ledger (`store.py`) Multi-Write Crash Windows in `planning.py`, `acceptance.py`, `resolver.py` & `labelcheck.py`
- **Covers:** Prompt item C.14 (part 2 of 2: `kv`-backed stations where state is spread across multiple `store.set(job, k, v)` calls)
- **Where:**
  - `tools/factory/planning.py` (`send` L1359–1437, `poll` L561–630, `cut` L1293–1334, `file_questions` L1001–1026, `finish` L1143–1153, `send_recheck` L716–746)
  - `tools/factory/acceptance.py` (`send` L184–208, `ask_again` L234–242, `revive` L243–250, `accept` L252–256, `gaps` L258–269)
  - `tools/factory/resolver.py` (`send` L226–251, `finished` L266–319, `do` L336–361)
  - `tools/factory/labelcheck.py` (`fix` L58–76, `close_gaps` L105–144)
- **First read & shortest trace (~460 lines):** Read `tools/factory/planning.py:561-654,716-781,1001-1036,1143-1200,1293-1437` -> `tools/factory/acceptance.py:184-269` -> `tools/factory/resolver.py:226-361`.
- **Question:** In `kv`-based stations (`plan:*`, `recheck:*`, `accept:*`, `resolver`, `labelfix:*`, `gapclose:*`) that loop `for k, v in (...): self.store.set(job, k, v)` around `account("send_message", ...)` and `gh(["issue", "create" | "comment" | "close" | "edit", ...])`, which crash points between individual `store.set` calls leave a torn `kv` record (e.g., `state="running"` before `fire`/`started`/`agent` are written, resulting in `KeyError`/`ValueError` crash loops on restart, or duplicate child/question issues opened in `planning.cut` / `file_questions`, or `revive` setting `revived=1` before `state="unsent"`)?
- **How to prove it:**
  1. Note `acceptance.py:191-193` right away: `store.set(job, "state", "running")` runs *first* in the tuple before `agent`, `copy`, `started`, `fire`, `sends`! If dispatcher crashes after `"state"="running"` and before `"fire"` or `"agent"`, on restart `self.running()` (`L125`: `r["agent"], int(r["copy"])`) or `self.poll()` (`L212`: `int(row["fire"])`) raises `KeyError` / `ValueError`, crashing the entire dispatcher beat! Check `planning.py` and `resolver.py` for the exact same ordering hazard!
  2. Check `planning.cut` (`L1293-1334`) and `planning.file_questions` (`L1001-1026`) for idempotency if restarted after creating $k$ of $M$ GitHub child/question issues.
  3. Run `python3 -I -m unittest tools/factory/test_planning_cut.py tools/factory/test_planning_start.py tools/factory/test_acceptance.py tools/factory/test_resolver.py` via Terminal Commander `run_and_watch`.
  4. Target file for new failing test: `tools/factory/test_acceptance.py` and `tools/factory/test_planning_start.py`.
- **Fix questions to answer if confirmed:**
  - Should `Store` provide an atomic `set_many(job, items)` (`with self.db:`) and write `"state"` last (or atomically with all required fields), and how does `planning.cut` avoid duplicate child issues on crash?
- **Severity if confirmed:** **High** — a crash mid-`set` loop bricks the dispatcher loop with an unhandled `KeyError`/`ValueError` on every subsequent beat or creates duplicate GitHub child issues.
- **Evidence rule:** Quote exact `for k, v` loop lines and restart reader lines (`path:line`) plus unittest output.

---

### `C15` — Prompt Injection Into Factory Coworkers, Control Loop & GitHub Comment Ingestion
- **Covers:** Prompt item C.15
- **Where:**
  - `tools/factory/planning.py` (`brief_lines` L69–96, `PLAN_BRIEF` L291, `answer_of` L272–284, `answers` L1038–1057, `latest_plan` L794–797)
  - `tools/factory/dispatch.py` (`intake` L792–940, `follow_ups` L737–758, `build_brief` L242–270, `review_brief` L308–330, `proof_brief` L333–357)
  - `tools/factory/instructions.py`, `tools/factory/control.py`, `tools/factory/resolver.py` (`owner_check` L396–414, `tickets` L132–171), `tools/factory/runner_loop.py` (`FACTORY_LOGINS` L549, `intake_issue` L563–572)
  - `tools/factory/acceptance.py` (`plan` L34–40, `brief` L43–78)
- **First read & shortest trace (~480 lines):** Read `tools/factory/instructions.py` -> `tools/factory/control.py:116-192` -> `tools/factory/planning.py:272-295,794-797,1038-1057` -> `tools/factory/acceptance.py:34-78` -> `tools/factory/dispatch.py:737-940` -> `tools/factory/runner_loop.py:548-573`.
- **Question:** Since `moldwright` is a public repository where any GitHub user can open issues or comment on issues/PRs: (1) where does Python code itself fail to filter `author.login in ("special-place-administrator", "moldwright-factory[bot]")` (check `acceptance.plan(comments)` at `acceptance.py:34-40` and `planning.latest_plan` / `answer_of` / `control.py` / `instructions.py`!); and (2) when coworkers run `gh issue view {number} -R {repo}` or `gh pr view` in their own shell (as instructed in `planning.py:76`, `planning.py:291`, `dispatch.py:247`), what technical mechanism — if any — stops a stranger's issue comment or PR review comment from appearing in `gh issue view` output and steering the planner, builder, reviewer, prover, or acceptor?
- **How to prove it:**
  1. Check `acceptance.py:34-40` (`def plan(comments):`) and `planning.py:794-797` (`latest_plan`) and `planning.py:272-284` (`answer_of`) to see whether Python itself accepts a plan comment or question answer written by an arbitrary GitHub commenter!
  2. Check `dispatch.intake`, `instructions.py`, `control.py`, and `resolver.py` to verify which GitHub issue/comment authors can trigger factory runs or mutate `control` bounds.
  3. Trace `gh issue view` / `gh pr view` invocations inside briefs: confirm whether `gh issue view` dumps all public comments (or doesn't even show comment `author.login` clearly vs spoofed markdown headers) directly into the coworker LLM context while that coworker holds `GH_TOKEN` (from `process-env.ts` / `factory-token`)!
  4. Run `python3 -I -m unittest tools/factory/test_instructions.py tools/factory/test_dispatch_instructions.py tools/factory/test_acceptance.py tools/factory/test_planning_result.py` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `tools/factory/test_acceptance.py`, `tools/factory/test_planning_result.py`, or `tools/factory/test_instructions.py`.
- **Fix questions to answer if confirmed:**
  - How should the dispatcher pre-fetch and author-filter issue/PR bodies and comments (`author.login in TRUSTED_LOGINS`) before passing them in the brief — and forbid/wrap raw `gh issue view --comments` — plus add author checks to `acceptance.plan()`, `planning.latest_plan()`, and `planning.answer_of()`?
- **Severity if confirmed:** **Critical** (if Python accepts untrusted plan/answer comments or if any stranger comment steers a `GH_TOKEN`-equipped builder/planner on a public repo) — external GitHub user hijacks factory coworkers holding write tokens and model keys.
- **Evidence rule:** Quote exact `tools/factory/*.py:line` and unittest output.

---

## Tier 4 — Gate Bypasses, Defense-in-Depth Limits, Vacuous Tests, Registry Precedence & Image Hygiene

### `D16` — CI Workflow Gates (`no-stubs`, `no-comments`, `red-green`, `refactor-frozen`) Bypass & Merge-Wait Audit
- **Covers:** Prompt item D.16
- **Where:**
  - `.github/workflows/no-stubs.yml`, `scripts/no-stubs/check.py`, `scripts/no-stubs/test_check.py`
  - `.github/workflows/no-comments.yml`, `scripts/strip-comments/strip.py`
  - `.github/workflows/red-green.yml`, `tools/factory/redgreen.py`, `tools/factory/test_redgreen.py`
  - `.github/workflows/refactor-frozen.yml`, `tools/factory/refactorcheck.py`, `tools/factory/test_refactorcheck.py`
  - `tools/factory/dispatch.py` (`checks` L1724–1790, `checks_verdict` L503–517)
- **First read & shortest trace (~360 lines):** Read `scripts/no-stubs/check.py` -> `scripts/strip-comments/strip.py:249-333` -> `tools/factory/redgreen.py` -> `tools/factory/refactorcheck.py` -> cross-check `.github/workflows/{no-stubs,no-comments,red-green,refactor-frozen}.yml` against `dispatch.py:503-517,1730-1733`.
- **Question:** Can a PR skip, neuter, or break any of the four gate workflows — via branch naming (`!startsWith(github.head_ref, 'chunk/')` on `red-green.yml:19` and `refactor-frozen.yml:14`!), `HEAD^1` shallow merge-commit parent quirks (`actions/checkout@v4` on `pull_request` checks out a synthetic merge commit where `HEAD^1` is the *base* branch tip, EXCEPT if `git diff --diff-filter=AM` or spaced filenames in `$(cat /tmp/changed.txt)` at `no-comments.yml:39` fail!), renamed files (`R` vs `AM`), exempt markers in `redgreen.py`, or a PR editing `scripts/no-stubs/check.py` / `tools/factory/redgreen.py` / `.github/workflows/*.yml` itself — and does `dispatch.checks()` wait on all four before merging?
- **How to prove it:**
  1. Check `no-comments.yml:39` (`--only $(cat /tmp/changed.txt)` unquoted word-splitting on paths with spaces or `[slug]`/`(authflow)` glob characters in Next.js routes!).
  2. Check `redgreen.py` (`exempt`, `split_changes`, `prove`, and `PR_BODY` env / `fetch_issue`), `no-stubs/check.py` (`HEAD^1` diff parsing), and `refactorcheck.py` (`--base HEAD^1` commit-message matching).
  3. Check `dispatch.checks()` (`L1730-1732`, `checks_verdict` `L503-517`): when a workflow job is `skipped` (conclusion `"skipped"`, e.g. non-`chunk/` branch) or hasn't registered its `workflow_run` yet when `ci.yml` finishes, is `"skipped"` in `OK_CONCLUSIONS` and can `checks()` merge before all 4 workflows even appear in `workflow_runs`?!
  4. Run `python3 -I -m unittest discover -s scripts/no-stubs -p "test_*.py"` and `python3 -I -m unittest tools/factory/test_redgreen.py tools/factory/test_refactorcheck.py` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `scripts/no-stubs/test_check.py`, `tools/factory/test_redgreen.py`, `tools/factory/test_refactorcheck.py`, or `tools/factory/test_dispatch.py`.
- **Fix questions to answer if confirmed:**
  - Must `dispatch.checks()` require an explicit expected set of workflow names/IDs on `chunk/*` PRs (so an unregistered workflow run cannot be overlooked when another fast workflow completes first), quote `/tmp/changed.txt` with `xargs -r` / `--only-file`, and forbid coworker PRs from modifying gate scripts/workflows without `special-place-administrator` approval?
- **Severity if confirmed:** **High** — factory merges stubbed tests, commented slop, untested features, or test-mutating refactors straight into `dev`.
- **Evidence rule:** Quote exact `.github/workflows/*.yml:line` and script `path:line` plus unittest output.

---

### `X5` — Unlisted Surface: GitHub Actions Self-Hosted Runner Routing, Cache Poisoning & Workflow Script Injection
- **Covers:** Added critical surface (OMP-PROMPT rule 5: `.github/workflows/*.yml` CI security)
- **Where:**
  - `.github/workflows/ci.yml` (`route` L13–48, `check` L49–70, `tests` L71–95, `images` L141–170)
  - `.github/workflows/red-green.yml` (`PR_BODY` / `HEAD_REF` env L35–38), `.github/workflows/images.yml`, `.github/workflows/release.yml`, `.github/workflows/version.yml`, `.github/workflows/factory-tools.yml`
- **First read & shortest trace (~220 lines):** Read `.github/workflows/ci.yml:1-170`, `.github/workflows/version.yml`, `.github/workflows/release.yml:1-56`, `.github/workflows/images.yml:1-58`.
- **Question:** In `.github/workflows/*.yml` on this public repository, can a fork PR or untrusted branch (1) run untrusted code on self-hosted `aap-crrr` runners (`ci.yml:14-18,36-42`), (2) inject shell via `${{ ... }}` interpolation in `run:` blocks, or (3) poison GHA Docker/pnpm caches (`cache-to: type=gha,mode=max,scope=engine`) across PRs?
- **How to prove it:**
  1. Check every `if:` guard on jobs using `self-hosted` runners or secrets (`ci.yml:14-18`: note `github.repository == 'rerun-build/rerun' || (...)` — if the repo were ever `rerun-build/rerun`, fork PRs would pass the left side of `||` without checking `head.repo.full_name == github.repository`!).
  2. Scan every `${{ ... }}` inside `run:` steps across all 9 workflow files in `.github/workflows/`.
  3. Target file for new failing test: `tools/factory/test_deploy_files.py` (workflow static check).
- **Fix questions to answer if confirmed:**
  - Which `if:` expressions or `${{ ... }}` `run:` interpolations in `.github/workflows/*.yml` should be tightened (`env:` binding + unconditional `head.repo.full_name == github.repository` on `pull_request`)?
- **Severity if confirmed:** **High** — self-hosted runner compromise or CI secret/cache poisoning from external PRs if repo name condition matches.
- **Evidence rule:** Quote exact `.github/workflows/*.yml:line`.

---

### `X6` — Unlisted Surface: Coworker File/Skill Path Fences (`resolveWithinReal`), Extra Roots & Dynamic `npx` MCP Installs
- **Covers:** Added critical surface (OMP-PROMPT rule 5: `fsTools`, `RERUN_FS_EXTRA_ROOTS`, and `mcp-packages.ts`)
- **Where:**
  - `apps/engine/src/tools/sandbox.ts` (`resolveWithin`, `resolveWithinReal`), `apps/engine/src/tools/builtin/fsTools.ts`, `apps/engine/src/tools/builtin/filesystem.ts` (`RERUN_FS_EXTRA_ROOTS` defaulted to `/data/work/wt` in `docker-compose.yml:41`!)
  - `apps/engine/src/http/routes/files.ts`, `apps/engine/src/http/routes/skills.ts`, `apps/engine/src/skills/apply-proposal.ts`
  - `apps/engine/src/tools/mcp-packages.ts` (`parseNpxLaunch`, `npmInstall`, `withInstalledPackage`), `apps/engine/src/tools/mcp.ts`
- **First read & shortest trace (~380 lines):** Read `apps/engine/src/tools/builtin/filesystem.ts` -> `apps/engine/src/tools/builtin/fsTools.ts` -> `apps/engine/src/http/routes/files.ts` -> `apps/engine/src/tools/mcp-packages.ts:19-130`.
- **Question:** (1) Does `RERUN_FS_EXTRA_ROOTS=/data/work/wt` (`docker-compose.yml:41`) grant *every* coworker's file tools read/write access across other coworkers' git worktrees; (2) is there a symlink TOCTOU window between `resolveWithinReal` returning the unresolved lexical `target` (`sandbox.ts:47`) and `fs.readFile`/`writeFile` opening `target`; and (3) does `npmInstall` in `mcp-packages.ts:59-75` execute arbitrary `postinstall` scripts (without `--ignore-scripts`) inside the engine container?
- **How to prove it:**
  1. Inspect `sandbox.ts:42-48`: `resolveWithinReal` checks `assertInside(realRoot, real, path)` and returns `target` (not `real` when `followLast=true`), plus check `filesystem.ts` for how `RERUN_FS_EXTRA_ROOTS` exposes `/data/work/wt` to all agents.
  2. Inspect `mcp-packages.ts:59-75` (`npm install` flags and `env` passed to `spawn`).
  3. Run `pnpm --filter rerun-engine exec vitest run src/tools/sandbox.test.ts src/tools/builtin/filesystem.roots.test.ts src/tools/builtin/fsTools.test.ts src/tools/mcp-packages.test.ts`.
  4. Target file for new failing test: `apps/engine/src/tools/sandbox.test.ts` or `apps/engine/src/tools/mcp-packages.test.ts`.
- **Fix questions to answer if confirmed:**
  - Should `resolveWithinReal` return `real` when `followLast === true`, should `RERUN_FS_EXTRA_ROOTS` be scoped per agent or read-only, and what breaks if `mcp-packages.ts` passes `--ignore-scripts` or uses `childProcessEnv({})`?
- **Severity if confirmed:** **High** — cross-coworker worktree tampering even for shell-disabled coworkers, or supply-chain/env leak during background `npm install`.
- **Evidence rule:** Quote exact `path:line` and vitest output.

---

### `X7` — PR #1688 Upstream Engine Ports: Custom Endpoint Refusal Fetch, MCP Tool Paging & MCP Device/HITL Sign-In (`custom-endpoint-fetch.ts`, `refusal-body.ts`, `mcp.ts`, `mcp-auth.ts`, `self.ts`)
- **Covers:** PR #1688 additions (`c1d28545`)
- **Where:**
  - `apps/engine/src/agents/custom-endpoint-fetch.ts` (`customEndpointFetch` L7–15, `customEndpointDispatcher` L5)
  - `apps/engine/src/lib/refusal-body.ts` (`refusalMessageOf` L1–9, `refusalResponse` L11–19)
  - `apps/engine/src/tools/mcp.ts` (`listAllTools` L54–67, `MAX_TOOL_PAGES` L52, `callMcpTool` L82–87)
  - `apps/engine/src/tools/mcp-auth.ts` (`serverCarriesCredential` L36–39, `discoverDeviceAuth` L41–53, `startDeviceFlow` L55–64, `pollDeviceToken` L77–106, `withAuth`, `saveToken`, `savePending`)
  - `apps/engine/src/tools/builtin/self.ts` (`mcp_register` L85–118, `mcp_login` L119–137, `mcp_login_complete`), `apps/engine/src/tools/builtin/hitl.ts` (`mcpSignInTool`)
  - `apps/engine/src/connections/claude-plan-limits.ts` (added in #1688; OAuth token usage on Anthropic limits endpoint)
- **First read & shortest trace (~360 lines):** Read `apps/engine/src/agents/custom-endpoint-fetch.ts:1-15` -> `apps/engine/src/lib/refusal-body.ts:1-19` -> `apps/engine/src/tools/mcp.ts:52-87` -> `apps/engine/src/tools/mcp-auth.ts:1-251` -> `apps/engine/src/tools/builtin/self.ts:85-187` -> `apps/engine/src/connections/claude-plan-limits.ts:1-72`.
- **Question:** Can any of PR #1688's additions (`customEndpointFetch` / `refusalResponse`, `listAllTools` paging, `mcp-auth.ts` + `self.ts` MCP sign-in flow, or `claude-plan-limits.ts`) leak a token/secret (e.g., via unredacted upstream refusal bodies, raw inline credentials when `serverCarriesCredential` checks `${...}` vs literal headers, SSRF in `discoverDeviceAuth`/`startDeviceFlow`/`pollDeviceToken` or `customEndpointFetch`, or file permissions on `mcpTokenPath`), hide a real error, or loop unboundedly?
- **How to prove it:**
  1. Trace `customEndpointFetch` (`custom-endpoint-fetch.ts:7-15`) + `refusalMessageOf` (`refusal-body.ts:1-9`) into `provider-errors.ts` / `loop.ts`: check unbounded `response.text()` memory consumption, whether non-402 errors or malformed bodies hide status/details, and whether custom `baseUrl` SSRFs internal Docker hosts without `public-fetch.ts`.
  2. Trace `listAllTools` (`mcp.ts:54-67`): verify `MAX_TOOL_PAGES = 50`, `seenCursors` cycle termination, and whether hitting `MAX_TOOL_PAGES` silently truncates tools without warning or loops on empty/non-advancing cursors.
  3. Trace `mcp-auth.ts` + `self.ts`: check `serverCarriesCredential` (`mcp-auth.ts:36-39`), SSRF on `discoverDeviceAuth` (`fetch` to arbitrary `mcpUrl` origin and `authorization_server` URL!), `pollDeviceToken` wait bounds, token file permissions on `mcpTokenPath`, and whether `probe.error` in `self.ts:102,105` or `claude-plan-limits.ts` can echo an Authorization header/token into chat transcripts.
  4. Run `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/agents/custom-endpoint-fetch.test.ts src/tools/mcp.test.ts src/tools/mcp-call.test.ts src/tools/mcp-auth.test.ts src/tools/builtin/self.mcp.test.ts src/connections/claude-plan-limits.test.ts` via Terminal Commander `run_and_watch`.
  5. Target file for new failing test: `apps/engine/src/agents/custom-endpoint-fetch.test.ts`, `apps/engine/src/tools/mcp-auth.test.ts`, or `apps/engine/src/tools/mcp.test.ts`.
- **Fix questions to answer if confirmed:**
  - Which exact URL validation (`assertPublicUrl`), body-size cap, token-redaction, or pagination-truncation guard closes the confirmed flaw without breaking legitimate custom OpenAI-compatible endpoints or OAuth MCP servers?
- **Severity if confirmed:** **High** (Critical if SSRF steals internal credentials or `mcp-auth` / `claude-plan-limits` leaks OAuth tokens) — token disclosure, internal SSRF, hidden provider errors, or hung MCP probes.
- **Evidence rule:** Quote exact `path:line` at `c1d28545` and vitest output.

---

### `A3` — Shell Output Secret Masking (`redactSecrets`) Treated as Security Boundary Anywhere?
- **Covers:** Prompt item A.3
- **Where:**
  - `apps/engine/src/tools/builtin/shell.ts` (`redactSecrets` L19–21, `execute` L48–59)
  - `apps/engine/src/agents/shared-env.ts` (`secretValuesOf` L16–20)
  - `apps/engine/src/db/repos/redact.ts`, `apps/engine/src/cli/commands/redact.ts`
  - `apps/engine/src/agents/providers.ts` (Claude Code / Codex native shell output vs `shell_exec`)
- **First read & shortest trace (~200 lines):** Read `apps/engine/src/tools/builtin/shell.ts:19-62`, `apps/engine/src/agents/shared-env.ts:5-20`, `apps/engine/src/db/repos/redact.ts`, and `apps/engine/src/cli/commands/redact.ts`; search references to `secretValuesOf` and `redactSecrets`.
- **Question:** Does any code, prompt, or connection/tool configuration rely on `redactSecrets` (`shell.ts:19-21`) or `secretValuesOf` (`shared-env.ts:16-20`) as actual secret containment — and where does `redactSecrets` itself miss secrets even for accidental-echo hygiene (e.g., `base64` / URL-encoded / line-wrapped output, secrets `< 8` chars, secrets named without `TOKEN|KEY|SECRET|PASSWORD`, connection `.env` tokens not in `shared.env`/`agent.env`, or Claude Code / Codex native `Bash` tool output bypassing `shell.ts` completely)?
- **How to prove it:**
  1. Find all callers of `secretValuesOf`, `redactSecrets`, and `redact.ts` via SymForge `find_references`.
  2. Verify whether Claude Code (`CLAUDE_RUN_TOOLS` `Bash`) and Codex CLI stream tool outputs through `db/repos/redact.ts` or persist raw stdout into `tool_calls` / `messages`.
  3. Run `pnpm --filter rerun-engine exec vitest run src/tools/builtin/shell.test.ts src/db/repos/redact.test.ts src/cli/commands/redact.test.ts`.
  4. Target file for new failing test: `apps/engine/src/db/repos/redact.test.ts` or `apps/engine/src/tools/builtin/shell.test.ts`.
- **Fix questions to answer if confirmed:**
  - Where secret values are persisted to `messages` / `tool_calls` (`db/repos/redact.ts`), should connection `.env` tokens also be fed into the DB redactor so accidental CLI/curl debug output never lands in SQLite/UI transcripts, while keeping real secrets out of untrusted coworker envs (`A2`)?
- **Severity if confirmed:** **Medium** (High if native `Bash` tool output writes unredacted connection OAuth tokens into `messages` / `tool_calls`) — false sense of security or accidental transcript secret persistence.
- **Evidence rule:** Quote exact `path:line` and test output.

---

### `A4` — Command Block-List Bypass Inventory (`sandbox.ts` `assertCommandAllowed`)
- **Covers:** Prompt item A.4
- **Where:**
  - `apps/engine/src/tools/sandbox.ts` (`BLOCKED` L54, `assertCommandAllowed` L56–60)
  - `apps/engine/src/tools/builtin/shell.ts` (`L46`), `apps/engine/src/agents/providers.ts` (`CLAUDE_RUN_TOOLS` `Bash` / Codex CLI shell)
  - `apps/engine/src/tools/sandbox.test.ts`
- **First read & shortest trace (~120 lines):** Read `apps/engine/src/tools/sandbox.ts:54-60`, `apps/engine/src/tools/sandbox.test.ts`, and check all callers of `assertCommandAllowed` via SymForge `find_references`.
- **Question:** Exactly what destructive or policy-violating commands bypass `BLOCKED` in `apps/engine/src/tools/sandbox.ts:54` (by static reading only — e.g., `rm -rf /*`, `rm -fr /`, `rm --recursive --force /`, `/bin/rm -rf /`, `find / -delete`, `python3 -c 'import shutil; shutil.rmtree(...)'`, `dd status=none if=...`, `chmod -R 000 /data`, quoting `r"m" -rf /`, and Claude Code / Codex native `Bash` never calling `assertCommandAllowed` at all)?
- **How to prove it:**
  1. Analyze each of the 8 regexes in `BLOCKED` (`sandbox.ts:54`) character-by-character and list every concrete class of bypass without executing any harmful command.
  2. Confirm via SymForge `find_references` that `assertCommandAllowed` is only called in `shell.ts:46` and never hooked into Claude Code `PreToolUse` hooks or Codex CLI execution in `providers.ts`.
  3. Run `pnpm --filter rerun-engine exec vitest run src/tools/sandbox.test.ts`.
  4. Target file for new failing test: `apps/engine/src/tools/sandbox.test.ts`.
- **Fix questions to answer if confirmed:**
  - Given regex block-lists cannot contain an arbitrary shell, what OS/container controls (`read_only: true` rootfs, per-agent UID/mount namespace in `A1a`) replace reliance on `BLOCKED`, and which obvious flag reorderings (`rm -fr`, `/*`, `--no-preserve-root`, Claude `PreToolUse` hook) are worth adding as an ergonomic guardrail against accidental LLM mistakes?
- **Severity if confirmed:** **Medium** (as a standalone regex check; pairs with **Critical** `A1a` because container/OS isolation is absent on `/data`) — `rm -fr /data` or `rm -rf /*` wipes every coworker on the engine.
- **Evidence rule:** Quote `apps/engine/src/tools/sandbox.ts:54-60` and test output; run nothing destructive.

---

### `E20` — Factory Ledger `moves` Table & `registry.py` `"since"` Timestamps and Per-Issue Precedence
- **Covers:** Prompt item E.20
- **Where:**
  - `tools/factory/store.py` (`SCHEMA` `moves` L18, `set` L161–165, `moved` L167–169, `forget` L171–173, `import_json` L393–419)
  - `tools/factory/registry.py` (`read` L60–81, `job_row` L84–102, `kv_row` L105–123, `rows` L130–144, `ORDER` L126–127, `stuck` L147–160)
  - `tools/factory/test_registry.py`, `tools/factory/test_store.py`, `tools/factory/test_storeread.py`
- **First read & shortest trace (~260 lines):** Read `tools/factory/store.py:161-176,393-419` -> `tools/factory/registry.py:1-179` -> `tools/factory/test_registry.py`.
- **Question:** (1) Are `moves.at`, `moves.prev`, and `kv_row` `"since"` timestamps accurate across initial row creation (`prev=NULL`), same-state re-sends (`sends` incremented in `accept` while `state` stays `"running"` or `"unsent"` -> `"running"`), `classify` station (`job_row`/`kv_row` ignores `moves` for `classify` at `registry.py:107-111`), pre-`moves` historical rows, and `import_json`; and (2) does `ORDER` (`registry.py:126-127`) pick the wrong winning station for an issue when multiple stations have records (e.g., an ended `job` shadowing a live or failed `accept` / `plan`, or `recheck` vs `job` precedence, or `stuck()` miscomputing elapsed time from mixed epoch/ISO timestamps)?
- **How to prove it:**
  1. Trace `store.set` (`store.py:163-165`): `ON CONFLICT(job) DO UPDATE ... WHERE moves.state != excluded.state` — when `state` does *not* change (e.g. a second run in the same state), `moves.at` stays at the old timestamp even if `rec["started"]` was updated (`kv_row` at `registry.py:120` prefers `(stamp or {}).get("at") or iso(rec.get("started"))`, so stale `moves.at` overrides a newer `rec["started"]`!).
  2. Trace `ORDER` in `registry.py:126-144`: check every `(station, live)` pair (notice `("classify", False)` is missing from `ORDER`, and `("job", False)` beats `("accept", False)` — so once a parent or slice has an ended `job` row AND an ended `accept:accepted` or `accept:gaps` row, `("job", False)` wins over `("accept", False)`!).
  3. Run `python3 -I -m unittest tools/factory/test_registry.py tools/factory/test_store.py tools/factory/test_storeread.py` via Terminal Commander `run_and_watch`.
  4. Target file for new failing test: `tools/factory/test_registry.py`.
- **Fix questions to answer if confirmed:**
  - Should `kv_row` use `max(stamp.at, iso(rec.started))` when `state == "running"` (or update `moves.at` on re-fire), and how should `ORDER` rank `("accept", False)` (e.g. `gaps` / `left` / `accepted`) relative to `("job", False)`?
- **Severity if confirmed:** **Medium** — false `stuck()` alarms (or missed stuck jobs) and wrong issue status reported in factory digests/snapshots and `labelcheck` (`parked_but_moving` reads `rows`!).
- **Evidence rule:** Quote exact `store.py:line` and `registry.py:line` plus unittest output.

---

### `D17` — Vacuous / Tautological New Tests Audit (`2026-11-17` to `2026-11-20`)
- **Covers:** Prompt item D.17
- **Where:**
  - Factory tests added/modified `2026-11-17..2026-11-20` (sample ≥15 files across recent PRs):
    - `tools/factory/test_problems.py`, `tools/factory/test_machine_own.py`, `tools/factory/test_planning_brief.py`, `tools/factory/test_planning_cut.py`, `tools/factory/test_causes.py`, `tools/factory/test_dispatch_proven.py`, `tools/factory/test_dispatch_proven_guards.py`, `tools/factory/test_dispatch_crash.py`, `tools/factory/test_dispatch_buildasks.py`, `tools/factory/test_dispatch_devresult.py`, `tools/factory/test_planning_rules.py`, `tools/factory/test_planning_held.py`, `tools/factory/test_labelcheck.py`, `tools/factory/test_acceptance.py`, `tools/factory/test_registry.py`
  - Engine tests added/modified `2026-11-17..2026-11-20` (sample ≥12 files across recent PRs):
    - `apps/engine/src/agents/providers.test.ts`, `apps/engine/src/agents/providers.gaps.test.ts`, `apps/engine/src/agents/providers.stub-stream.test.ts`, `apps/engine/src/tools/builtin/shell.env.test.ts`, `apps/engine/src/http/routes/chat-request.test.ts`, `apps/engine/src/runtime/loop.labels.test.ts`, `apps/engine/src/runtime/loop.lineage.test.ts`, `apps/engine/src/agents/availability.gaps.test.ts`, `apps/engine/src/tools/builtin/schedule.gaps.test.ts`, `apps/engine/src/tools/builtin/trigger.gaps.test.ts`, `apps/engine/src/deploy-config.test.ts`, `apps/engine/src/rooms/room-contract.test.ts`
- **First read & shortest trace (~550 lines across sampled tests + implementation hunks):** Inspect `git log -p --since="2026-11-17"` on the sampled test files alongside their corresponding implementation commits to check whether each test exercises the real production function or only asserts prompt substrings, mocked wiring echoes, or pre-existing return values.
- **Question:** Which tests added between `2026-11-17` and `2026-11-20` in `tools/factory/` and `apps/engine/` would still pass if the production behavior they claim to test were removed or broken (e.g., asserting a string literal in a prompt template instead of behavioral parsing, mocking out the unit under test, or asserting only `not toThrow` / mock call arguments)?
- **How to prove it:**
  1. Read each sampled test file and trace the exact production symbol it calls vs mocks.
  2. Verify whether reverting the core branch/guard in mental/read-only trace (and running the existing test suite via Terminal Commander `run_and_watch` to confirm current pass state) leaves the test green or only pins source-text wording.
  3. Target file for new failing test: the respective `test_*.py` or `*.test.ts` file where the vacuous test lives.
- **Fix questions to answer if confirmed:**
  - How should each vacuous test be rewritten into a behavioral test that fails when the feature is removed, and what gap in `redgreen.py` allowed that PR to pass `Done-test red before green`?
- **Severity if confirmed:** **Medium** — regressions ship silently and prove how coworkers game `red-green.yml`.
- **Evidence rule:** Quote both the test (`path:line`) and the production code (`path:line`), explaining why removing the behavior leaves the assertion satisfied (or why only wording is tested).

---

### `F22` — Dockerfiles & Compose Images: Runtime User, Layer Secrets & Version Pinning
- **Covers:** Prompt item F.22
- **Where:**
  - `apps/engine/Dockerfile`, `apps/ui/Dockerfile`, `deploy/vps/factory-runner.Dockerfile`, `.dockerignore`
  - `docker-compose.yml`, `deploy/vps/docker-compose.vps.yml`, `deploy/vps/factory-dispatcher.yml`, `deploy/vps/factory-runner.yml`, `deploy/vps/factory-app.yml`, `deploy/vps/dev-engine.yml`
- **First read & shortest trace (~220 lines):** Read `apps/engine/Dockerfile:1-36`, `apps/ui/Dockerfile:1-35`, `deploy/vps/factory-runner.Dockerfile:1-16`, `.dockerignore`, and `deploy/vps/docker-compose.vps.yml:1-46`.
- **Question:** Do `apps/ui/Dockerfile`, `apps/engine/Dockerfile`, `deploy/vps/factory-runner.Dockerfile`, or `docker-compose*.yml` (1) run containers as `root` (`apps/ui/Dockerfile:30-35` has NO `USER` directive and `webgate` in `docker-compose.vps.yml:28-38` runs `node:26-alpine` as `root`!), (2) bake secrets or `.env` / `.git` files into image layers (`COPY . .` vs `.dockerignore`, `ARG NEXT_PUBLIC_ADMIN_EMAILS` in `apps/ui/Dockerfile:11,19`), or (3) use unpinned floating tags (`searxng/searxng:latest` in `docker-compose.vps.yml:41`, `node:26-trixie-slim` / `node:26-bookworm-slim` / `node:26-alpine` / `apt-get` packages)?
- **How to prove it:**
  1. Inspect `.dockerignore` to verify `.env*`, `.git`, `.review`, `cloud/`, secrets, and local SQLite DBs cannot enter `COPY . .` in `apps/ui/Dockerfile:24` or `apps/engine/Dockerfile:7` — and note `apps/ui/Dockerfile:32` (`COPY --from=build /app /app`) copies the entire monorepo source tree + devDependencies into the final production UI image running as `root`!
  2. Check `USER` directives, `ARG`/`ENV` persistence in final image layers, and image tag pinning across all Dockerfiles and compose files.
  3. Run `pnpm --filter rerun-engine exec vitest run src/deploy-config.test.ts` via Terminal Commander `run_and_watch`.
  4. Target file for new failing test: `apps/engine/src/deploy-config.test.ts` or `tools/factory/test_deploy_files.py`.
- **Fix questions to answer if confirmed:**
  - How should `apps/ui/Dockerfile` switch to a non-root `USER` (and Next.js standalone or pruned output) and how should `webgate` / `searxng:latest` pin digests/versions without breaking `deploy/vps/update.sh`?
- **Severity if confirmed:** **Medium** (High if `.dockerignore` misses `.env` or if `apps/ui` SSRF/RCE lands straight as container `root` with full monorepo tools) — root container execution, bloated attack surface, and unpinned `searxng:latest` supply-chain drift.
- **Evidence rule:** Quote exact `Dockerfile:line`, `.dockerignore:line`, and `docker-compose*.yml:line`.

---

## Execution Order & Bounded Reading Estimate

The review session executes the 34 ledger items in the exact order below (grouped by failure cost while reusing hot file context across adjacent items). Total estimated targeted reading: **~12,590 lines** across 34 bounded passes (average ~370 lines/item; every item ≤550 lines).

| Step | Item ID | Prompt Mapping | Domain / Focus | Est. Reading Budget | Primary Test Suite / Check Command |
|---:|---|---|---|---|---|
| 1 | `A1a` | A.1 (part 1) | Coworker shell container/FS/`/proc`/network escape | ~260 lines (7 files) | `vitest run src/tools/builtin/shell.test.ts src/config/env.test.ts` |
| 2 | `A1b` | A.1 (part 2) | Untrusted text -> `shell_exec` / CLI `Bash` paths | ~380 lines (7 files) | `vitest run src/tools/registry.test.ts src/agents/providers.test.ts` |
| 3 | `A2` | A.2 | `process-env.ts` & child/MCP secret over-sharing | ~250 lines (6 files) | `vitest run src/agents/process-env.test.ts src/lib/child-env.test.ts` |
| 4 | `A5` | A.5 | Connection tokens at rest, refresh, errors, digests | ~420 lines (9 files) | `vitest run src/connections/claude-token.test.ts src/db/repos/redact.test.ts` |
| 5 | `B6a` | B.6 (part 1) | Supabase RLS, grants & `SECURITY DEFINER` matrix | ~450 lines (SQL + types) | Read-only SQL policy matrix + `supabase/tests/space_access.test.sql` |
| 6 | `B6b` | B.6 (part 2a) | `serviceRole` in UI routes, pages & `'use server'` actions | ~500 lines (14 files) | `vitest run app/api/_auth/access.test.ts supabase/supabase-helpers.test.ts` |
| 7 | `B6c` | B.6 (part 2b) | `serviceRole` in `_services/` & `/api/hub` foreman token | ~480 lines (9 files) | `vitest run app/api/hub/route.test.ts` |
| 8 | `B7` | B.7 | Engine HTTP auth, desktop tokens, `foremanGuard`, isolation | ~460 lines (10 files) | `vitest run src/http/auth.enabled.test.ts src/http/foreman-guard.test.ts` |
| 9 | `X1` | Added (Rule 5) | SSRF DNS rebinding (`fetchPublic`) & `published-site` XSS/auth | ~420 lines (6 files) | `vitest run src/lib/public-fetch.test.ts` + `app/api/fetch/route.test.ts` |
| 10 | `X2` | Added (Rule 5) | Coworker tar `import.ts` / `archive.ts` symlink & secret scrub | ~380 lines (4 files) | `vitest run src/agents/import.test.ts src/agents/archive.test.ts` |
| 11 | `X3` | Added (Rule 5) | Desktop Electron IPC origin guard, `openExternal` & deep links | ~360 lines (6 files) | `pnpm --filter rerun-desktop test` |
| 12 | `C15` | C.15 | Factory prompt injection & untrusted GitHub comment ingestion | ~480 lines (7 files) | `unittest tools/factory/test_instructions.py tools/factory/test_acceptance.py` |
| 13 | `B8` | B.8 | Webhooks & triggers: signatures, replay & unauth start | ~380 lines (7 files) | `vitest run src/http/routes/triggers.auth.test.ts` + webhook route tests |
| 14 | `B9a` | B.9 (part 1) | Rename drift: cookies (2026-11-19 drop), headers, CORS, hosts | ~430 lines (10 files) | `vitest run proxy.test.ts supabase/middleware.test.ts` |
| 15 | `B9b` | B.9 (part 2) | Rename drift: `RERUN_` vs `MOLDWRIGHT_` env, connections, deploy | ~450 lines (11 files) | `vitest run src/deploy-config.test.ts src/connections/migrate.test.ts` |
| 16 | `X4` | Added (Rule 5) | Engine SQL browser & raw SQL guard bypass (`sqlStore.ts`) | ~360 lines (5 files) | `vitest run src/db/sqlStore.test.ts src/http/routes/data.sql.test.ts` |
| 17 | `E18` | E.18 | Supabase migrations ordering, destructive DDL & types parity | ~420 lines (SQL + types) | Read-only Python migration/types cross-check |
| 18 | `E19` | E.19 | Engine libsql concurrency, `"client is closed"` & DB migrations | ~400 lines (8 files) | `vitest run src/db/systemDb.test.ts src/db/ladder.test.ts` |
| 19 | `F21` | F.21 | Root VPS scripts (`update.sh`, `keeper.sh`, `doctor.sh`) & CRLF | ~440 lines (6 files) | `unittest tools/factory/test_keeper.py tools/factory/test_doctor.py` |
| 20 | `C10` | C.10 | `dispatch.py` `checks()` merge SHA, head-move & `dev_hold` | ~420 lines (3 files) | `unittest tools/factory/test_dispatch.py tools/factory/test_merge_dev_gate.py` |
| 21 | `C11` | C.11 | `labelcheck.fix` & `close_gaps` caps, `busy()` & `covered()` | ~280 lines (3 files) | `unittest tools/factory/test_labelcheck.py tools/factory/test_drift.py` |
| 22 | `C12` | C.12 | `acceptance.py` open children/gaps closure & `revive` bounds | ~300 lines (3 files) | `unittest tools/factory/test_acceptance.py tools/factory/test_dispatch_acceptance.py` |
| 23 | `C13` | C.13 | `dev_healed` workflow-ID self-heal vs path/conditional jobs | ~260 lines (5 files) | `unittest tools/factory/test_dispatch_devresult.py tools/factory/test_problems.py` |
| 24 | `C14a` | C.14 (part 1) | `store.py` autocommit crash windows in `dispatch` & `runner_loop` | ~480 lines (3 files) | `unittest tools/factory/test_store.py tools/factory/test_dispatch_crash.py` |
| 25 | `C14b` | C.14 (part 2) | `store.py` `kv` loop crash windows in `planning`/`acceptance`/`resolver` | ~460 lines (4 files) | `unittest tools/factory/test_planning_cut.py tools/factory/test_resolver.py` |
| 26 | `D16` | D.16 | CI gates (`no-stubs`, `no-comments`, `red-green`, `refactor-frozen`) | ~360 lines (9 files) | `unittest` on `no-stubs`, `test_redgreen.py`, `test_refactorcheck.py` |
| 27 | `X5` | Added (Rule 5) | GitHub Actions runner routing, `${{ }}` injection & cache scope | ~220 lines (6 files) | Static workflow audit + `test_deploy_files.py` |
| 28 | `X6` | Added (Rule 5) | `resolveWithinReal` TOCTOU, `RERUN_FS_EXTRA_ROOTS` & `mcp-packages` | ~380 lines (6 files) | `vitest run src/tools/sandbox.test.ts src/tools/mcp-packages.test.ts` |
| 29 | `X7` | PR #1688 | `customEndpointFetch`, `refusal-body`, `mcp` paging & `mcp-auth`/`self` | ~360 lines (6 files) | `vitest run src/agents/custom-endpoint-fetch.test.ts src/tools/mcp.test.ts src/tools/mcp-auth.test.ts` |
| 30 | `A3` | A.3 | `redactSecrets` reliance & DB/CLI transcript redaction gaps | ~200 lines (5 files) | `vitest run src/tools/builtin/shell.test.ts src/db/repos/redact.test.ts` |
| 31 | `A4` | A.4 | `sandbox.ts` command block-list static bypass inventory | ~120 lines (3 files) | `vitest run src/tools/sandbox.test.ts` |
| 32 | `E20` | E.20 | `moves` table `"since"` timestamps & `registry.py` `ORDER` precedence | ~260 lines (2 files) | `unittest tools/factory/test_registry.py tools/factory/test_storeread.py` |
| 33 | `D17` | D.17 | Vacuous / tautological newest tests (`2026-11-17..2026-11-20`) | ~550 lines (27 tests) | Run sampled vitest + unittest files via Terminal Commander |
| 34 | `F22` | F.22 | Dockerfiles (`USER`, `.dockerignore`, layer secrets, pinned tags) | ~220 lines (8 files) | `vitest run src/deploy-config.test.ts` |

*(Total: 34 bounded execution steps covering all 22 mandatory prompt items `A.1`–`F.22` with zero omissions plus 7 added high-impact surfaces `X1`–`X7`, ~12,590 lines total bounded reading, ~370 lines average per step.)*

---

## Exact Output Directory Layout & File Templates

All review session outputs are written exclusively inside `docs/research/2026-11-20-code-review/`:

```text
docs/research/2026-11-20-code-review/
├── LEDGER.md
├── SUMMARY.md
└── findings/
    ├── A1a-<short-kebab-name>.md          # One file per distinct confirmed finding on item A1a (if >1 issue in A1a, suffix -1, -2 or distinct slug)
    ├── A1a-cleared.md                     # Written ONLY when an item has zero confirmed/unproven findings
    ├── A1b-<short-kebab-name>.md
    ...
    └── F22-<short-kebab-name>.md
```

### 1. Confirmed (or Unproven-Flagged) Finding File Template (`docs/research/2026-11-20-code-review/findings/<item-id>-<short-name>.md`)

Every confirmed problem (and any suspected problem whose runtime proof requires live infrastructure unavailable offline, marked `Confidence: unproven`) gets its own file with these exact six sections:

```markdown
# `<item-id>`: <Short Descriptive Title>

- **Finding:** <One plain sentence stating what is wrong and where.>

## Evidence

- `<repo-relative-path>:<start-end>`:
  ```<lang>
  <exact verbatim lines read from the repository>
  ```
- **Command / test run:** `<exact read-only command or test executed>`
  ```text
  <actual observed stdout/stderr summary and exit code>
  ```

## Trigger

<Concrete input, state, HTTP request, GitHub comment/PR state, or crash point and caller that makes the bug happen.>

## Impact and severity

- **Severity:** `critical` | `high` | `medium` | `low`
- **Impact:** <What goes wrong, what asset/invariant fails, and who is harmed (paying workspace users, self-hosted operators, or the Moldwright factory).>

## Proposed fix

- **Smallest causal change (`<path>` — `<function/symbol>`):**
  <Exact description or diff sketch removing the root cause, obeying `CLAUDE.md` rules (no code comments unless genuinely non-obvious, typed Supabase helpers/generics, data-dir migration step if on-disk format changes).>
- **Must not break:** <Specific callers, workflows, self-hosted OSS fallbacks, or legitimate coworker workflows that must keep working.>
- **Failing test that proves the fix:**
  - **File:** `<exact existing or new test file path>`
  - **Test name:** `<test_... or it('...')>`
  - **Assertion:** <Exact setup, call, and assertion that fails on today's `dev` and passes with the fix.>
- **Alternative fix and trade-off:** <Alternative design (if one exists) and why it was not chosen or when to prefer it.>

## Confidence

`proven` | `unproven — <exact live check, kernel/container test, or fixture needed to prove or clear it>`
```

### 2. Cleared Item File Template (`docs/research/2026-11-20-code-review/findings/<item-id>-cleared.md`)

Every item that holds with zero findings still gets a file so cleared items and unreviewed items can never be confused:

```markdown
# `<item-id>`: Cleared — <Item Title>

- **Status:** `cleared`
- **Checked:**
  - `<path>:<lines>` (`<symbol>`)
  - `<command / test run and exit status>`
- **Why it holds:** <2–5 plain sentences citing the exact `path:line` guards, invariants, and passing tests that prevent the failure mode asked in the ledger.>
```

### 3. Final Summary Layout (`docs/research/2026-11-20-code-review/SUMMARY.md`)

Written after Step 34 completes:

```markdown
# Moldwright Code Review Summary (`2026-11-20`, branch `dev`, commit `c1d28545`)

## Findings (Ordered by Severity: Critical -> High -> Medium -> Low)

| ID | Severity | Finding | Proposed Fix | File |
|---|---|---|---|---|
| `<id>` | `critical` | <one-line finding> | <one-line fix> | `docs/research/2026-11-20-code-review/findings/<id>-<slug>.md` |

## Cleared Items

| ID | Title | Proof File | What Holds It |
|---|---|---|---|
| `<id>` | <item title> | `docs/research/2026-11-20-code-review/findings/<id>-cleared.md` | <one-line guard summary with `path:line`> |

## Unreviewed Items

- `cloud/*` — Not present in this checkout (git-ignored private Rerun Cloud overlay); only `apps/ui/cloud-oss/*` self-hosted twins were reviewed.
```
