# `A5`: `writeConfig` Leaves `connection.json` World-Readable (`0o644`) and Custom/Provider Error Paths Can Echo Unredacted Upstream Bodies Into `runs.error`

- **Finding:** `writeConfig` in `apps/engine/src/connections/store.ts` writes `connection.json` (including private custom `baseUrl` endpoints) without `mode: 0o600` (and `DATA_DIR_MIGRATIONS` step 4 skips `connections/`), while `loop.ts` persists `errorMessageOf(settlement.error)` into `runs.error` and SSE notifications without passing it through `redactSecrets(..., runSecrets(agent))`.

## Evidence

- `apps/engine/src/connections/store.ts:28-33`:
  ```ts
  async function writeConfig(id: string, config: ConnectionConfig): Promise<void> {
      const target = connectionConfigPath(id)
      const tmp = `${target}.tmp`
      await writeFile(tmp, `${JSON.stringify(config, null, 4)}\n`, 'utf8')
      await rename(tmp, target)
  }
  ```
- `apps/engine/src/datadir/migrations.ts:71-83`:
  ```ts
      {
          version: 4,
          id: 'secret-file-modes',
          up: async () => {
              for (const id of await listAgentFolders()) {
                  await chmodRegular(configPath(id), 0o600, 'file')
                  const mcp = mcpDir(id)
                  for (const name of await listDirOrEmpty(mcp)) {
                      if (name.endsWith('.json')) await chmodRegular(resolve(mcp, name), 0o600, 'file')
                  }
                  await chmodRegular(mcp, 0o700, 'dir')
              }
          },
      },
  ```
- `apps/engine/src/runtime/loop.ts:376-388,400-409` (compare with `toolErrorText` at `loop.ts:175-178` which *does* call `redactSecrets`):
  ```ts
              const errorCode = settlement.errorCode ?? null
              const errorMessage = errorMessageOf(settlement.error)
              forgetCodexThread(agent.id, sessionId)
              logger.error({ err: errorMessage, errorCode, agent: agent.id, run: run.id }, 'run error')
              ...
              await failRun(agent.id, run.id, errorMessage).catch(() => {})
              outcome = { kind: 'error', error: errorMessage, errorCode }
  ```
- `apps/engine/src/connections/claude-token.ts:48-50`:
  ```ts
          const dead = res.status === 400 || res.status === 401
          logger[dead ? 'error' : 'warn']({ connection: connection.id, status: res.status, error: data.error, description: data.error_description, hasAccessToken: !!data.access_token }, 'claude token refresh failed')
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/connections/claude-token.test.ts src/connections/codex-auth.test.ts src/db/repos/redact.test.ts src/runtime/provider-errors.test.ts`
  ```text
   ✓ src/connections/claude-token.test.ts (passed)
   ✓ src/connections/codex-auth.test.ts (passed)
   ✓ src/db/repos/redact.test.ts (passed)
   ✓ src/runtime/provider-errors.test.ts (passed)
  ```
  *(Note: `store.test.ts` passed 8/9 tests on Windows; its single failure `expected 438 (0o666) to be 384 (0o600)` is a known Windows NTFS `stat().mode` behavior where POSIX `chmod(0o600)` is a no-op on Windows.)*

## Trigger

*(What holds: `writeEnvFile` in `lib/env-file.ts:38-39` and `writeAuthFile` in `codex-auth.ts:43` set `0o600` on Linux, `toSummary` in `connections/loader.ts:42-53` never returns `.env` values over HTTP, `archive.ts:30` scopes exports strictly to `agents/<id>/`, and `claude-token.ts:49` / `codex-auth.ts:69` log only boolean `hasAccessToken` + OAuth `error`/`error_description` on refresh failure.)*

