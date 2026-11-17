import { mkdir, readFile } from 'node:fs/promises'
import { z } from 'zod'
import { remoteCapabilitySchema, remoteComputerIdentitySchema, remoteComputerSettingsSchema, remoteFactsSchema, type RemoteCapability, type RemoteComputerIdentity, type RemoteComputerRule, type RemoteComputerSettingsPatch, type RemoteFacts } from '@rerun/contracts'
import { remoteComputersPath, remoteDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { withKeyedLock } from '../lib/lock.js'
import { logger } from '../lib/logger.js'

const settingsOrDefaults = z.preprocess(value => value ?? {}, remoteComputerSettingsSchema)

const storedComputerSchema = remoteComputerIdentitySchema.extend({
    settings: settingsOrDefaults,
    lastSeenAt: z.string().nullable().default(null),
    appVersion: z.string().nullable().default(null),
    protocol: z.number().nullable().default(null),
    capabilities: z.array(remoteCapabilitySchema.or(z.string())).default([]).transform(list => list.filter((c): c is RemoteCapability => remoteCapabilitySchema.safeParse(c).success)),
    facts: remoteFactsSchema.nullable().catch(null).default(null),
})
export type StoredComputer = z.infer<typeof storedComputerSchema>

const LOCK = 'remote-computers'

// A file written by a newer engine or touched by hand keeps every computer this engine can still
// read; one it cannot is logged and left out rather than failing the whole list.
export async function readComputers(): Promise<StoredComputer[]> {
    let raw: string
    try {
        raw = await readFile(remoteComputersPath(), 'utf8')
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    let entries: unknown
    try {
        entries = (JSON.parse(raw) as { computers?: unknown }).computers
    } catch {
        logger.warn({ path: remoteComputersPath() }, 'remote computers file unreadable: read as empty')
        return []
    }
    if (!Array.isArray(entries)) return []
    return entries.flatMap(entry => {
        const parsed = storedComputerSchema.safeParse(entry)
        if (parsed.success) return [parsed.data]
        logger.warn({ issues: parsed.error.issues.length }, 'remote computer left out of the list: unreadable entry')
        return []
    })
}

export async function getComputer(id: string): Promise<StoredComputer | null> {
    return (await readComputers()).find(computer => computer.id === id) ?? null
}

async function writeComputers(computers: StoredComputer[]): Promise<void> {
    await mkdir(remoteDir(), { recursive: true, mode: 0o700 })
    await writeFileAtomic(remoteComputersPath(), `${JSON.stringify({ computers }, null, 4)}\n`, { mode: 0o600 })
}

function updateComputers<T>(change: (computers: StoredComputer[]) => { computers: StoredComputer[]; result: T }): Promise<T> {
    return withKeyedLock(LOCK, async () => {
        const { computers, result } = change(await readComputers())
        await writeComputers(computers)
        return result
    })
}

function blank(identity: RemoteComputerIdentity): StoredComputer {
    return storedComputerSchema.parse(identity)
}

function replaceOrAppend(computers: StoredComputer[], next: StoredComputer): StoredComputer[] {
    const index = computers.findIndex(computer => computer.id === next.id)
    return index === -1 ? [...computers, next] : computers.map((computer, i) => (i === index ? next : computer))
}

// The hub's word on who a computer is: its name and handle follow the hub, its settings only what is sent.
export function upsertComputer(identity: RemoteComputerIdentity, settings?: RemoteComputerSettingsPatch): Promise<StoredComputer> {
    return updateComputers(computers => {
        const current = computers.find(computer => computer.id === identity.id) ?? blank(identity)
        const next: StoredComputer = { ...current, handle: identity.handle, name: identity.name, settings: settingsOrDefaults.parse({ ...current.settings, ...settings }) }
        return { computers: replaceOrAppend(computers, next), result: next }
    })
}

export type ConnectionFacts = { appVersion: string; protocol: number; capabilities: RemoteCapability[]; facts: RemoteFacts; at: string }

export function recordConnection(identity: RemoteComputerIdentity, info: ConnectionFacts): Promise<StoredComputer> {
    return updateComputers(computers => {
        const current = computers.find(computer => computer.id === identity.id) ?? blank(identity)
        const next: StoredComputer = { ...current, handle: identity.handle, name: identity.name, appVersion: info.appVersion, protocol: info.protocol, capabilities: info.capabilities, facts: info.facts, lastSeenAt: info.at }
        return { computers: replaceOrAppend(computers, next), result: next }
    })
}

export function recordSeen(id: string, at: string): Promise<void> {
    return updateComputers(computers => ({ computers: computers.map(computer => (computer.id === id ? { ...computer, lastSeenAt: at } : computer)), result: undefined }))
}

export function removeComputer(id: string): Promise<boolean> {
    return updateComputers(computers => ({ computers: computers.filter(computer => computer.id !== id), result: computers.some(computer => computer.id === id) }))
}

const withEntry = (list: string[], entry: string): string[] => (list.includes(entry) ? list : [...list, entry])

// An "always allow" answered on a card. Null for a computer the box does not know.
export function addComputerRule(id: string, rule: RemoteComputerRule): Promise<StoredComputer | null> {
    return updateComputers(computers => {
        const current = computers.find(computer => computer.id === id)
        if (!current) return { computers, result: null }
        const settings = { ...current.settings }
        if (rule.kind === 'program') settings.allowedPrograms = withEntry(settings.allowedPrograms, rule.program)
        if (rule.kind === 'folder') settings.allowedFolders = withEntry(settings.allowedFolders, rule.folder)
        if (rule.kind === 'screen') settings.screenAlways = true
        const next = { ...current, settings: settingsOrDefaults.parse(settings) }
        return { computers: replaceOrAppend(computers, next), result: next }
    })
}
