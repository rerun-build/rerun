# `E19`: `closeSystemDb` / `closeAgentDb` Race In-Flight Async Callers (`scheduleBackfillPaidSources`, Run Telemetry, and Sub-Runs) Causing `CLIENT_CLOSED`, and `systemDb.ts` / `client.ts` Set Neither `WAL` Nor `busy_timeout`

- **Finding:** `closeSystemDb` and `closeStore` synchronously call `client.close()` while detached async operations (`scheduleBackfillPaidSources` queued on every `open()` in `systemDb.ts:328`, `buildTools().close()` calling `closeAgentDb` at the end of every run in `registry.ts:94`, and `DELETE /agents/:id` / `delegate.ts:139`) still hold that `Client` instance, producing `LibsqlError: CLIENT_CLOSED: The client is closed`, while `systemDb.ts` and `db/client.ts` omit `PRAGMA journal_mode = WAL` and `busy_timeout`.

## Evidence

- `apps/engine/src/db/systemDb.ts:322-330,346-353`:
  ```ts
  async function open(id: string): Promise<SystemDb> {
      mkdirSync(agentDataDir(id), { recursive: true })
      const client = createClient({ url: `file:${systemDbPath(id)}` })
      await migrateSystemDb(client, systemDbPath(id))
      const entry: SystemDb = { client, db: drizzle(client, { schema }) }
      pool.set(id, entry)
      scheduleBackfillPaidSources(client, id)
      return entry
  }
  ...
  export function closeSystemDb(id: string): void {
      const entry = pool.get(id)
      if (!entry) return
      pool.delete(id)
      try {
          entry.client.close()
      } catch {}
  }
  ```
- `apps/engine/src/paid-data/backfill.ts:83-87`:
  ```ts
  let queue: Promise<void> = Promise.resolve()

  export function scheduleBackfillPaidSources(client: Client, agentId: string): void {
      queue = queue.then(() => backfillPaidSources(client)).catch(err => logger.warn({ err: String(err), agentId }, 'could not index the past paid data calls'))
  }
  ```
- `apps/engine/src/tools/registry.ts:92-95` & `apps/engine/src/db/sharedDb.ts:27-42`:
  ```ts
        close: async () => {
            computer?.release()
            closeAgentDb(ctx.agent.id)
        },
  ```
  ```ts
  let ready: Promise<Client> | null = null

  export async function getSharedDb(): Promise<Client> {
      if (ready) return ready
      ready = (async () => {
          const client = await openStore(STORE_KEY, sharedDbPath(), sharedDbDir())
          ...
          return client
      })()
      return ready
  }
  ```
- `apps/engine/src/db/client.ts:12-16` (compare `sqlStore.ts:9-12` which sets `timeout: 5000` and `PRAGMA journal_mode = WAL`):
  ```ts
  function init() {
      mkdirSync(dataDir(), { recursive: true })
      client = createClient({ url: `file:${dbPath()}` })
      database = drizzle(client, { schema })
  }
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/db/sqlStore.test.ts src/db/systemDb.test.ts src/db/ladder.test.ts`
  ```text
   ✓ src/db/sqlStore.test.ts (passed)
   ✓ src/db/systemDb.test.ts (passed)
   ✓ src/db/ladder.test.ts (passed)
  ```

## Trigger

