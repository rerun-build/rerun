import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { activeRunCount } from '../../runtime/run-control.js'
import { desktopViewerCount } from '../../desktop/session.js'
import { takeoversInUse } from '../../desktop/takeover.js'
import { buildCommit } from '../../runtime/build-info.js'
import { readLastUpdate } from '../../runtime/last-update.js'
import { artifactArgs } from '../../cli/commands/release.js'
import { dataDir } from '../../config/paths.js'
import { logger } from '../../lib/logger.js'

export const updateRoutes = new Hono()

// Checked here, before anything is spawned: the hub waits 15 s for this answer and the download
// belongs to the detached updater.
const artifactSchema = z.object({
    url: z.string().url().refine(url => url.startsWith('https://'), 'artifact url must be https'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 hex characters'),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/, 'commit must be a git commit hash'),
    bytes: z.number().int().positive().optional(),
})

const updateRequestSchema = z.object({ force: z.boolean().optional(), artifact: artifactSchema.optional() })

let updating = false

// Self-update: spawn a detached `rerun update` (download or git pull → migrate → restart). The child
// stays in the systemd cgroup but finishes its work before it triggers the restart, and the restart
// job is owned by systemd (PID 1), so the engine comes back on the new build even though the child
// is killed by that very restart. Refuses while a run is in flight.
updateRoutes.post('/', async c => {
    const raw = await c.req.json().catch(() => ({}))
    const parsed = updateRequestSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: `invalid update request: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')}` }, 400)
    const { force = false, artifact } = parsed.data

    const activeRuns = activeRunCount()
    // A restart would cut the screen of whoever is signing in for an agent right now. A browser only
    // kept open for a run's next turn does not hold the update back.
    if (!force && (activeRuns > 0 || desktopViewerCount() > 0 || takeoversInUse().length > 0)) return c.json({ started: false, reason: 'busy', activeRuns })
    if (updating) return c.json({ started: false, reason: 'already-updating' })
    updating = true

    const logFd = openSync(resolve(dataDir(), 'update.log'), 'a')
    const child = spawn(process.execPath, [process.argv[1]!, 'update', ...(artifact ? artifactArgs(artifact) : [])], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, CI: 'true' },
    })
    child.on('error', err => {
        updating = false
        logger.error({ err: String(err) }, 'failed to spawn engine self-update')
    })
    // An updater that gave up (checksum, disk, build) must not leave the box answering `already-updating` until its next restart.
    child.on('exit', code => {
        updating = false
        if (code) logger.error({ code }, 'engine self-update exited with an error')
    })
    child.unref()
    closeSync(logFd)

    logger.info({ commit: buildCommit(), artifact: artifact?.commit ?? null }, 'engine self-update started')
    return c.json({ started: true, commit: buildCommit(), lastUpdate: readLastUpdate() }, 202)
})
