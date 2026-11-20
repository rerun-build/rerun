# `B6b`: `applyFilters` in `@moldwright/db/helpers` Silently Drops `undefined` Filter Keys on `serviceRole` Queries and `attachServerManually` / `redeemPairingToken` Allow Internal SSRF Engine URLs

- **Finding:** `applyFilters` in `packages/db/src/helpers.ts` silently skips any filter entry whose value is `undefined` instead of throwing, and `servers.service.ts` (`attachServerManually` / `redeemPairingToken`) stores and dials unvalidated internal URLs (`http://engine:3000`, `http://webgate:8080`, `http://[IP_ADDRESS]`) in `engine_pool` via `createServiceRoleClient()`.

## Evidence

- `packages/db/src/helpers.ts:70-80`:
  ```ts
  function applyFilters<T extends TableName>(query: any, filters: Filters<T>) {
      for (const [key, value] of Object.entries(filters)) {
          if (value === undefined) continue

          if (key === 'or' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
              const conditions = Object.entries(value as Record<string, unknown>)
                  .filter(([, v]) => v !== undefined)
                  .map(([col, v]) => orCondition(col, v))
              if (conditions.length > 0) query = query.or(conditions.join(','))
              continue
          }
  ```
- `apps/ui/app/api/_services/servers.service.ts:41-55,75-95` and `apps/ui/lib/engine/base-url.ts:3-8`:
  ```ts
  async function checkReachable(baseUrl: string, apiKey: string): Promise<EngineHealth> {
      const conn = { baseUrl, apiKey }
      let health: EngineHealth
      try {
          health = await getEngineHealth(conn)
      } catch {
          throw new ServerPairingError('serverUnreachable', 422, { url: baseUrl })
      }
  ...
  export async function attachServerManually(workspaceId: number, input: { url: string; apiKey: string }): Promise<void> {
      if (await findWorkspaceEngine(workspaceId)) throw new ServerPairingError('workspaceHasServer', 409)
      const baseUrl = buildBaseUrl(input.url)
      await checkReachable(baseUrl, input.apiKey.trim())
      await attachCustomEngine(workspaceId, { engineHost: baseUrl, engineApiKey: input.apiKey.trim() })
  }
  ```
- `apps/ui/app/api/engines/pair/route.ts:14-17,26`:
  ```ts
  function callerIp(req: Request): string | null {
      const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      return forwarded || req.headers.get('x-real-ip')?.trim() || null
  }
  ...
          const { workspaceId } = await redeemPairingToken({ token: parsed.data.token, apiKey: parsed.data.apiKey, url: engineAddress(parsed.data.url, callerIp(req)) })
  ```
- **Command / test run:** `pnpm --filter ./apps/ui exec vitest run --maxWorkers=2 app/api/_auth/access.test.ts app/api/_auth/ownership.test.ts supabase/supabase-helpers.test.ts app/api/hub/route.test.ts`
  ```text
   ✓ app/api/_auth/access.test.ts (25 tests) 9ms
   ✓ app/api/_auth/ownership.test.ts (18 tests) 10ms
   ✓ supabase/supabase-helpers.test.ts (13 tests) 6ms
   ✓ app/api/hub/route.test.ts (15 tests) 14ms
   Test Files  4 passed (4)
        Tests  71 passed (71)
  ```

## Trigger

