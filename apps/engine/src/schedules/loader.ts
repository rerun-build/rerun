import { readFile, readdir, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { providerSchema, type MessageAuthor, type Provider } from '@rerun/contracts'
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
}

const PROVIDERS: Provider[] = providerSchema.options

function str(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function toProvider(value: unknown): Provider | null {
    return typeof value === 'string' && (PROVIDERS as string[]).includes(value) ? (value as Provider) : null
}

function toSchedule(slug: string, raw: string): Schedule {
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    return {
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
        body: parsed.content.trim(),
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    }
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
        schedules.push(toSchedule(slug, await readFile(scheduleFile(agentId, slug), 'utf8')))
    }
    return schedules
}

export async function readSchedule(agentId: string, slug: string): Promise<Schedule> {
    return toSchedule(slug, await readFile(scheduleFile(agentId, slug), 'utf8'))
}

function withScheduleLock<T>(agentId: string, slug: string, fn: () => Promise<T>): Promise<T> {
    return withKeyedLock(`schedule:${agentId}:${slug}`, fn)
}

async function readScheduleForUpdate(agentId: string, slug: string): Promise<Schedule> {
    const raw = await readFile(scheduleFile(agentId, slug), 'utf8')
    if (!matter.test(raw)) throw new Error(`schedule ${slug} has no front matter, refusing to rewrite it`)
    return toSchedule(slug, raw)
}

export async function writeSchedule(agentId: string, input: ScheduleInput, author?: MessageAuthor): Promise<Schedule> {
    const slug = slugify(input.name)
    const { schedule, created } = await withScheduleLock(agentId, slug, async () => {
        const existing = scheduleExists(agentId, slug) ? await readScheduleForUpdate(agentId, slug) : null
        const next: Schedule = {
            slug,
            name: input.name,
            description: input.description ?? existing?.description ?? '',
            enabled: input.enabled ?? existing?.enabled ?? true,
            cron: input.cron ?? existing?.cron ?? null,
            runAt: input.runAt ?? existing?.runAt ?? null,
            timezone: input.timezone ?? existing?.timezone ?? null,
            lastRunAt: existing?.lastRunAt ?? null,
            connectionId: input.connectionId !== undefined ? input.connectionId : (existing?.connectionId ?? null),
            provider: input.provider !== undefined ? input.provider : (existing?.provider ?? null),
            model: input.model !== undefined ? input.model : (existing?.model ?? null),
            body: input.body,
            createdAt: existing?.createdAt || nowIso(),
        }
        await mkdir(schedulesDir(agentId), { recursive: true })
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(next))
        return { schedule: next, created: !existing }
    })
    if (created) void sendNotification({ event: 'agent.schedule.created', kind: 'info', agentId, message: schedule.name, metadata: { scheduleSlug: slug, ...authorMetadata(author) } })
    return schedule
}

export type SchedulePatch = Partial<Pick<Schedule, 'name' | 'description' | 'body' | 'cron' | 'runAt' | 'timezone' | 'enabled' | 'connectionId' | 'provider' | 'model'>>

export async function updateScheduleAt(agentId: string, slug: string, patch: SchedulePatch): Promise<Schedule> {
    return withScheduleLock(agentId, slug, async () => {
        const current = await readScheduleForUpdate(agentId, slug)
        const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as SchedulePatch
        const next: Schedule = { ...current, ...defined }
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

export async function setScheduleEnabled(agentId: string, slug: string, enabled: boolean, baselineAt?: string): Promise<void> {
    if (!scheduleExists(agentId, slug)) return
    await withScheduleLock(agentId, slug, async () => {
        const schedule = await readScheduleForUpdate(agentId, slug)
        schedule.enabled = enabled
        if (baselineAt) schedule.lastRunAt = baselineAt
        await writeFileAtomic(scheduleFile(agentId, slug), serialize(schedule))
    })
}