Three concrete `"client is closed"` / `SQLITE_BUSY` mechanisms are proven directly in code:
1. **`scheduleBackfillPaidSources` fire-and-forget race (`systemDb.ts:328` -> `backfill.ts:85-87`):** Every single time `getSystemDb(id)` opens a database (in CI tests, in `delegate.ts:139` ephemeral sub-runs, or before `DELETE /agents/:id` in `routes/agents.ts:292`), `open(id)` enqueues `backfillPaidSources(client)` onto a module-global promise `queue` **without awaiting it**. When the test, `delegate` child run (`delegate.ts:139`), or `DELETE /agents/:id` calls `closeSystemDb(id)` a few milliseconds later, `entry.client.close()` closes the native libsql handle while `backfillPaidSources(client)` is mid-query on `SELECT value FROM system_meta` or `SELECT DISTINCT tool_name FROM tool_calls`, throwing `LibsqlError: CLIENT_CLOSED: The client is closed` in CI logs! Moreover, if `closeSystemDb(id)` is called *while `open(id)` is still in `opening`* (`systemDb.ts:335-338`), `pool.get(id)` is `undefined` so `closeSystemDb` is a no-op and `open(id)` leaks an open handle into `pool` after deletion!
2. **`closeAgentDb(ctx.agent.id)` at the end of every run (`tools/registry.ts:94`):** When a coworker has two concurrent runs (e.g. a cron/webhook run + a chat run, or a user browsing `/agents/:id/data` in `DataBrowser` while a run finishes), Run A's `closeTools()` calls `closeAgentDb(ctx.agent.id)` (`sqlStore.ts:36` `client.close()`), ripping the pooled `Client` out from under Run B or the `/data` HTTP request mid-query (`CLIENT_CLOSED`)!
3. **Missing `WAL` and `busy_timeout` on `systemDb.ts:324` and `db/client.ts:14`:** Unlike `sqlStore.ts:9-12` (`timeout: 5000`, `PRAGMA journal_mode = WAL`), `systemDb.ts` and `db/client.ts` call `createClient({ url: ... })` with default rollback journal and `0 ms` busy timeout, so fire-and-forget writes in `loop.ts:503,515,570,571` (`appendMessage`, `bumpRunStep`, `recordStepTelemetry`, `updateRunLive`) collide with `SQLITE_BUSY` under streaming steps.

*(Note on per-coworker migrations: `SYSTEM_DB_MIGRATIONS` [`systemDb.ts:238-314`] and `SHARED_DB_MIGRATIONS` [`sharedDb.ts:15-23`] use idempotent `ensureColumns` / `IF NOT EXISTS` steps through `migrateSqlite`, and `agent.db` holds user/coworker tables plus `_rerun_views` created `IF NOT EXISTS`, so archived coworker restores migrate cleanly.)*

## Impact and severity

- **Severity:** `high`
- **Impact:** Directly explains the `"client is closed"` errors in CI logs (`scheduleBackfillPaidSources` racing `closeSystemDb`), aborts concurrent `/agents/:id/data` or parallel coworker runs when one run finishes (`registry.ts:94` `closeAgentDb`), leaves zombie open handles if `closeSystemDb` runs during `opening`, and causes `SQLITE_BUSY` drops on `system.db` telemetry/message writes.

## Proposed fix

- **Smallest causal change (`apps/engine/src/db/systemDb.ts`, `apps/engine/src/db/sqlStore.ts`, `apps/engine/src/db/client.ts`, `apps/engine/src/tools/registry.ts`):**
  1. In `systemDb.ts:324` and `db/client.ts:14`, pass `timeout: 5000` to `createClient` and run `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`.
  2. Track the per-agent backfill promise in `systemDb.ts` and make `closeSystemDb(id)` `async` (or chain onto `opening.get(id)` + the agent's backfill promise before calling `client.close()`), and guard `backfillPaidSources` when the client was closed for deletion.
  3. Remove `closeAgentDb(ctx.agent.id)` from per-run `buildTools().close()` in `apps/engine/src/tools/registry.ts:94` (keep `agent.db` pooled like `system.db`, closing it only on `unloadAgent` / `DELETE /agents/:id`, `snapshot`, or an idle timer when `inFlight === 0`).
- **Must not break:** `cli/commands/snapshot.ts` WAL checkpointing (`checkpointAgentDb`) and `DELETE /agents/:id` directory removal on Windows (which requires all file handles closed before `rm()`).
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/db/systemDb.test.ts` (and `apps/engine/src/db/agentDb.test.ts`)
  - **Test name:** `it('does not throw CLIENT_CLOSED when closeSystemDb races scheduleBackfillPaidSources or when one of two concurrent runs closes its toolset')`
  - **Assertion:** Seed `tool_calls` with a paid-data row, call `await getSystemDb('race')` followed immediately by `await closeSystemDb('race')` while spying on `logger.warn`, and assert zero `'could not index the past paid data calls'` / `CLIENT_CLOSED` warnings fire; second, run two `buildTools(ctx)` instances for the same `agent.id`, call `await built1.close()`, and assert `getAgentDb(agent.id)` query on `built2` succeeds without `CLIENT_CLOSED`.
- **Alternative fix and trade-off:** Run `backfillPaidSources` synchronously inside `SYSTEM_DB_MIGRATIONS` (as migration v12) instead of a detached background queue on every `open()`. Eliminates the background race permanently and runs once per DB instead of checking `system_meta` on every boot, at the cost of adding ~10–50 ms to the first migration of an unindexed DB.

## Confidence

`proven`
