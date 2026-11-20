# `E18`: Two `apps/ui` Services Still Read Supabase via Raw `.from(table).select(...)` Instead of Typed `select*` Helpers (`CLAUDE.md` Rule Violation)

- **Finding:** All 135 Supabase migrations are strictly ordered with zero column/type drift (`apps/ui/app/api/database.types.ts` re-exports `@moldwright/db/types` directly and 100% of writes carry explicit `<Database[...]>` generics), but two server services (`email-sign-up.service.ts:39` and `services.service.ts:246`) violate `CLAUDE.md` by reading via raw `.from(...).select(...)` instead of the typed `select*` helpers.

## Evidence

- `CLAUDE.md` (Supabase -> *Reads always go through the typed helpers*):
  ```markdown
  Every Supabase **read** goes through the typed helpers (`selectSingle`, `selectMaybeSingle`, `selectFirst`, `selectMany`, `selectAll`, `selectCount`, `canRead`, and the `*WithJoins` variants). Never write a raw `.from(table).select(...)` for a read.
  ...
  No exception for an existence check (`select('id')` as a guard) or for `select('*')`
  ```
- `apps/ui/app/api/_services/email-sign-up.service.ts:38-40`:
  ```ts
  async function hasPendingInvitation(admin: ReturnType<typeof createServiceRoleClient>, email: string): Promise<boolean> {
      const { data, error } = await admin.from('workspace_invitations').select('id').eq('email', email.toLowerCase()).eq('status', 'pending').gt('expires_at', new Date().toISOString()).limit(1)
  ```
- `apps/ui/app/api/_services/services.service.ts:246-251`:
  ```ts
      let query = supabase.from('services').select('slug, name, category, summary, icon, manifest, verified').eq('enabled', true)
      if (opts?.category) query = query.eq('category', opts.category)

      const { data } = await query.order('category', { ascending: true }).order('name', { ascending: true }).range(offset, offset + limit - 1)

      return ((data ?? []) as CatalogRow[]).map(s => toSearchResult(s, new Map()))
  ```
- **Command / test run:** Python scan of all 135 `supabase/migrations/*.sql` files + AST/regex scan of `.from(...)` across `apps/ui/`:
  ```text
  MIGRATION TIMESTAMP DUPS: []
  SORTED ORDER OK: True
  UI database.types.ts: export * from '@moldwright/db/types'
  RAW .from().select READS: 2 ['apps/ui/app/api/_services/email-sign-up.service.ts:39', 'apps/ui/app/api/_services/services.service.ts:246']
  UNTYPED WRITES: 0 []
  ```

## Trigger

1. `hasPendingInvitation` (`email-sign-up.service.ts:39`) performs an existence guard using raw `.from('workspace_invitations').select('id')`, the exact anti-pattern forbidden in `CLAUDE.md`.
2. `listCatalogServices` (`services.service.ts:246-251`) uses raw `.from('services').select('...')` and casts `(data ?? []) as CatalogRow[]` because `selectMany` currently accepts a single `orderBy` object rather than an array of two `orderBy` columns (`category`, `name`). That `as CatalogRow[]` cast bypasses compile-time column checking against `Database['public']['Tables']['services']['Row']` if any column in `services` is ever renamed!

## Impact and severity

- **Severity:** `low`
- **Impact:** Bypasses `@moldwright/db` compile-time column/row type safety (`as CatalogRow[]` cast in `services.service.ts:251`) and violates the repository's zero-exception `select*` read rule in `CLAUDE.md`.

## Proposed fix

- **Smallest causal change (`apps/ui/app/api/_services/email-sign-up.service.ts`, `packages/db/src/helpers.ts`, `apps/ui/app/api/_services/services.service.ts`):**
  1. Replace `admin.from('workspace_invitations').select('id')...` in `email-sign-up.service.ts:39` with `selectFirst(admin, 'workspace_invitations', ['id'] as const, { email: email.toLowerCase(), status: 'pending', expires_at: { gt: new Date().toISOString() } })`.
  2. Allow `orderBy` in `selectMany` (`packages/db/src/helpers.ts:191`) to accept either a single `{ column, ascending? }` or `ReadonlyArray<{ column, ascending? }>`, then replace raw `.from('services').select(...)` + `as CatalogRow[]` in `services.service.ts:246-251` with `selectMany(supabase, 'services', CATALOG_COLUMNS, { enabled: true, ...(opts?.category ? { category: opts.category } : {}) }, [{ column: 'category' }, { column: 'name' }], limit, offset)`.
- **Must not break:** `listCatalogServices` category + alphabetical ordering and pagination (`offset`, `limit`); `lookupEmailForSignUp` invitation bypass when `SIGN_UP_EMAILS` allowlist is active.
- **Failing test that proves the fix:**
  - **File:** `apps/ui/supabase/supabase-helpers.test.ts`
  - **Test name:** `it('supports multi-column orderBy in selectMany and leaves zero raw .from().select() reads in apps/ui')`
  - **Assertion:** Assert `selectMany` chains `.order('category', ...).order('name', ...)` when given an array, and assert a static scan of non-test files in `apps/ui/` finds zero `.from(...).select(` read calls.
- **Alternative fix and trade-off:** Sort by `(a.category.localeCompare(b.category) || a.name.localeCompare(b.name))` in memory if the catalog stays `< 60` rows, avoiding any signature extension to `selectMany` at the cost of breaking multi-page offset ordering once services exceed `BROWSE_PAGE_SIZE = 60`.

## Confidence

`proven`
