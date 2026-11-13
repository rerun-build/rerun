import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { createServer } from '../../http/server.js'
import { attachDesktopBridge } from '../../desktop/bridge.js'
import { prepareDataDir } from '../../datadir/ladder.js'
import { reconcileVault } from '../../vault/apply.js'
import { ensureForeman } from '../../agents/foreman.js'
import { startScheduler } from '../../runtime/scheduler.js'
import { reconcileInterruptedRuns } from '../../runtime/reconcile.js'
import { installBrowserInBackground, installDesktopInBackground, updateCliToolsInBackground } from './update.js'
import { CODEX_VERSION } from '../../runtime/codex-cli.js'
import { listConnections } from '../../connections/registry.js'
import { refreshStaleCodexPlanLimits } from '../../connections/codex-plan-limits.js'
import { refreshStaleCustomCatalogs } from '../../connections/custom-catalog.js'
import { refreshOpencodeCatalog } from '../../connections/opencode-catalog.js'
import { refreshStaleOpencodePlanLimits } from '../../connections/opencode-plan-limits.js'
import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { closeAllMcp } from '../../tools/mcp-pool.js'
import { loadPairingIdentity, pairWithHub } from '../../pairing/pairing.js'
import { settleLastUpdateOnBoot } from '../../runtime/last-update.js'

export async function runCommand(): Promise<void> {
    loadPairingIdentity()
    await prepareDataDir()
    const lastUpdate = settleLastUpdateOnBoot()
    if (lastUpdate?.status === 'error') logger.warn({ error: lastUpdate.error, commit: lastUpdate.commit }, 'last update did not land')
    await ensureForeman()
    // Here and not in prepareDataDir: the CLI commands that also prepare the folder run beside a live
    // engine, and the skills it writes take locks that only hold inside one process.
    await reconcileVault()
    await reconcileInterruptedRuns()
    if (await installBrowserInBackground()) logger.info('chromium missing: installing it in the background')
    if (installDesktopInBackground()) logger.info('desktop missing: installing it in the background')
    const cliTools = updateCliToolsInBackground()
    if (cliTools === 'spawned') logger.info({ codex: CODEX_VERSION }, 'codex CLI off its pin: installing it in the background')
    if (cliTools === 'no-root') logger.warn({ codex: CODEX_VERSION }, 'codex CLI off its pin and the service user cannot sudo: run `sudo rerun update-cli-tools`')
    void listConnections()
        .then(connections => {
            refreshStaleCodexPlanLimits(connections)
            refreshStaleOpencodePlanLimits(connections)
            if (connections.some(connection => connection.config.provider === 'opencode')) void refreshOpencodeCatalog()
            refreshStaleCustomCatalogs(connections)
        })
        .catch(err => logger.warn({ err: String(err) }, 'plan limits boot read skipped'))
    const stopScheduler = startScheduler()
    logger.info('scheduler started')
    const { RERUN_PORT, RERUN_HOST, RERUN_API_KEY } = env()
    // Node closes any request that takes more than 5 minutes, which a 100 MB upload on a slow link
    // reaches. Raised rather than disabled: a zero here would drop the Slowloris guard with it.
    const serverOptions = { requestTimeout: 30 * 60 * 1000, headersTimeout: 60_000 }
    const server = serve({ fetch: createServer().fetch, port: RERUN_PORT, hostname: RERUN_HOST, serverOptions }, info => {
        logger.info({ port: info.port, host: RERUN_HOST, authenticated: Boolean(RERUN_API_KEY) }, 'rerun-engine listening')
        void pairWithHub()
    })
    attachDesktopBridge(server as Server)
    // The pooled MCP servers are closed before the process goes, within a short grace: one that does
    // not answer its close is left to systemd, which stops the whole cgroup.
    const shutdown = () => {
        stopScheduler()
        const grace = new Promise<void>(resolve => setTimeout(resolve, 2_000).unref())
        void Promise.race([closeAllMcp(), grace]).finally(() => process.exit(0))
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
}