1. **SSRF & internal-engine probing on self-hosted / multi-workspace installs (`servers.service.ts:75,93`):** On any install where `SERVERS_ENABLED === true` (`apps/ui/cloud-oss/servers.ts:1`), any workspace admin (including a newly signed-up user who created their own second workspace via `createWorkspaceAction` in `workspace.actions.ts:113`) can call `attachServerManuallyAction({ url: 'http://engine:3000', apiKey: '...' })` or `POST /api/engines/pair` with `url: 'http://webgate:8080'` / `http://[IP_ADDRESS]/...` / `http://supabase-db:5432`. `checkReachable` immediately issues server-side HTTP requests from the `app` container onto the internal Docker network without `assertPublicUrl` (`public-fetch.ts`), distinguishing `serverUnreachable` (connection refused/timeout) from `serverRefusedKey` (HTTP 200 on `/health` followed by 401 on `/connections`), and if the target engine has no `RERUN_API_KEY` set (`auth.ts:22`), attaches another container's internal engine to the attacker's workspace!
2. **Silent `undefined` filter elision in `applyFilters` (`packages/db/src/helpers.ts:72`):** Every `selectSingle` / `selectMaybeSingle` / `selectMany` read in `apps/ui` runs on `createServiceRoleClient()` (bypassing RLS). Because `Filters<T>` uses optional keys (`[K in keyof TableRow<T>]?: ...`), passing `{ workspace_id: maybeId }` when `maybeId` is `undefined` at runtime silently drops the `WHERE workspace_id = ...` clause and queries across **all** tenants (`selectFirst` / `selectMaybeSingle` returning another customer's row or `selectMany` returning the whole table). Today's callers in `_actions/` and `route.ts` pass validated `ctx.workspace.id` / `ctx.user.id`, so no active cross-tenant read leak was triggered in current routes, making `applyFilters` a latent footgun on `serviceRole` queries.

## Impact and severity

- **Severity:** `high`
- **Impact:** Internal Docker/cloud-metadata SSRF port/service oracle (and takeover of any unkeyed internal engine) from `attachServerManuallyAction` / `/api/engines/pair` whenever `SERVERS_ENABLED` is true, plus a single-`undefined` catastrophic fail-open behavior in the shared `serviceRole` query helper.

## Proposed fix

- **Smallest causal change (`apps/ui/app/api/_services/servers.service.ts`, `packages/db/src/helpers.ts`):**
  1. In `servers.service.ts:41` (`checkReachable`), validate `baseUrl` against a public-IP / non-internal-hostname guard (reusing the non-private IP + DNS resolution check from `public-fetch.ts`, allowing RFC1918/Docker hosts only when an explicit self-host env var like `RERUN_ALLOW_PRIVATE_ENGINE_URLS=1` is set by the operator).
  2. In `packages/db/src/helpers.ts:72`, reject explicit keys with `undefined` or `Number.isNaN(value)` values when `key in filters` (or require `null` / `{ isNull: true }` and omit keys via conditional spread `...(x ? { col: x } : {})` rather than `{ col: undefined }`), throwing an immediate error instead of dropping the `WHERE` predicate.
- **Must not break:** `cloud-oss/engines.ts` `claimPoolEngine` (which reads operator-configured `process.env.RERUN_ENGINE_URL` directly without calling `attachServerManually`); existing callers of `select*` that omit optional filter properties rather than passing `{ key: undefined }`.
- **Failing test that proves the fix:**
  - **File:** `apps/ui/app/api/_services/servers.service.test.ts` (and `apps/ui/supabase/supabase-helpers.test.ts`)
  - **Test name:** `it('refuses internal loopback, metadata, and Docker-internal URLs in attachServerManually and redeemPairingToken')`
  - **Assertion:** Call `attachServerManually(7, { url: 'http://[IP_ADDRESS]', apiKey: 'a'.repeat(32) })` and `attachServerManually(7, { url: 'http://[IP_ADDRESS]:3000', apiKey: 'a'.repeat(32) })`; assert both throw `ServerPairingError` before `getEngineHealth` is called. In `supabase-helpers.test.ts`, pass `{ workspace_id: Number.NaN }` and `{ workspace_id: undefined }` to `selectMany` and assert both throw instead of issuing an unfiltered query.
- **Alternative fix and trade-off:** Disable `SERVERS_ENABLED` unless `RERUN_ENGINE_URL` is unset (so single-box Docker Compose installs that already bundle `http://engine:3000` never expose custom server pairing to secondary workspaces). Simpler for single-tenant self-hosters, though multi-server self-hosters still need the `public-fetch` SSRF check.

## Confidence

`proven`
