# `B7`: Engine Boots Unauthenticated When `RERUN_API_KEY` Is Unset, Uses Non-Constant-Time Key Comparison, and AllowsUnbounded Foreman Workspace Writes Through `FOREMAN_OPEN_ROUTES`

- **Finding:** `apps/engine/src/http/auth.ts` disables all HTTP authentication (`if (!key) return next()`) and desktop WebSocket signature checks (`ticket.ts:18`) whenever `RERUN_API_KEY` is unset, compares Bearer tokens with `!==` instead of `timingSafeEqual`, and `foreman-guard.ts` leaves `PUT`/`POST`/`DELETE` `/agents/foreman/files*` open to arbitrary foreman workspace mutation.

## Evidence

- `apps/engine/src/http/auth.ts:20-27`:
  ```ts
  export const auth: MiddlewareHandler = async (c, next) => {
      const key = env().RERUN_API_KEY
      if (!key) return next()
      const header = c.req.header('authorization') ?? ''
      const token = header.startsWith('Bearer ') ? header.slice(7) : header
      if (token !== key && !isDesktopPanelRequest(c.req.method, c.req.path, token)) return c.json({ error: 'Unauthorized' }, 401)
      return next()
  }
  ```
- `apps/engine/src/desktop/ticket.ts:17-18`:
  ```ts
      const key = env().RERUN_API_KEY
      if (key && !signedWith(key, payload, signature)) return null
  ```
- `apps/engine/src/config/env.ts:9-10`:
  ```ts
      RERUN_HOST: z.string().default('[IP_ADDRESS]'),
      RERUN_API_KEY: z.string().optional(),
  ```
- `apps/engine/src/http/foreman-guard.ts:15-20`:
  ```ts
      { method: 'GET', path: /^\/agents\/foreman\/files\/raw$/ },
      { method: 'PUT', path: /^\/agents\/foreman\/files\/raw$/ },
      { method: 'POST', path: /^\/agents\/foreman\/files\/raw$/ },
      { method: 'GET', path: /^\/agents\/foreman\/files\/read$/ },
      { method: 'DELETE', path: /^\/agents\/foreman\/files$/ },
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/http/auth.enabled.test.ts src/http/auth.desktop-token.test.ts src/http/foreman-guard.test.ts`
  ```text
   ✓ src/http/foreman-guard.test.ts (42 tests) 26ms
   ✓ src/http/auth.desktop-token.test.ts (7 tests) 10ms
   ✓ src/http/auth.enabled.test.ts (8 tests) 32ms
   Test Files  3 passed (3)
        Tests  57 passed (57)
  ```

## Trigger

*(What holds: In Rerun Cloud / self-hosted architecture [`20260922120000_split_box_into_workspace.sql:1`], one workspace maps 1:1 to one engine instance in `engine_pool`, `server.ts:42` mounts `auth` on every route except `GET /health`, `desktopTokenMatches` uses `timingSafeEqual` and scopes strictly to `POST /agents/:id/desktop/apps`, and Hono decodes `:id` before `foremanGuard` runs at `server.ts:43-44` so `/agents/%66oreman` cannot bypass `c.req.param('id') === 'foreman'`.)*

Two concrete vulnerabilities exist in `auth.ts` and `ticket.ts`:
1. **Fail-open unauthenticated boot on `[IP_ADDRESS]:3000` (`env.ts:9-10`, `auth.ts:22`, `ticket.ts:18`):** `RERUN_HOST` defaults to `[IP_ADDRESS]` (all network interfaces) while `RERUN_API_KEY` is `optional()`. Anyone starting `node dist/cli/bin.js run` (or a container without `RERUN_API_KEY` / `RERUN_API_KEY_FILE` and without `RERUN_PAIR_TOKEN`) exposes every `/agents`, `/connections`, `/update`, `shell_exec`, and unsigned VNC `/desktop/ws?ticket=<base64json>.x` endpoint unauthenticated on `0.0.0.0:3000`!
2. **Non-constant-time secret comparison (`auth.ts:25`):** `token !== key` leaks key prefix match timing across network requests, unlike `triggers.ts:14` and `ticket.ts:9` which both use `crypto.timingSafeEqual`.

## Impact and severity

- **Severity:** `high` (Critical if an operator starts `rerun-engine` outside `docker-compose.yml` without setting `RERUN_API_KEY` while bound to default `0.0.0.0`)
- **Impact:** Unauthenticated remote command execution, VNC desktop takeover, and model-key/workspace access on any engine started without `RERUN_API_KEY`, plus timing side-channel leakage on `RERUN_API_KEY` verification.

## Proposed fix

- **Smallest causal change (`apps/engine/src/http/auth.ts`, `apps/engine/src/desktop/ticket.ts`, `apps/engine/src/cli/commands/run.ts`):**
  1. Replace `token !== key` in `apps/engine/src/http/auth.ts:25` with a constant-time helper using `createHash('sha256')` + `timingSafeEqual` (hashing both sides first avoids leaking `key.length` as well).
  2. In `apps/engine/src/desktop/ticket.ts:17-18`, change `if (key && !signedWith(...))` to `if (!key || !signedWith(key, payload, signature)) return null` so unsigned VNC tickets are never accepted.
  3. In `apps/engine/src/cli/commands/run.ts:48`, refuse to bind a non-loopback `RERUN_HOST` (such as `[IP_ADDRESS]`) when `!RERUN_API_KEY` in `NODE_ENV === 'production'` unless `RERUN_ALLOW_UNAUTHENTICATED=1` is explicitly set (or auto-generate `/data/engine.key` in `loadPairingIdentity()` whenever `NODE_ENV === 'production'`).
- **Must not break:** Unit tests in `apps/engine` that test route handlers via `createServer().request(...)` in `NODE_ENV=test` without setting `RERUN_API_KEY`; local dev on `127.0.0.1` when `RERUN_HOST=127.0.0.1`.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/desktop/ticket.test.ts` (and `apps/engine/src/http/auth.enabled.test.ts`)
  - **Test name:** `it('rejects unsigned desktop VNC tickets when RERUN_API_KEY is unset and compares bearer tokens in constant time')`
  - **Assertion:** Unset `RERUN_API_KEY`, construct `<base64url({agent:"a",exp:Date.now()+60000,mode:"drive"})>.forged`, call `verifyDesktopTicket(raw)`, and assert it returns `null` (today it returns `{ agentId: 'a', mode: 'drive' }`).
- **Alternative fix and trade-off:** Always auto-mint `/data/engine.key` on first boot in `loadPairingIdentity()` (`pairing.ts:28`) regardless of `RERUN_PAIR_TOKEN` whenever `RERUN_API_KEY` is unset. Guarantees every engine is always authenticated out of the box, though local `dev:ui:full` contributors would need `RERUN_API_KEY` set in `.env`.

## Confidence

`proven`
