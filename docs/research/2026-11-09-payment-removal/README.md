# Payment removal: map and scope (2026-11-09)

This fork runs for its owner only and sells nothing. The owner asked for all payment code to be
removed, and for every other feature to keep working. The fork stays mergeable with upstream
(`rerun-build/rerun`), so the removal is scoped to what can be deleted without rewriting upstream's
shared code.

## How the build already treats payments

- The private `cloud/` package is absent, so every `@moldwright/cloud/*` import resolves to
  `apps/ui/cloud-oss/*` (`tsconfig.json`, `vitest.config.ts`).
- `cloud-oss/billing.ts`: `BILLING_ENABLED = false`, every entitlement check returns true.
- `cloud-oss/billing.client.tsx`: billing UI renders nothing (the out-of-balance notice now shows a
  plain provider error, PR #9).
- `cloud-oss/billing.server.ts`, `marketplace*.ts`, `affiliate.ts`, `redeem.tsx`, `apps*.ts`: no-ops.

## Scope of this removal (decided 2026-11-09)

**Remove**

- `apps/ui/ee/` (all of it) and `apps/ui/app/(ee)/` (Stripe webhooks and their idempotency helper).
- The Stripe dependencies of `apps/ui/package.json`: `stripe`, `@stripe/stripe-js`,
  `@stripe/react-stripe-js`. Also the `STRIPE_*` stubs in `apps/ui/test/setup-env.ts`.
- Non-ee files that import from `@/ee/...` directly. They are rewritten so they need no ee code:
  - `app/api/paid-data/route.ts`: runs the ee `getWorkspaceBudgetByEngineKey` on every probe.
  - `app/api/v1/foreman/trial/route.ts`: calls the ee `startCardlessTrial`, which creates a Stripe
    customer with a placeholder key, so it returns 500 on self-hosted.
  - `app/api/_services/apps.service.ts`: imports the Stripe client and the slot code.
  - `lib/apps/notify.ts`: imports the lifecycle-email recipient helper from ee.
  - Trigger.dev jobs and helpers that import ee: `trigger/paid-apps.ts`,
    `trigger/whatsapp-trial-sequence.ts`, `trigger/whatsapp-access-ending.ts`,
    `lib/apps/{trials,stripe-slots,slots-sync,slots}.ts`.
  - Find every other one with a search for `@/ee/` outside `ee/` and `app/(ee)/`.
- Tests that only exercise the removed code. Under `ee/` and `app/(ee)/` there are 44 files plus
  `ee/test/stripe-fake.ts`. Their counterparts for rewritten routes are rewritten, not dropped.

**Keep (upstream shape, inert here)**

- The `cloud-oss` stubs and their roughly 25 callers (`openBilling` buttons and so on). Rewriting
  them is where every future upstream merge would conflict.
- `packages/contracts`, `packages/emails`, `packages/analytics` billing types and templates.
- The database schema: billing tables and columns stay. Dead columns cost nothing; dropping them
  needs every query that names them changed first.

## Hard constraints

1. `GET /api/paid-data` must keep answering, with `enabled: false`. If the route is missing or
   errors, the engine falls back to `enabled: true` (`apps/engine/src/paid-data/price.ts:26-35`).
   It would then offer `paid_data` to every model, and every call would fail.
2. `supabase/seed.sql` rows for stripe, paddle and paypal are a catalog of services coworkers can
   connect. They are not billing. Do not touch them.
3. `v1/foreman/trial` answers `{ entitled: true }` without ee code. The mobile app calls it
   (`apps/mobile/src/api/onboarding.ts:20`).
4. `lib/apps/notify.ts` is not billing (app notifications). Keep its behaviour and replace only its
   ee import.

## Also found (not in this removal)

- `workspaces.max_agents` defaults to 1 in the baseline migration. Today's insert paths set it to
  null, so nothing is capped. A later migration can set the default to null.
- `apps/ui/ee/LICENSE` section 2 restricts production use of ee files. Removing them also clears that.
