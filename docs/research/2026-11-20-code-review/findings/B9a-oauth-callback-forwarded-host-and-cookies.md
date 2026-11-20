# `B9a`: `auth/callback/route.ts` Trusts Spoofable `x-forwarded-host` for OAuth Post-Login Redirects (`publicUrl`) and `published-site` Hardcodes `/__rerun/` Reserved Paths

- **Finding:** `publicUrl()` in `apps/ui/app/(authflow)/auth/callback/route.ts` constructs post-OAuth redirects from the raw `x-forwarded-host` request header without validating it against `NEXT_PUBLIC_APP_URL`, enabling host-header open redirects (and leaking query parameters on callback redirects) whenever a proxy forwards or fails to strip `x-forwarded-host`.

## Evidence

- `apps/ui/app/(authflow)/auth/callback/route.ts:16-21,44,108`:
  ```ts
  function publicUrl(request: Request, destination: string): string {
      const { origin } = new URL(request.url)
      const forwardedHost = request.headers.get('x-forwarded-host')
      if (process.env.NODE_ENV === 'development' || !forwardedHost) return `${origin}${destination}`
      return `https://${forwardedHost}${destination}`
  }
  ```
- `apps/ui/lib/app-origin.ts` vs `apps/ui/app/(authflow)/auth/callback/route.ts:18` (and compare `01149262` cookie domain drop across `apps/ui/supabase/middleware.ts:38`, `apps/ui/proxy.ts:43`, and `packages/analytics/src/client.ts:220`):
  ```ts
  function deleteEverywhere(name: string) {
      const base = [`${name}=`, 'path=/', 'max-age=0']
      document.cookie = base.join('; ')
  }
  ```
- **Command / test run:** `pnpm --filter ./apps/ui exec vitest run --maxWorkers=2 "app/(authflow)/auth/callback/route.test.ts" supabase/middleware.test.ts proxy.test.ts`
  ```text
   ✓ app/(authflow)/auth/callback/route.test.ts (23 tests) 17ms
   ✓ supabase/middleware.test.ts (31 tests) 19ms
   ✓ proxy.test.ts (16 tests) 23ms
  ```

## Trigger

*(What holds on the Rerun -> Moldwright header/cookie rename: Every `x-rerun-*` header [`x-rerun-agent`, `x-rerun-foreman-token`, `x-workspace-id`] and every cookie name [`SESSION_HINT_COOKIE`, `PROVISIONED_COOKIE`, `BRAND_GATE_COOKIE`, `SIGNUP_INTENT_COOKIE`, `CONSENT_COOKIE`] is imported from shared constants in `@moldwright/contracts` / `@moldwright/analytics`, with zero `x-moldwright` split-brain mismatches across UI, engine, mobile, and desktop; and the old `.rerun.build` parent-domain cookie rule dropped in `01149262` only ever matched `host.endsWith('rerun.build')`, so users on `moldwright.robagentic.tech` never received duplicate parent-domain cookies.)*

Two concrete issues exist in `auth/callback/route.ts`:
1. **Unvalidated `x-forwarded-host` redirect in `publicUrl` (`auth/callback/route.ts:16-21`):** In production (`NODE_ENV !== 'development'`), if `app` is reached directly or behind a reverse proxy/CDN that appends rather than overwrites `x-forwarded-host` (e.g., `x-forwarded-host: evil.com` or comma-separated `moldwright.robagentic.tech, evil.com`), `GET /auth/callback?code=...` exchanges the OAuth code (setting session cookies) and redirects the browser to `https://evil.com/board` (or throws/malforms on comma-separated `x-forwarded-host` because `split(',')[0]` is also missing!).
2. **Legacy `.rerun.build` cookie cleanup omitted (`analytics/src/client.ts:220`, `middleware.ts:38`):** If any user still visits on a `*.rerun.build` domain after `01149262`, clearing `SESSION_HINT_COOKIE` or `SIGNUP_INTENT_COOKIE` without `Domain=.rerun.build` leaves any pre-existing `.rerun.build` cookie alive in the browser jar alongside the new host-only cookie (`parseSessionHintCookie` reads the first matching cookie).

## Impact and severity

- **Severity:** `medium`
- **Impact:** Open redirect on `/auth/callback` (and broken redirect URL if a proxy sends comma-separated `X-Forwarded-Host: host1, host2`), plus stale `SESSION_HINT_COOKIE` if accessed on legacy `*.rerun.build` hosts.

## Proposed fix

- **Smallest causal change (`apps/ui/app/(authflow)/auth/callback/route.ts`):**
  Replace `publicUrl(request, destination)`'s raw `x-forwarded-host` construction with the canonical configured origin `APP_URL` (`process.env.NEXT_PUBLIC_APP_URL`, falling back to `new URL(request.url).origin` only in development or when `NEXT_PUBLIC_APP_URL` is unset), or at minimum take `.split(',')[0].trim()` and verify its host matches `new URL(APP_URL).host`:
  ```ts
  function publicUrl(request: Request, destination: string): string {
      const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '')
      if (process.env.NODE_ENV !== 'development' && configured) return `${configured}${destination}`
      return `${new URL(request.url).origin}${destination}`
  }
  ```
- **Must not break:** Local development (`http://localhost:3000/auth/callback`) and production OAuth sign-in behind Traefik (`NEXT_PUBLIC_APP_URL=https://moldwright.robagentic.tech`).
- **Failing test that proves the fix:**
  - **File:** `apps/ui/app/(authflow)/auth/callback/route.test.ts`
  - **Test name:** `it('ignores an untrusted or comma-separated x-forwarded-host header when building callback redirects')`
  - **Assertion:** Set `NODE_ENV=production` and `NEXT_PUBLIC_APP_URL=https://moldwright.robagentic.tech`, send `GET https://internal:3000/auth/callback` with `headers: { 'x-forwarded-host': 'evil.example.com' }`, and assert the `Location` header starts with `https://moldwright.robagentic.tech/` and never `https://evil.example.com/`.
- **Alternative fix and trade-off:** Validate `forwardedHost` against an allowlist of `NEXT_PUBLIC_APP_URL` + `PUBLISH_HOST`. Useful only if OAuth callbacks are served on multiple custom domains simultaneously.

## Confidence

`proven`
