# `A2`: `agentProcessEnv`, `claudeProvider`, and `codexShared` Expose `shared.env` Secrets, `CLAUDE_CODE_OAUTH_TOKEN`, and Unfiltered `process.env` Keys to Coworker Subprocesses

- **Finding:** Every coworker's `shell_exec`, stdio MCP server, and CLI model harness receives the entire `/data/shared.env` (including `GH_TOKEN` wired as a global git credential helper), while `claudeProvider` additionally leaks both `CLAUDE_CODE_OAUTH_TOKEN` and the engine's own `process.env` into Claude Code's `Bash` and MCP child processes because it omits `childProcessEnv()`.

## Evidence

- `apps/engine/src/agents/process-env.ts:8-14,20-30`:
  ```ts
  const GIT_HELPER_KEY = 'credential.https://github.com.helper'
  const GIT_HELPER = '!f() { if [ "$1" = get ]; then echo username=x-access-token; echo "password=$GH_TOKEN"; fi; }; f'

  export function githubCredentialEnv(env: Record<string, string>): Record<string, string> {
      if (!env.GH_TOKEN || env.GIT_CONFIG_COUNT !== undefined) return env
      return { ...env, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: GIT_HELPER_KEY, GIT_CONFIG_VALUE_0: '', GIT_CONFIG_KEY_1: GIT_HELPER_KEY, GIT_CONFIG_VALUE_1: GIT_HELPER }
  }
  ...
  export function agentProcessEnv(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>, labels?: Record<string, string>): AgentProcessEnv {
      ...
      const env: Record<string, string> = { ...readSharedEnvSync(), ...agent.env, ...labels, RERUN_AGENT_DB: agentDataDbPath(agent.id), RERUN_WORKSPACE: cwd }
      ...
      return { cwd, env: githubCredentialEnv(env) }
  }
  ```
- `apps/engine/src/agents/providers.ts:122-123,290-297,316`:
  ```ts
    'shell_environment_policy.inherit': 'all',
    'shell_environment_policy.ignore_default_excludes': true,
  ...
            env: {
                ...agentEnv,
                ...CLAUDE_HARNESS_ENV,
                ...claudeAuthEnv(connectionEnv(agent)),
                ANTHROPIC_API_KEY: undefined,
                MCP_TOOL_TIMEOUT: String(BRIDGE_TOOL_TIMEOUT_SEC * 1000),
                ...compactEnvFor(options.compactAt ?? compactAtTokens(agent.config.contextSize) ?? 'off'),
            },
  ...
        env: envOverlay(childProcessEnv(agentEnv, { CODEX_HOME: codexHomeDir(agent.resolved.connection?.id ?? RERUN_CONNECTION_ID) })),
  ```
- `apps/engine/src/tools/mcp-pool.ts:149-152` and `apps/engine/src/tools/mcp.ts:42-43`:
  ```ts
  export function agentMcpSpawn(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>): McpSpawn {
      const { cwd, env } = agentProcessEnv(agent)
      return { cwd, env: childProcessEnv(env) }
  }
  ...
        const env = { ...spawn.env, ...server.env }
        return new StdioClientTransport({ command: server.command, args: server.args, env, cwd: spawn.cwd })
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/agents/process-env.test.ts src/lib/child-env.test.ts`
  ```text
   ✓ src/agents/process-env.test.ts (passed)
   ✓ src/lib/child-env.test.ts (passed)
  ```

## Trigger

