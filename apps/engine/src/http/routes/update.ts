import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { activeRunCount } from '../../runtime/run-control.js'
import { desktopViewerCount } from '../../desktop/session.js'
import { activeTakeovers } from '../../desktop/takeover.js'
import { buildCommit } from '../../runtime/build-info.js'
import { readLastUpdate } from '../../runtime/last-update.js'
import { artifactArgs } from '../../cli/commands/release.js'
import { dataDir } from '../../config/paths.js'
import { logger } from '../../lib/logger.js'
import { childProcessEnv } from '../../lib/child-env.js'

const UPDATE_CHILD_VARS = ['RERUN_SERVICE', 'RERUN_SERVICE_USER', 'RERUN_DESKTOP', 'RERUN_CODEX_PATH', 'RERUN_LOG_LEVEL'] as const

export function updateChildEnv(): Record<string, string> {
    const passed: Record<string, string> = {}
    for (const name of UPDATE_CHILD_VARS) {
        const value = process.env[name]
        if (value) passed[name] = value
    }
    return childProcessEnv({}, { CI: 'true', RERUN_DATA_DIR: dataDir(), ...passed })
}

export const updateRoutes = new Hono()

const artifactSchema = z.object({
    url: z.string().url().refine(url => url.startsWith('https://'), 'artifact url must be https'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 hex characters'),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/, 'commit must be a git commit hash'),
    bytes: z.number().int().positive().optional(),
})

const updateRequestSchema = z.object({ force: z.boolean().optional(), artifact: artifactSchema.optional() })

let updating = false

updateRoutes.post('/', async c => {
    const raw = await c.req.json().catch(() => ({}))
    const parsed = updateRequestSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: `invalid update request: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')}` }, 400)
    const { force = false, artifact } = parsed.data

    const activeRuns = activeRunCount()
    if (!force && (activeRuns > 0 || desktopViewerCount() > 0 || activeTakeovers().length > 0)) return c.json({ started: false, reason: 'busy', activeRuns })
    if (updating) return c.json({ started: false, reason: 'already-updating' })
    updating = true

    const logFd = openSync(resolve(dataDir(), 'update.log'), 'a')
    const child = spawn(process.execPath, [process.argv[1]!, 'update', ...(artifact ? artifactArgs(artifact) : [])], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: updateChildEnv(),
    })
    child.on('error', err => {
        updating = false
        logger.error({ err: String(err) }, 'failed to spawn engine self-update')
    })
    child.on('exit', code => {
        updating = false
        if (code) logger.error({ code }, 'engine self-update exited with an error')
    })
    child.unref()
    closeSync(logFd)

    logger.info({ commit: buildCommit(), artifact: artifact?.commit ?? null }, 'engine self-update started')
    return c.json({ started: true, commit: buildCommit(), lastUpdate: readLastUpdate() }, 202)
})
