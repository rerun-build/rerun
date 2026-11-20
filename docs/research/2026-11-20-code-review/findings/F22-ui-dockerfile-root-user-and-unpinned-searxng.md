# `F22`: `apps/ui/Dockerfile` and `webgate` Run as `root` Inside Production Containers, `apps/ui/Dockerfile` Copies Full Monorepo Build Tree Into Runtime Image, and `searxng:latest` Is Unpinned

- **Finding:** Unlike `apps/engine/Dockerfile` (`USER rerun`) and `deploy/vps/factory-runner.Dockerfile` (`USER runner`), `apps/ui/Dockerfile` (`lines 30-35`) and `deploy/vps/docker-compose.vps.yml` (`webgate`, `lines 28-39`) run as UID `0` (`root`) at runtime, `apps/ui/Dockerfile:32` copies the entire monorepo `/app` (including `tools/factory/`, `deploy/`, `supabase/`, and devDependencies) into the runtime image, and `deploy/vps/docker-compose.vps.yml:41` pulls mutable `searxng/searxng:latest` without a version or digest pin.

## Evidence

- `apps/ui/Dockerfile:30-35`:
  ```dockerfile
  FROM base
  ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
  COPY --from=build /app /app
  WORKDIR /app/apps/ui
  EXPOSE 3000
  CMD ["node", "node_modules/next/dist/bin/next", "start"]
  ```
- `deploy/vps/docker-compose.vps.yml:28-46`:
  ```yaml
    webgate:
      image: node:26-alpine
      command: node /srv/webgate/server.mjs
      ...
    searxng:
      image: searxng/searxng:latest
  ```
- `.dockerignore:13-15` & `apps/engine/Dockerfile:21-22`:
  ```gitignore
  .env
  .env.*
  !.env.example
  ```
- **Command / test run:** Inspected `apps/ui/Dockerfile`, `apps/engine/Dockerfile`, `deploy/vps/factory-runner.Dockerfile`, `docker-compose.yml`, `deploy/vps/docker-compose.vps.yml`, and `.dockerignore`; ran `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/deploy-config.test.ts` (passed).

## Trigger

*(What holds on build-layer secrets: `.dockerignore:13-15` excludes `.env` and `.env.*` [except `.env.example`], `apps/ui/Dockerfile:7-22` bakes only `NEXT_PUBLIC_*` client variables, and `apps/engine/Dockerfile:21-22` uses `"RERUN_API_KEY=dummy"` / `--mount=type=tmpfs` for its build-time entrypoint selftest — no real secret is baked into any image layer.)*

Three runtime container hygiene gaps are confirmed:
1. **Internet-facing `app` (`apps/ui/Dockerfile:30-35`) and `webgate` (`docker-compose.vps.yml:28-30`) run as `root`:** `node:26-bookworm-slim` and `node:26-alpine` default to `root` (`UID 0`) and both already ship a built-in unprivileged `node` (`UID 1000`) user, yet neither sets `USER node`! Any Next.js / React Server Components / SSRF / dependency RCE in `app` lands directly as `root` with a writable root filesystem (`node_modules`, server code) inside the container holding `SUPABASE_SECRET_KEY` and `RERUN_ENGINE_API_KEY`.
2. **Full monorepo build context shipped in `moldwright` image (`apps/ui/Dockerfile:32`):** `COPY --from=build /app /app` copies every source file (`apps/engine`, `tools/factory`, `deploy/vps`, `supabase/migrations`) and full workspace build `node_modules` into the published public GHCR image `ghcr.io/special-place-ai-heaven/moldwright` instead of Next.js `output: 'standalone'`.
3. **Mutable `:latest` tag on `searxng` (`deploy/vps/docker-compose.vps.yml:41`):** `searxng/searxng:latest` can silently pull a breaking upstream major change or compromised tag during `docker compose pull` on the VPS; `alpine/socat` (`docker-compose.yml:55`) and `node:26-trixie-slim` / `node:26-bookworm-slim` also float minor/digest tags (`apps/ui/Dockerfile` is on `bookworm-slim` while `apps/engine/Dockerfile` is on `trixie-slim`).

## Impact and severity

- **Severity:** `low` (`medium` defense-in-depth for internet-facing `app` running as `root` with writable code tree)
- **Impact:** Root execution + writable code tree upon any RCE in the public Next.js container, bloated image size/surface in GHCR, and non-reproducible `searxng:latest` upgrades on VPS deploys.

## Proposed fix

- **Smallest causal change (`apps/ui/Dockerfile`, `deploy/vps/docker-compose.vps.yml`):**
  1. In `apps/ui/Dockerfile:30-35`, create a writable cache dir for Next.js image/ISR cache (`mkdir -p /app/apps/ui/.next/cache && chown -R node:node /app/apps/ui/.next/cache`) and add `USER node` before `CMD` (matching `USER rerun` in `apps/engine/Dockerfile:25`).
  2. In `deploy/vps/docker-compose.vps.yml:29,41`, add `user: "node"` on `webgate` and pin `searxng/searxng` to a tested release tag/digest (e.g., `searxng/searxng:2026.11.15-...` or pinned `@sha256:...`).
- **Must not break:** `next start` writing resized image cache entries under `/app/apps/ui/.next/cache/images` at runtime when `USER node` is active.
- **Failing test that proves the fix:**
  - **File:** `apps/engine/src/deploy-config.test.ts` (or `tools/factory/test_image_files.py`)
  - **Test name:** `it('runs the final stage of apps/ui/Dockerfile and webgate as non-root and pins compose image tags')`
  - **Assertion:** Parse the final `FROM` stage of `apps/ui/Dockerfile` and assert it contains a non-root `USER` directive; parse `deploy/vps/docker-compose.vps.yml` and assert `webgate` sets `user:` and no service image ends with `:latest`.
- **Alternative fix and trade-off:** Enable `output: 'standalone'` in `apps/ui/next.config.ts` and copy only `.next/standalone`, `.next/static`, and `public` with `--chown=node:node`. Cuts image size by ~70% and strips build tools/monorepo sources, requiring a quick smoke check with `pnpm verify:ui` to confirm dynamic server packages bundle cleanly.

## Confidence

`proven`