1. **Unconditional `shared.env` broadcast to every coworker and third-party stdio MCP server:** Any secret placed in `/data/shared.env` (such as `GH_TOKEN`, API keys, database URLs) is merged into `agentProcessEnv` (`process-env.ts:24`) for **every** coworker — including read-only planners, reviewers, Foremen, and third-party `npx` stdio MCP servers (`mcp-pool.ts:150`, `mcp.ts:42`) that have no business holding `GH_TOKEN` or sibling service keys. For example, a planner or reviewer coworker that should never push branches or merge PRs receives the exact same write-capable `GH_TOKEN` as a builder or dispatcher helper.
2. **`claudeProvider` omits `envOverlay(childProcessEnv(...))` (`providers.ts:290-297`):** Unlike `shell.ts:36` (`childProcessEnv(agentEnv)`) and `codexShared` (`providers.ts:316` `envOverlay(childProcessEnv(...))`), `claudeProvider` passes `env: { ...agentEnv, ...claudeAuthEnv(...) }` directly to the Anthropic Agent SDK (`createClaudeCode`). In the Agent SDK, `options.env` is merged on top of the Node parent `process.env` (`{ ...process.env, ...options.env }`), so any secret in the engine's `process.env` (e.g. `RERUN_PAIR_TOKEN`, `RERUN_HUB_URL`, or non-file `RERUN_API_KEY` in local/custom setups) plus `CLAUDE_CODE_OAUTH_TOKEN` itself is inherited by every stdio MCP subprocess (`nativeMcpEntry` in `providers.ts:147`) spawned by Claude Code!
3. **Dangerous env-var overrides via `agent.env`:** Neither `serializeEnv` (`lib/env-file.ts:20-29`) nor `agentProcessEnv` (`process-env.ts:24`) blocks `NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, `GIT_SSH_COMMAND`, or `HTTP_PROXY` in `agent.env` / `shared.env`.

## Impact and severity

- **Severity:** `high`
- **Impact:** Violates least privilege across every coworker and stdio MCP server: a compromised third-party `npx` MCP package or read-only coworker immediately inherits `GH_TOKEN` (with git push/API rights) and all `shared.env` secrets, and Claude-backed coworkers' native MCP children inherit `CLAUDE_CODE_OAUTH_TOKEN` and unfiltered engine `process.env` variables.

## Proposed fix

- **Smallest causal change (`apps/engine/src/agents/providers.ts`, `apps/engine/src/agents/process-env.ts`, `apps/engine/src/tools/mcp-pool.ts`):**
  1. In `claudeProvider` (`apps/engine/src/agents/providers.ts:290`), wrap `env` with `envOverlay(childProcessEnv(agentEnv, { ...CLAUDE_HARNESS_ENV, ...claudeAuthEnv(connectionEnv(agent)), MCP_TOOL_TIMEOUT: String(BRIDGE_TOOL_TIMEOUT_SEC * 1000), ...compactEnvFor(...) }))` (matching `codexShared` at `providers.ts:316`) so parent `process.env` keys are blanked out.
  2. In `agentMcpSpawn` (`apps/engine/src/tools/mcp-pool.ts:149`), pass only `childProcessEnv({})` (plus explicit `${VAR}` references resolved by `resolveServerSecrets` in `mcp.ts:112`) instead of `agentProcessEnv(agent)`, so third-party stdio MCP servers receive only the secrets explicitly referenced in their config rather than all of `shared.env` and `agent.env`.
  3. Add an optional `sharedEnvKeys?: string[]` allowlist on `agentConfigSchema` (or strip `GH_TOKEN` for read-only coworkers where not needed) and reject `LD_PRELOAD` / `NODE_OPTIONS` in `updateAgentEnv` unless admin-authorized.
- **Must not break:** Stdio MCP servers that explicitly configure `env: { API_KEY: "${MY_KEY}" }` (already resolved via `resolveServerSecrets` in `mcp.ts:112`); Claude Code OAuth authentication (`CLAUDE_CODE_OAUTH_TOKEN` still reaches Claude Code itself).
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/agents/providers.test.ts` (and `apps/engine/src/tools/mcp-pool.test.ts`)
  - **Test name:** `it('blanks parent process.env secrets in claudeProvider env overlay and excludes unreferenced shared.env secrets from stdio MCP spawn')`
  - **Assertion:** Set `process.env.RERUN_PAIR_TOKEN = 'secret-pair-token'` and write `GH_TOKEN=ghs_sharedsecret` to `shared.env`; assert `claudeProvider` sets `env.RERUN_PAIR_TOKEN === ''` and `agentMcpSpawn(agent).env.GH_TOKEN === undefined`.
- **Alternative fix and trade-off:** Deprecate global `/data/shared.env` entirely in favor of explicit `services` / `connections` bindings per coworker. Cleaner long-term model, but requires migrating `deploy/vps/SHARED-ENV.md` and factory setup scripts.

## Confidence

`proven`