Two concrete gaps remain:
1. **Unredacted `errorMessage` on run failure (`loop.ts:376,387,408`) -> logs, `runs.error`, and factory GitHub comments/digests:** While `toolErrorText` (`loop.ts:177`) and `saveHandover` (`loop.ts:521`) call `redactSecrets(..., runSecrets(agent))`, `settle()` in `loop.ts:376` writes raw `errorMessageOf(settlement.error)` (which includes `upstreamReason` / `refusalMessageOf(text)` from custom/OpenCode/OpenRouter endpoints or CLI stderr when `APICallError` / CLI subprocess fails) directly to `logger.error`, `failRun` (`runs.error`), `emitRunTerminal`, and from there to `dispatch.py` (`finished_run` -> `note_failures` -> `failures.reason` -> `digest.py` GitHub issue comment!). If an upstream proxy, custom endpoint, or CLI crash echoes the `Authorization: Bearer ...` header or an API key in its error message (as several proxies and curl/SDK errors do on malformed headers or 401s), that token is written verbatim into SQLite `runs.error`, engine logs, and the factory's GitHub failure records.
2. **Pre-existing `connections/` directories and `connection.json` modes (`migrations.ts:71-83`, `store.ts:31`):** `DATA_DIR_MIGRATIONS` v4 (`secret-file-modes`) tightened `agents/<id>/config.json` and `mcp/*.json` to `0o600`, but omitted `/data/connections/` (`connections/<id>/.env` created before `0o600` enforcement or restored from older backups, `connections/<id>/connection.json` holding custom `baseUrl` with embedded query/basic-auth credentials if a user enters `https://user:pass@host/v1`).

## Impact and severity

- **Severity:** `medium` (escalates to `high` if an upstream gateway echoes a rejected Bearer token in its 401/502 error text during a factory run, publishing it to `runs.error` and `failures`)
- **Impact:** Connection tokens or embedded `baseUrl` credentials echoed in provider/CLI failure messages bypass `runSecrets(agent)` redaction and persist in `system.db` (`runs.error`), `logger.error`, UI error banners, and factory failure logs.

## Proposed fix

- **Smallest causal change (`apps/engine/src/runtime/loop.ts`, `apps/engine/src/connections/store.ts`, `apps/engine/src/datadir/migrations.ts`):**
  1. In `apps/engine/src/runtime/loop.ts:376`, pass the final run error string through `redactSecrets(errorMessageOf(settlement.error), runSecrets(agent))` before `logger.error`, `failRun`, and `emitRunTerminal`.
  2. In `apps/engine/src/connections/store.ts:31,49`, pass `{ mode: 0o600 }` (or `writeFileAtomic(target, ..., { mode: 0o600 })`) in `writeConfig`, reject `url.username || url.password` in `assertCustomHasBaseUrl` (require keys in `.env` instead of URL userinfo), and append a new `DATA_DIR_MIGRATIONS` step (`version: 5, id: 'connection-file-modes'`) that applies `0o700` to `connectionDir(id)` and `0o600` to `connection.json`, `.env`, and `.codex/auth.json`.
- **Must not break:** `classifyProviderError` in `loop.ts:582` (which runs *before* `settle()` formats `errorMessage`, so error codes like `provider_unauthorized` and `provider_usage_limit` still classify accurately).
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/runtime/provider-errors.test.ts` (or `apps/engine/src/runtime/loop.settle.test.ts`)
  - **Test name:** `it('redacts connection and agent secrets from runs.error when a provider error echoes the token')`
  - **Assertion:** Run `runAgent` with a connection holding `OPENROUTER_API_KEY: 'or-test-key-placeholder'` where the mocked model throws `new Error('401 Invalid token or-test-key-placeholder')`; assert the persisted `runs.error` and `outcome.error` contain `'401 Invalid token [redacted]'` and never `'or-test-key-placeholder'`.
- **Alternative fix and trade-off:** Strip all upstream error messages on 401/403 to a static generic string (`"Authentication failed"`). Prevents any unknown secret echo too, at the cost of hiding diagnostic reason codes (e.g. `"organization_suspended"` vs `"invalid_api_key"`).

## Confidence

`proven`
