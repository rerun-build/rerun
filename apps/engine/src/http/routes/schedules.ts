import { Hono } from 'hono'
import { z } from 'zod'
import { providerSchema, scheduleKindSchema, scheduleScriptSchema, type ScheduleScript } from '@rerun/contracts'
import { deleteSchedule, listSchedules, readSchedule, scheduleExists, updateScheduleAt, writeSchedule } from '../../schedules/loader.js'
import { isValidCron, isValidTimezone } from '../../schedules/cron.js'
import { isValidScriptFolder } from '../../schedules/script-run.js'
import { scriptComputer } from '../../schedules/script-remote.js'
import { fireSchedule } from '../../runtime/scheduler.js'
import { getAgent } from '../../agents/registry.js'
import { hasPendingSetup } from '../../agents/setup.js'
import { setupPending } from '../../lib/errors.js'

export const scheduleRoutes = new Hono()

// A folder on a linked computer is that computer's to resolve.
const validScriptFolder = (script: { runsOn: string | null; folder: string }) => Boolean(script.runsOn) || isValidScriptFolder(script.folder)

// A linked computer may be named by its #handle or its name, as an agent knows it: the routine keeps
// its id. One that is no longer linked is kept only when the routine already ran there.
async function withComputerId(script: ScheduleScript, kept: string | null = null): Promise<ScheduleScript | null> {
    if (!script.runsOn) return script
    const { view } = await scriptComputer(script.runsOn)
    if (view) return { ...script, runsOn: view.id }
    return script.runsOn === kept ? script : null
}

const UNKNOWN_COMPUTER = 'no linked computer has this handle, name or id'

const createSchema = z
    .object({
        name: z.string().min(1),
        description: z.string().default(''),
        body: z.string().min(1),
        cron: z.string().optional(),
        runAt: z.string().optional(),
        timezone: z.string().optional(),
        enabled: z.boolean().optional(),
        connectionId: z.string().nullable().optional(),
        // Null on both means "whatever the agent runs", which is itself the box default when the
        // agent picked nothing. A routine only freezes a pair when someone chose one.
        provider: providerSchema.nullable().default(null),
        model: z.string().nullable().default(null),
        // A script runs `body` as a shell command, with no model.
        kind: scheduleKindSchema.default('instruction'),
        script: scheduleScriptSchema.nullable().optional(),
    })
    .refine(d => Boolean(d.cron) !== Boolean(d.runAt), { message: 'Provide exactly one of cron or runAt' })
    .refine(d => d.kind !== 'script' || (!d.provider && !d.model && !d.connectionId), { message: 'A script runs no model' })
    .refine(d => !d.script || validScriptFolder(d.script), { message: 'The folder must be inside shared/ or workspace/' })
    .refine(d => !d.cron || isValidCron(d.cron), { message: 'Invalid cron expression' })
    .refine(d => !d.runAt || !Number.isNaN(new Date(d.runAt).getTime()), { message: 'Invalid runAt timestamp' })
    .refine(d => !d.timezone || isValidTimezone(d.timezone), { message: 'Invalid timezone' })

scheduleRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    return c.json({ schedules: await listSchedules(agentId) })
})

scheduleRoutes.post('/', async c => {
    const agentId = c.req.param('id')!
    const body = createSchema.parse(await c.req.json())
    const script = body.script ? await withComputerId(body.script) : body.script
    if (script === null && body.script) return c.json({ error: UNKNOWN_COMPUTER }, 400)
    const schedule = await writeSchedule(agentId, { ...body, script })
    return c.json(schedule, 201)
})

scheduleRoutes.get('/:slug', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!scheduleExists(agentId, slug)) return c.json({ error: 'schedule not found' }, 404)
    return c.json(await readSchedule(agentId, slug))
})

scheduleRoutes.patch('/:slug', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!scheduleExists(agentId, slug)) return c.json({ error: 'schedule not found' }, 404)
    const body = z
        .object({
            name: z.string().trim().min(1).max(120).optional(),
            description: z.string().optional(),
            body: z.string().optional(),
            cron: z.string().optional(),
            runAt: z.string().optional(),
            timezone: z.string().optional(),
            enabled: z.boolean().optional(),
            connectionId: z.string().nullable().optional(),
            provider: providerSchema.nullable().optional(),
            model: z.string().nullable().optional(),
            kind: scheduleKindSchema.optional(),
            script: scheduleScriptSchema.nullable().optional(),
        })
        .parse(await c.req.json())
    if (body.script && !validScriptFolder(body.script)) return c.json({ error: 'the folder must be inside shared/ or workspace/' }, 400)
    if (body.cron && !isValidCron(body.cron)) return c.json({ error: 'invalid cron expression' }, 400)
    if (body.runAt && Number.isNaN(new Date(body.runAt).getTime())) return c.json({ error: 'invalid runAt timestamp' }, 400)
    if (body.timezone && !isValidTimezone(body.timezone)) return c.json({ error: 'invalid timezone' }, 400)
    const script = body.script ? await withComputerId(body.script, (await readSchedule(agentId, slug)).script?.runsOn) : body.script
    if (script === null && body.script) return c.json({ error: UNKNOWN_COMPUTER }, 400)
    const schedule = await updateScheduleAt(agentId, slug, { ...body, script })
    return c.json(schedule)
})

scheduleRoutes.post('/:slug/run', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!scheduleExists(agentId, slug)) return c.json({ error: 'schedule not found' }, 404)
    const schedule = await readSchedule(agentId, slug)
    // A schedule still paused for the install would start in a fresh session carrying the install
    // prompt and tools, and run a second install beside the real one. Skipping the setup switches
    // the schedules on, which lifts this.
    if (hasPendingSetup(await getAgent(agentId)) && !schedule.enabled) throw setupPending()
    // A manual run is a deliberate probe: it may clear a budget or subscription latch, or re-arm it
    // and show the failure in the UI.
    // A script run answers an empty session: it has no conversation to open.
    const { runId, sessionId } = await fireSchedule(agentId, schedule, { markFired: false, manual: true })
    return c.json({ runId, sessionId }, 202)
})

scheduleRoutes.delete('/:slug', async c => {
    const agentId = c.req.param('id')!
    const slug = c.req.param('slug')
    if (!scheduleExists(agentId, slug)) return c.json({ error: 'schedule not found' }, 404)
    await deleteSchedule(agentId, slug)
    return c.json({ deleted: slug })
})
