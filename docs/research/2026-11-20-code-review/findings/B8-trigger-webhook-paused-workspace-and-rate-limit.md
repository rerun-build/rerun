# `B8`: Public Trigger Endpoint `/api/t/[agentId]/[slug]/[token]` Exposes Bearer Secret in URL Path and Fires Paid Runs Without Rate Limiting, Replay Bounds, or Workspace Pause/Quota Checks

- **Finding:** `/api/t/[agentId]/[slug]/[token]` places the static trigger secret directly in the URL path, performs zero rate-limiting, deduplication/replay protection, or workspace-paused/credit checks (`resolveAgentTargetForTrigger` ignores `workspaces.paused_at` and subscription status), and allows any leaked or replayed URL hit (including `GET` if enabled) to start unbounded coworker runs.

## Evidence

- `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.ts:19-34,37-50,63-67`:
  ```ts
  async function handle(req: Request, ctx: Params): Promise<Response> {
      const { agentId, slug, token } = await ctx.params
      if (!SLUG_RE.test(slug) || !token) return notFound()
      ...
      const target = await resolveAgentTargetForTrigger(agentId)
      if (!target) return notFound()
      ...
          const outcome = await fireTrigger(
              target.conn,
              target.engineAgentId,
              slug,
              { token, method: req.method as EngineTriggerMethod, ... }
          )
  ...
  export const GET = handle
  export const POST = handle
  ```
- `apps/ui/app/api/_services/chat.service.ts:69-79`:
  ```ts
  export async function resolveAgentTargetForTrigger(agentId: string): Promise<AgentChatTarget | null> {
      const row = await fetchAgentRow(agentId)
      if (!row || row.disabled_at || !row.engine_agent_id) return null
      const engine = await findWorkspaceEngine(row.workspace_id)
      if (!engine) return null
      return {
          engineAgentId: row.engine_agent_id,
          conn: engine.conn,
          contentLocked: false,
      }
  }
  ```
- `apps/ui/app/api/webhooks/bird/route.ts:92-98`:
  ```ts
      try {
          event = new Webhook(secret).verify(await req.text(), Object.fromEntries(req.headers)) as BirdEvent
      } catch {
          return Response.json({ error: 'Invalid signature' }, { status: 400 })
      }

      const handled = await handle(createServiceRoleClient(), event, req.headers.get('webhook-id'))
  ```
- **Command / test run:** `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/http/routes/triggers.auth.test.ts src/http/routes/triggers.fire.test.ts` and `pnpm --filter ./apps/ui exec vitest run --maxWorkers=2 "app/api/t/[agentId]/[slug]/[token]/route.test.ts" app/api/webhooks/bird/route.test.ts app/api/webhooks/supabase-auth-email/route.test.ts`
  ```text
   ✓ src/http/routes/triggers.auth.test.ts (passed)
   ✓ src/http/routes/triggers.fire.test.ts (passed)
   ✓ app/api/t/[agentId]/[slug]/[token]/route.test.ts (25 tests) 18ms
   ✓ app/api/webhooks/bird/route.test.ts (24 tests) 38ms
   ✓ app/api/webhooks/supabase-auth-email/route.test.ts (9 tests) 2110ms
  ```

## Trigger

*(What holds: `/api/webhooks/bird` and `/api/webhooks/supabase-auth-email` use `standardwebhooks` `Webhook.verify`, which enforces HMAC-SHA256 + a 5-minute `webhook-timestamp` replay window; `/api/webhooks/linkup` enforces `SIGNATURE_TOLERANCE_SECONDS = 300` + `claimDelivery` idempotency in `app_webhook_events`; and `triggers.ts:11-15,69` checks `!trigger.enabled || !trigger.token || !tokenMatches(...)` with constant-time `timingSafeEqual` on equal-length UTF-8 buffers.)*

However, on `/api/t/[agentId]/[slug]/[token]`:
1. **Unthrottled run-amplification & paused-workspace bypass (`chat.service.ts:69-79`, `route.ts:32-50`):** Anyone holding a trigger URL (or a misconfigured upstream webhook retrying in a tight loop) can POST thousands of requests per minute; `/api/t/...` has no per-trigger/per-workspace rate limit or idempotency key, and `resolveAgentTargetForTrigger` checks only `row.disabled_at`, completely skipping workspace `paused_at` (`20261002170000_workspace_paused.sql`), `payment_failed_at`, and plan entitlement checks — burning model tokens on paused or delinquent workspaces!
2. **Secret in URL path (`route.ts:20`):** Because `[token]` is a path segment rather than an `Authorization` / `X-Moldwright-Signature` header, the static capability secret is recorded in reverse-proxy access logs (Traefik), `web_fetch_events` / Next.js request URLs, and third-party webhook sender logs.

## Impact and severity

- **Severity:** `medium` (High for wallet-denial / runaway model spend when a trigger URL leaks or loops on a paused workspace)
- **Impact:** Unlimited concurrent/sequential LLM runs triggered without rate limits or paused-workspace checks, plus permanent bearer token exposure in HTTP access logs.

## Proposed fix

- **Smallest causal change (`apps/ui/app/api/_services/chat.service.ts`, `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.ts`):**
  1. In `resolveAgentTargetForTrigger` (`apps/ui/app/api/_services/chat.service.ts:69`), check `row.workspaces` entitlement/pause state (refuse when `paused_at !== null` or subscription is inactive/expired, matching interactive chat in `assertEngineEntitlement`).
  2. Add a per-`agentId:slug` sliding-window rate limit (and optional `Idempotency-Key` / `X-Hub-Signature-256` verification) in `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.ts`, and accept the token via `Authorization: Bearer <token>` on a tokenless `/api/t/[agentId]/[slug]` route while keeping `[token]` path compatibility for existing webhooks.
- **Must not break:** Existing external webhooks (GitHub, Stripe, Zapier, Make) already configured with `/api/t/<agentId>/<slug>/<token>` on active workspaces.
- **Failing test that proves the fix:**
  - **File:** `apps/ui/app/api/t/[agentId]/[slug]/[token]/route.test.ts`
  - **Test name:** `it('does not fire a trigger when the owning workspace is paused')`
  - **Assertion:** Mock `fetchAgentRow` returning an enabled agent in a workspace with `paused_at: '2026-11-20T00:00:00Z'`; send `POST /api/t/a1/hook/tok1` and assert `fireTrigger` is not called and status `404` / `403` is returned.
- **Alternative fix and trade-off:** Enforce per-trigger concurrency/minute caps directly inside the engine (`apps/engine/src/runtime/trigger-runner.ts`). Protects self-hosted direct engine callers too, and pairs cleanly with the workspace pause check in `apps/ui`.

## Confidence

`proven`
