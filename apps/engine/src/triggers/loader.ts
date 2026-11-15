import { readFile, readdir, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { providerSchema, triggerMethodSchema, type MessageAuthor, type Provider, type TriggerMethod } from '@rerun/contracts'
import { triggerFile, triggersDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { newId, nowIso, slugify } from '../lib/ids.js'
import { withKeyedLock } from '../lib/lock.js'
import { authorMetadata, sendNotification } from '../runtime/notify.js'

export type Trigger = {
    slug: string
    name: string
    description: string
    enabled: boolean
    token: string
    methods: TriggerMethod[]
    lastFiredAt: string | null
    fireCount: number
    connectionId: string | null
    provider: Provider | null
    model: string | null
    body: string
    createdAt: string
}

export type TriggerInput = {
    name: string
    description?: string
    body: string
    methods?: TriggerMethod[]
    enabled?: boolean
    connectionId?: string | null
    provider?: Provider | null
    model?: string | null
}

const PROVIDERS: Provider[] = providerSchema.options
const METHODS: TriggerMethod[] = triggerMethodSchema.options
const DEFAULT_METHODS: TriggerMethod[] = ['POST']

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isSafeSlug(slug: string): boolean {
    return SLUG_RE.test(slug)
}

export function newTriggerToken(): string {
    return newId()
}

function str(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function toProvider(value: unknown): Provider | null {
    return typeof value === 'string' && (PROVIDERS as string[]).includes(value) ? (value as Provider) : null
}

function toMethods(value: unknown): TriggerMethod[] {
    if (!Array.isArray(value)) return DEFAULT_METHODS
    const methods = value.filter((m): m is TriggerMethod => typeof m === 'string' && (METHODS as string[]).includes(m))
    return methods.length > 0 ? methods : DEFAULT_METHODS
}

function toTrigger(slug: string, raw: string): Trigger {
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    return {
        slug,
        name: typeof data.name === 'string' ? data.name : slug,
        description: typeof data.description === 'string' ? data.description : '',
        enabled: data.enabled !== false,
        token: typeof data.token === 'string' ? data.token : '',
        methods: toMethods(data.methods),
        lastFiredAt: str(data.lastFiredAt),
        fireCount: typeof data.fireCount === 'number' && Number.isFinite(data.fireCount) ? data.fireCount : 0,
        connectionId: str(data.connection),
        provider: toProvider(data.provider),
        model: str(data.model),
        body: parsed.content.trim(),
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    }
}

function serialize(trigger: Trigger): string {
    return matter.stringify(`\n${trigger.body.trim()}\n`, {
        name: trigger.name,
        description: trigger.description,
        enabled: trigger.enabled,
        token: trigger.token,
        methods: trigger.methods,
        lastFiredAt: trigger.lastFiredAt,
        fireCount: trigger.fireCount,
        connection: trigger.connectionId,
        provider: trigger.provider,
        model: trigger.model,
        createdAt: trigger.createdAt,
    })
}

export function redactTriggerForArchive(trigger: Trigger): string {
    return serialize({ ...trigger, token: '', enabled: false, lastFiredAt: null, fireCount: 0 })
}

export function triggerExists(agentId: string, slug: string): boolean {
    return isSafeSlug(slug) && existsSync(triggerFile(agentId, slug))
}

export async function listTriggers(agentId: string): Promise<Trigger[]> {
    const root = triggersDir(agentId)
    if (!existsSync(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    const triggers: Trigger[] = []
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const slug = entry.name.slice(0, -3)
        if (!isSafeSlug(slug)) continue
        triggers.push(toTrigger(slug, await readFile(triggerFile(agentId, slug), 'utf8')))
    }
    return triggers
}

export async function readTrigger(agentId: string, slug: string): Promise<Trigger> {
    if (!isSafeSlug(slug)) throw new Error('invalid trigger slug')
    return toTrigger(slug, await readFile(triggerFile(agentId, slug), 'utf8'))
}

function withTriggerLock<T>(agentId: string, slug: string, fn: () => Promise<T>): Promise<T> {
    return withKeyedLock(`trigger:${agentId}:${slug}`, fn)
}

async function readTriggerForUpdate(agentId: string, slug: string): Promise<Trigger> {
    if (!isSafeSlug(slug)) throw new Error('invalid trigger slug')
    const raw = await readFile(triggerFile(agentId, slug), 'utf8')
    if (!matter.test(raw)) throw new Error(`trigger ${slug} has no front matter, refusing to rewrite it`)
    return toTrigger(slug, raw)
}

export async function writeTrigger(agentId: string, input: TriggerInput, author?: MessageAuthor): Promise<Trigger> {
    const slug = slugify(input.name)
    if (!isSafeSlug(slug)) throw new Error('trigger name must contain at least one letter or digit')
    const { trigger, created } = await withTriggerLock(agentId, slug, async () => {
        const existing = triggerExists(agentId, slug) ? await readTriggerForUpdate(agentId, slug) : null
        const next: Trigger = {
            slug,
            name: input.name,
            description: input.description ?? existing?.description ?? '',
            enabled: input.enabled ?? existing?.enabled ?? true,
            token: existing?.token || newTriggerToken(),
            methods: input.methods ?? existing?.methods ?? DEFAULT_METHODS,
            lastFiredAt: existing?.lastFiredAt ?? null,
            fireCount: existing?.fireCount ?? 0,
            connectionId: input.connectionId !== undefined ? input.connectionId : (existing?.connectionId ?? null),
            provider: input.provider !== undefined ? input.provider : (existing?.provider ?? null),
            model: input.model !== undefined ? input.model : (existing?.model ?? null),
            body: input.body,
            createdAt: existing?.createdAt || nowIso(),
        }
        await mkdir(triggersDir(agentId), { recursive: true })
        await writeFileAtomic(triggerFile(agentId, slug), serialize(next))
        return { trigger: next, created: !existing }
    })
    if (created) void sendNotification({ event: 'agent.trigger.created', kind: 'info', agentId, message: trigger.name, metadata: { triggerSlug: slug, ...authorMetadata(author) } })
    return trigger
}

export async function rewriteTriggerText(agentId: string, slug: string, rewrite: (text: string) => string): Promise<boolean> {
    if (!triggerExists(agentId, slug)) return false
    return withTriggerLock(agentId, slug, async () => {
        const current = await readTriggerForUpdate(agentId, slug)
        const next: Trigger = { ...current, body: rewrite(current.body), description: rewrite(current.description) }
        if (next.body === current.body && next.description === current.description) return false
        await writeFileAtomic(triggerFile(agentId, slug), serialize(next))
        return true
    })
}

export async function deleteTrigger(agentId: string, slug: string): Promise<void> {
    if (!isSafeSlug(slug)) return
    await rm(triggerFile(agentId, slug), { force: true })
}

export async function rotateTriggerToken(agentId: string, slug: string): Promise<Trigger> {
    return withTriggerLock(agentId, slug, async () => {
        const trigger = await readTriggerForUpdate(agentId, slug)
        trigger.token = newTriggerToken()
        await writeFileAtomic(triggerFile(agentId, slug), serialize(trigger))
        return trigger
    })
}

export async function clearTriggerModel(agentId: string, slug: string): Promise<void> {
    if (!triggerExists(agentId, slug)) return
    await withTriggerLock(agentId, slug, async () => {
        const trigger = await readTriggerForUpdate(agentId, slug)
        trigger.connectionId = null
        trigger.provider = null
        trigger.model = null
        await writeFileAtomic(triggerFile(agentId, slug), serialize(trigger))
    })
}

export async function setTriggerEnabled(agentId: string, slug: string, enabled: boolean): Promise<void> {
    if (!triggerExists(agentId, slug)) return
    await withTriggerLock(agentId, slug, async () => {
        const trigger = await readTriggerForUpdate(agentId, slug)
        trigger.enabled = enabled
        if (enabled && !trigger.token) trigger.token = newTriggerToken()
        await writeFileAtomic(triggerFile(agentId, slug), serialize(trigger))
    })
}

export async function markFired(agentId: string, slug: string, firedAt: string): Promise<void> {
    if (!triggerExists(agentId, slug)) return
    await withTriggerLock(agentId, slug, async () => {
        const trigger = await readTriggerForUpdate(agentId, slug)
        trigger.lastFiredAt = firedAt
        trigger.fireCount += 1
        await writeFileAtomic(triggerFile(agentId, slug), serialize(trigger))
    })
}
