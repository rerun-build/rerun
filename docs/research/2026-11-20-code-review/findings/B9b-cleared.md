# `B9b`: Cleared — `RERUN_` vs `MOLDWRIGHT_` Environment Variables, Connection IDs, and Deploy Settings

- **Status:** `cleared`
- **Checked:**
  - Repo-wide Python AST/regex cross-check of every `process.env.*` and `os.environ*` reader across `apps/`, `packages/`, `tools/factory/`, `deploy/vps/`, and `scripts/` against `.env.example`, `apps/engine/.env.example`, `docker-compose.yml`, and `deploy/vps/*.{yml,sh}`
  - `apps/engine/src/config/env.ts:6-16`, `apps/engine/src/connections/store.ts:106-118` (`ensureMoldwrightConnection`), `apps/engine/src/connections/migrate.ts`, `apps/engine/src/connections/resolve.ts`
  - `apps/ui/lib/engine/ai-sources.ts`, `apps/ui/cloud-oss/llm.ts`, `apps/ui/cloud-oss/billing.ts`, `apps/ui/cloud-oss/engines.ts`
  - `deploy/vps/doctor.sh:11-33`, `deploy/vps/rotate-engine-key.sh:17`, `deploy/vps/docker-compose.vps.yml:9-38`
  - `pnpm --filter ./apps/engine exec vitest run --maxWorkers=2 src/deploy-config.test.ts src/connections/migrate.test.ts` (passed) and `wsl -e sh -c "... python3 -m unittest test_env_scripts"` (passed)
- **Why it holds:** Zero `process.env.MOLDWRIGHT_*` or `os.environ["MOLDWRIGHT_*"]` readers exist anywhere in the codebase (`MOLDWRIGHT READS: {}`). Although the visible brand, npm scope (`@moldwright/*`), and GHCR image names (`ghcr.io/special-place-ai-heaven/moldwright` and `moldwright-engine`) were renamed, every environment variable (`RERUN_API_KEY`, `RERUN_ENGINE_API_KEY`, `RERUN_APP_HOST`, `RERUN_ENGINE_HOST`, `RERUN_DATA_DIR`, `RERUN_HUB_BASE_URL`), internal connection ID (`RERUN_CONNECTION_ID = 'rerun'` used consistently in `ensureMoldwrightConnection` at `store.ts:114-117` and `ai-sources.ts`), and CLI entrypoint (`rerun`) kept its `RERUN_` / `rerun` wire identifier consistently across both writers and readers.
