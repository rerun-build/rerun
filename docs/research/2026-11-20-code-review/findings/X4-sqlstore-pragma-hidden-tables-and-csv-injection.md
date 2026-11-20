# `X4`: `sqlStore.ts` Allows Hidden-Table Reads/Writes (`_rerun_views`, `_rerun_shared_tables`), `PRAGMA` Execution on `executeStore`, Unenforced Shared-DB Table Ownership, and CSV Formula Injection

- **Finding:** `queryStore` and `executeStore` in `apps/engine/src/db/sqlStore.ts` do not restrict access to `AGENT_HIDDEN_TABLES` / `SHARED_HIDDEN_TABLES` (`_rerun_views`, `_rerun_shared_tables`), `executeStore` permits `PRAGMA` statements (`writable_schema`, `wal_autocheckpoint`, `locking_mode`), `shared-db.ts` does not enforce table ownership on `DROP`/`ALTER`/`DELETE`, and `toCsvValue` in `http/routes/data.ts` exports raw `=cmd|...` formula payloads without CSV-injection escaping.

## Evidence

- `apps/engine/src/db/sqlStore.ts:297-309,325-328`:
  ```ts
  export function assertNoAttach(sql: string): void {
      assertNoSqlFileAccess(sql)
      if (/\battach\b/i.test(blankSqlLiterals(sql))) throw new Error('ATTACH is not allowed. Each database is reached through its own tools.')
  }
  ...
  export async function queryStore(client: Client, sql: string, params: SqlParam[], limit: number): Promise<QueryResult> {
      assertReadOnlySql(sql)
      const rs = await client.execute({ sql, args: params })
  ...
      if (!input.sql) throw new Error('Provide either sql or statements.')
      assertNoAttach(input.sql)
      const rs = await withBusyRetry(() => client.execute({ sql: input.sql!, args: input.params }))
  ```
- `apps/engine/src/tools/builtin/shared-db.ts:60-65`:
  ```ts
            execute: async ({ sql, params, statements }) => {
                try {
                    const client = await getSharedDb()
                    const result = await executeStore(client, { sql, params, statements })
                    await recordTableOwnership(client, statements?.map(s => s.sql) ?? (sql ? [sql] : []), agentName)
  ```
- `apps/engine/src/http/routes/data.ts:27-32`:
  ```ts
  function toCsvValue(value: unknown): string {
      if (value === null || value === undefined) return ''
      const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
      if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
      return str
  }
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/db/sqlStore.test.ts src/http/routes/data.sql.test.ts` (passed) and `node` libsql verification (`MULTI-STMT ROWS: []`, `BACKTICK ATTACH ERR: syntax error` — proving libsql `execute` rejects `;`-chained second statements and SQLite rejects backticked `ATTACH`).

## Trigger

*(What holds: `@libsql/client` `client.execute()` executes only a single SQL statement and SQLite rejects quoted keywords like `` `ATTACH` ``, so `assertNoAttach` + `FILE_ACCESS_FUNCTIONS` cannot be bypassed to `ATTACH DATABASE '/data/rerun.db'` or call `load_extension`.)*

Three concrete integrity/security gaps exist in `sqlStore.ts`, `shared-db.ts`, and `data.ts`:
1. **`PRAGMA` allowed in `executeStore` (`sqlStore.ts:297-300`):** `WRITE_KEYWORDS` blocks `pragma` in `assertReadOnlySql`, but `executeStore` only calls `assertNoAttach`, allowing any coworker (`db_execute` / `shared_db_execute`) or `/data/execute` caller to run `PRAGMA writable_schema = ON` or `PRAGMA locking_mode = EXCLUSIVE` (locking the engine's pooled `shared.db` or `agent.db`) or `PRAGMA database_list` (leaking exact container host paths!).
2. **Hidden metadata tables (`_rerun_views`, `_rerun_shared_tables`) and cross-coworker tables are unprotected in `queryStore`/`executeStore` (`shared-db.ts:63`, `sqlStore.ts:304,314`):** Although `listTables`, `dropTable`, and `purgeTable` hide `AGENT_HIDDEN_TABLES` / `SHARED_HIDDEN_TABLES`, `queryStore` and `executeStore` allow arbitrary `DROP TABLE _rerun_views`, `UPDATE _rerun_shared_tables SET created_by = ...`, or dropping another coworker's table in `shared.db` (the tool description in `shared-db.ts:51` says *"never drop or alter a table you did not create"*, which is prompt text only).
3. **CSV formula injection on table export (`http/routes/data.ts:27-32,178-190`):** When a coworker ingests external web/lead data (`=HYPERLINK(...)`, `=CMD|...`, `+...`, `@...`) into `agent.db` and a user clicks Export CSV in `DataBrowser`, `toCsvValue` emits raw leading `=`, `+`, `-`, `@`, `\t` characters that execute as formulas in Excel / Google Sheets.

## Impact and severity

- **Severity:** `medium`
- **Impact:** Coworkers can corrupt `_rerun_views` / `_rerun_shared_tables` or other coworkers' `shared.db` tables, leak filesystem paths or lock `shared.db` via `PRAGMA` in `executeStore`, and deliver spreadsheet formula injection to users exporting coworker tables as CSV.

## Proposed fix

- **Smallest causal change (`apps/engine/src/db/sqlStore.ts`, `apps/engine/src/http/routes/data.ts`):**
  1. In `assertNoAttach` (`apps/engine/src/db/sqlStore.ts:297`), also block `\bpragma\b` and `\b_rerun_(?:views|shared_tables)\b` (and block `_rerun_` in `assertReadOnlySql` as well so internal engine metadata tables cannot be queried or mutated via raw SQL).
  2. In `toCsvValue` (`apps/engine/src/http/routes/data.ts:27`), prefix string values starting with `/^[=+\-@\t\r]/` (when not a plain finite number like `-42`) with a leading single quote `'` before CSV quoting.
- **Must not break:** Normal `CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`, `SELECT`, and negative numeric values (`-12.5`) in CSV exports.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/db/sqlStore.test.ts` (and `apps/engine/src/http/routes/data.rows.test.ts`)
  - **Test name:** `it('blocks PRAGMA and _rerun_* internal tables in executeStore and neutralizes formula prefixes in CSV export')`
  - **Assertion:** Assert `executeStore(client, { sql: 'PRAGMA writable_schema = ON', params: [] })` and `executeStore(client, { sql: 'DROP TABLE _rerun_views', params: [] })` throw; assert exporting a cell `=1+1` produces `'=1+1` while `-42` stays `-42`.
- **Alternative fix and trade-off:** Give each coworker its own SQLite authorizer or per-agent schema prefix in `shared.db` enforcing `tableOwners` on `DROP`/`ALTER`. Stronger multi-agent isolation inside a box, if coworkers in the same box are untrusted with respect to each other's shared tables.

## Confidence

`proven`
