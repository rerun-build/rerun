import { readFile, readdir, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { providerSchema, scheduleScriptSchema, type MessageAuthor, type Provider, type ScheduleKind, type ScheduleScript } from '@rerun/contracts'
import { scheduleFile, schedulesDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { nowIso, slugify } from '../lib/ids.js'
import { withKeyedLock } from '../lib/lock.js'
import { authorMetadata, sendNotification } from '../runtime/notify.js'

export type Schedule = {
    slug: string
    name: string
    description: string
    enabled: boolean
    cron: string | null
    runAt: string | null
    timezone: string | null
    lastRunAt: string | null
    connectionId: string | null
    provider: Provider | null
    model: string | null
    // A routine the Chief of Staff set itself to come back to something: it fires as a check-in,
    // which reads and speaks only when there is something to say.
    checkIn: boolean
    // A script runs `body` as a shell command, with no model: see `script-run.ts`.
    kind: ScheduleKind
    script: ScheduleScript | null
    body: string
    createdAt: string
}

export type ScheduleInput = {
    name: string
    description?: string
    body: string
    cron?: string | null
    runAt?: string | null
    timezone?: string | null
    enabled?: boolean
    connectionId?: string | null
    provider?: Provider | null
    model?: string | null
    checkIn?: boolean
    kind?: ScheduleKind
    script?: ScheduleScript | null
}

const PROVIDERS: Provider[] = providerSchema.options

function str(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function toProvider(value: unknown): Provider | null {
    return typeof value === 'string' && (PROVIDERS as string[]).includes(value) ? (value as Provider) : null
}

// Field by field: one value the engine no longer offers falls back on its own, and never sends a
// script meant for a linked computer to the workspace machine.
function toScript(data: Record<string, unknown>): ScheduleScript {
    const { shape } = scheduleScriptSchema
    const field = <K extends keyof typeof shape>(key: K, value: unknown) => {
        const parsed = shape[key].safeParse(value ?? undefined)
        return (parsed.success ? parsed.data : shape[key].parse(undefined)) as ScheduleScript[K]
    }
    return { runsOn: field('runsOn', str(data.runsOn)), folder: field('folder', data.folder), timeoutSec: field('timeoutSec', data.timeoutSec), notify: field('notify', data.notify) }
}

// A script runs no model and is never a check-in: whatever an older file or a caller says about those
// is dropped, and an instruction keeps no script settings.
function normalized(schedule: Schedule): Schedule {
    if (schedule.kind !== 'script') return { ...schedule, script: null }
    return { ...schedule, script: schedule.script ?? scheduleScriptSchema.parse({}), connectionId: null, provider: null, model: null, checkIn: false }
}

function toSchedule(slug: string, raw: string): Schedule {
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const kind: ScheduleKind = data.kind === 'script' ? 'script' : 'instruction'
    return normalized({
        slug,
        name: typeof data.name === 'string' ? data.name : slug,
        description: typeof data.description === 'string' ? data.description : '',
        enabled: data.enabled !== false,
        cron: str(data.cron),
        runAt: str(data.runAt),
        timezone: str(data.timezone),
        lastRunAt: str(data.lastRunAt),
        connectionId: str(data.connection),
        provider: toProvider(data.provider),
        model: str(data.model),
        checkIn: data.checkIn === true,
        kind,
        script: kind === 'script' ? toScript(data) : null,
        body: parsed.content.trim(),
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    })
}

function serialize(schedule: Schedule): string {
    return matter.stringify(`\n${schedule.body.trim()}\n`, {
        name: schedule.name,
        description: schedule.description,
        enabled: schedule.enabled,
        cron: schedule.cron,
        runAt: schedule.runAt,
        timezone: schedule.timezone,
        lastRunAt: schedule.lastRunAt,
        connection: schedule.connectionId,
        provider: schedule.provider,
        model: schedule.model,
        // Written only when set, so every other routine keeps the file it had.
        ...(schedule.checkIn ? { checkIn: true } : {}),
        ...(schedule.kind === 'script' && schedule.script
            ? { kind: 'script', runsOn: schedule.script.runsOn, folder: schedule.script.folder, timeoutSec: schedule.script.timeoutSec, notify: schedule.script.notify }
            : {}),
        createdAt: schedule.createdAt,
    })
}

export function scheduleExists(agentId: string, slug: string): boolean {
    return existsSync(scheduleFile(agentId, slug))
}

export async function listSchedules(agentId: string): Promise<Schedule[]> {
    const root = schedulesDir(agentId)
    if (!existsSync(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    const schedules: Schedule[] = []
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const slug = entry.name.slice(0, -3)
        // A one-off deletes itself once its run is done, possibly between the readdir and this read.
        const raw = await readFile(scheduleFile(agentId, slug), 'utf8').catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') return null
            throw err
        })
        if (raw !== null) schedules.push(toSchedule(slug, raw))
    }
    return schedules
}

export async function readSchedule(agentId: string, slug: string): Promise<Schedule> {
    return toSchedule(slug, await readFile(scheduleFile(agentId, slug), 'utf8'))
}

// Every read-modify-write of one schedule file goes through here, so the scheduler marking it fired
// and the agent editing it can never read the file while the other is rewriting it.
function withScheduleLock<T>(agentId: string, slug: string, fn: () => Promise<T>): Promise<T> {
    return withKeyedLock(`schedule:${agentId}:${slug}`, fn)
}

// A file with no front matter was not written by `serialize`: re-serializing it would turn it into
// an enabled schedule with no cron and no body.
async function readScheduleForUpdate(agentId: string, slug: string): Promise<Schedule> {
    const raw = await readFile(scheduleFile(agentId, slug), 'utf8')
    if (!matter.test(raw)) throw new Error(`schedule ${slug} has no front matter, refusing to rewrite it`)
    return toSchedule(slug, raw)
}

export async function writeSchedule(agentId: string, input: ScheduleInput, author?: MessageAuthor): Promise<Schedule> {
    const slug = slugify(input.name)
    const { schedule, created } = await withScheduleLock(agentId, slug, async () => {
        const existing = scheduleExists(agentId, slug) ? await readScheduleForUpdate(agentId, slug) : null
        const next: Schedule = normalized({
            slug,
            name: input.name,
            description: input.description ?? existing?.description ?? '',
            enabled: input.enabled ?? existing?.enabled ?? true,
            cron: input.cron ?? existing?.cron ?? null,
            runAt: input.runAt ?? existing?.runAt ?? null,
            timezone: input.timezone ?? existing?.timezone ?? null,
            lastRunAt: existing?.lastRunAt ?? null,
            // `!== undefined` rather than `??`: null is a value here, the one that says "follow the
            // agent", and coalescing would silently keep the pair the caller just cleared.
            connectionId: input.connectionId !== undefined ? input.connectionId : (existing?.connectionId ?? null),
            provider: input.provider !== undefined ? input.provider : (existing?.provider ?? null),
            model: input.model !== undefined ? input.model : (existing?.model ?? null),
            checkIn: input.checkIn ?? existing?.checkIn ?? false,
            kind: input.kind ?? existing?.kind ?? 'instruction',
            script: input.script !== undefined ? input.script : (existing?.script ?? null),
            body: input.body,
            createdAt: existing?.createdAt || nowIso(),
        })
        await mkdir(schedulesDir(agentId), { recursive: true })
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(next))
        return { schedule: next, created: !existing }
    })
    // Every author lands here (the API, the Foreman, the agent's own tool), so this is the one place
    // that can tell the hub a first schedule exists. Fire and forget, like every notification.
    // `authorId` is the member whose chat message led the agent to create it, when there was one.
    if (created) void sendNotification({ event: 'agent.schedule.created', kind: 'info', agentId, message: schedule.name, metadata: { scheduleSlug: slug, ...authorMetadata(author) } })
    return schedule
}

export type SchedulePatch = Partial<Pick<Schedule, 'name' | 'description' | 'body' | 'cron' | 'runAt' | 'timezone' | 'enabled' | 'connectionId' | 'provider' | 'model' | 'kind' | 'script'>>

// Edits the file at its own slug. `name` is only the label: the slug, and with it the file, the run
// history and the hub's references, stay what they were when the schedule was created.
export async function updateScheduleAt(agentId: string, slug: string, patch: SchedulePatch): Promise<Schedule> {
    return withScheduleLock(agentId, slug, async () => {
        const current = await readScheduleForUpdate(agentId, slug)
        const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as SchedulePatch
        const next = normalized({ ...current, ...defined })
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(next))
        return next
    })
}

export async function rewriteScheduleText(agentId: string, slug: string, rewrite: (text: string) => string): Promise<boolean> {
    if (!scheduleExists(agentId, slug)) return false
    return withScheduleLock(agentId, slug, async () => {
        const current = await readScheduleForUpdate(agentId, slug)
        const next: Schedule = { ...current, body: rewrite(current.body), description: rewrite(current.description) }
        if (next.body === current.body && next.description === current.description) return false
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(next))
        return true
    })
}

export async function deleteSchedule(agentId: string, slug: string): Promise<void> {
    await rm(scheduleFile(agentId, slug), { force: true })
}

export async function markFired(agentId: string, slug: string, firedAt: string): Promise<void> {
    if (!scheduleExists(agentId, slug)) return
    await withScheduleLock(agentId, slug, async () => {
        const schedule = await readScheduleForUpdate(agentId, slug)
        schedule.lastRunAt = firedAt
        if (schedule.runAt) schedule.enabled = false
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(schedule))
    })
}

// Only the file the scheduler stamped at `firedAt` goes, still as it was fired: an edit made while the
// run was going (a new date, a new body, a cron, switched back on) is the user's newer intent and
// keeps the schedule.
export async function deleteFiredOneOff(agentId: string, fired: Schedule, firedAt: string): Promise<boolean> {
    const { slug } = fired
    if (!scheduleExists(agentId, slug)) return false
    return withScheduleLock(agentId, slug, async () => {
        const current = await readScheduleForUpdate(agentId, slug)
        if (!current.runAt || current.cron || current.enabled || current.lastRunAt !== firedAt) return false
        if (current.runAt !== fired.runAt || current.body !== fired.body) return false
        await rm(scheduleFile(agentId, slug), { force: true })
        return true
    })
}

// Back to "runs whatever the agent runs". Written at the schedule's own slug for the same reason
// as `updateScheduleAt`.
export async function clearScheduleModel(agentId: string, slug: string): Promise<void> {
    if (!scheduleExists(agentId, slug)) return
    await withScheduleLock(agentId, slug, async () => {
        const schedule = await readScheduleForUpdate(agentId, slug)
        schedule.connectionId = null
        schedule.provider = null
        schedule.model = null
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(schedule))
    })
}

// Written at the schedule's own slug for the same reason as `updateScheduleAt`: `writeSchedule`
// re-derives the slug from the name, so a renamed schedule would land in a second file and the
// original would stay behind, still enabled.
export async function setScheduleEnabled(agentId: string, slug: string, enabled: boolean, baselineAt?: string): Promise<void> {
    if (!scheduleExists(agentId, slug)) return
    await withScheduleLock(agentId, slug, async () => {
        const schedule = await readScheduleForUpdate(agentId, slug)
        schedule.enabled = enabled
        if (baselineAt) schedule.lastRunAt = baselineAt
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(schedule))
    })
}
