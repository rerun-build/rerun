import { agentConversationsOverviewSchema, agentViewSchema, aiConnectionsViewSchema, boardAgentSchema, boxSchema, coworkerFilesSchema, foremanSurfaceSchema, inboxSchema, installedServiceSchema, memberProfileSchema, meSchema, notificationPrefsSchema, routineViewSchema, workspaceSummarySchema, type AgentModels, type AgentView, type AiConnectionsView, type Box, type Conversation, type CoworkerFiles, type ForemanSurface, type Inbox, type InstalledServiceView, type Me, type MemberProfile, type NotificationPrefs, type RoutineView, type WorkspaceSummary } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { Directory, File, Paths } from 'expo-file-system'

import type { BoardRead } from '@/api/board'

// Bumped when what is stored changes shape: a file of another version is read as nothing. What comes
// from the hub is also checked against its contract, so a file left by an older app is read as nothing too.
const VERSION = 1
const MEMORY_LIMIT = 60
// Per family of keys: a burst of transcripts never pushes the home's board off the phone.
const FILE_LIMIT = 40
const MESSAGE_LIMIT = 200

export type CoworkerScreen = { view: AgentView | null; models: AgentModels | null; conversations: Conversation[] | null }

// The cache folder, not documents: iOS may empty it when short of space, and the hub still has it all.
const folder = () => new Directory(Paths.cache, 'chat-cache')
const fileOf = (key: string) => new File(folder(), `${key.replace(/[^\w-]/g, '_')}.json`)
const familyOf = (key: string) => key.slice(0, key.indexOf('-') + 1)

// A key read and found nowhere, so a screen asking at each render does not go to the disk each time.
const MISSING = Symbol('missing')
const memory = new Map<string, unknown>()
const inFlight = new Map<string, Promise<UIMessage[]>>()
// Moves on at each sign-out: a write or a read still on its way from before is dropped.
let generation = 0

// Least recently used goes first: a Map keeps the order its keys were set in.
function remember(key: string, value: unknown) {
    memory.delete(key)
    memory.set(key, value)
    if (memory.size <= MEMORY_LIMIT) return
    const oldest = memory.keys().next().value
    if (oldest !== undefined) memory.delete(oldest)
}

function read<T>(key: string, parse: (value: unknown) => T = value => value as T): T | null {
    if (memory.has(key)) {
        const value = memory.get(key)
        remember(key, value)
        return value === MISSING ? null : (value as T)
    }
    let value: T | null = null
    try {
        const file = fileOf(key)
        if (file.exists) {
            const stored = JSON.parse(file.textSync()) as { v?: number; value?: unknown }
            if (stored.v === VERSION && stored.value !== undefined) value = parse(stored.value)
        }
    } catch {
        value = null
    }
    remember(key, value ?? MISSING)
    return value
}

function prune(family: string) {
    const files = folder()
        .list()
        .filter((entry): entry is File => entry instanceof File && entry.name.startsWith(family))
    if (files.length <= FILE_LIMIT) return
    files
        .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
        .slice(FILE_LIMIT)
        .forEach(file => file.delete())
}

// On the device after the frame: a long transcript takes a moment to write.
function write(key: string, value: unknown) {
    remember(key, value)
    const writtenFor = generation
    setTimeout(() => {
        if (writtenFor !== generation) return
        try {
            folder().create({ intermediates: true, idempotent: true })
            fileOf(key).write(JSON.stringify({ v: VERSION, value }))
            prune(familyOf(key))
        } catch {}
    }, 0)
}

export type CacheEntry<T> = {
    read: () => T | null
    save: (value: T) => void
    // The hub's answer, kept unless the person signed out while it was on its way, or `keep` declines it.
    load: (fetch: () => Promise<T>, keep?: (value: T) => boolean) => Promise<T>
}

function entry<T>(key: string, parse: (value: unknown) => T): CacheEntry<T> {
    return {
        read: () => read(key, parse),
        save: value => write(key, value),
        load: (fetch, keep) => {
            const askedFor = generation
            return fetch().then(value => {
                // The home reads again at every move of a run: an answer that changed nothing is not written again.
                if (askedFor === generation && (keep?.(value) ?? true) && JSON.stringify(read(key, parse)) !== JSON.stringify(value)) write(key, value)
                return value
            })
        },
    }
}

const fieldsOf = (value: unknown) => value as Record<string, unknown>

export const cachedMe = (userId: string): CacheEntry<Me> => entry(`me-${userId}`, value => meSchema.parse(value))

export const cachedWorkspaces = (userId: string): CacheEntry<WorkspaceSummary[]> => entry(`workspaces-${userId}`, value => workspaceSummarySchema.array().parse(value))

export const cachedBoard = (workspaceId: number): CacheEntry<BoardRead> =>
    entry(`board-${workspaceId}`, value => {
        const { agents, overview, boxes } = fieldsOf(value)
        return { agents: boardAgentSchema.array().parse(agents), overview: agentConversationsOverviewSchema.parse(overview), boxes: boxSchema.array().parse(boxes) }
    })

// Only where the workspace stands once past its onboarding: the onboarding itself is never replayed from the phone.
export type SettledRoute = 'app' | 'waitlist'

export const cachedRoute = (workspaceId: number): CacheEntry<SettledRoute> =>
    entry(`route-${workspaceId}`, value => {
        if (value !== 'app' && value !== 'waitlist') throw new Error('not a settled route')
        return value
    })

export const cachedInbox = (workspaceId: number): CacheEntry<Inbox> => entry(`inbox-${workspaceId}`, value => inboxSchema.parse(value))

export type MembersRead = { members: MemberProfile[]; readAt: number }

export const cachedMembers = (workspaceId: number): CacheEntry<MembersRead> =>
    entry(`members-${workspaceId}`, value => {
        const { members, readAt } = fieldsOf(value)
        if (typeof readAt !== 'number') throw new Error('no read time')
        return { members: memberProfileSchema.array().parse(members), readAt }
    })

export const cachedNotificationPrefs = (userId: string): CacheEntry<NotificationPrefs> => entry(`notifs-${userId}`, value => notificationPrefsSchema.parse(value))

export const cachedAiConnections = (workspaceId: number): CacheEntry<AiConnectionsView> => entry(`ai-${workspaceId}`, value => aiConnectionsViewSchema.parse(value))

export type ForemanRead = { surface: ForemanSurface; last: { sessionId: string; title: string | null } | null }

export const cachedForeman = (workspaceId: number): CacheEntry<ForemanRead> =>
    entry(`foreman-${workspaceId}`, value => {
        const { surface, last } = fieldsOf(value)
        if (last === null) return { surface: foremanSurfaceSchema.parse(surface), last: null }
        const { sessionId, title } = fieldsOf(last)
        if (typeof sessionId !== 'string' || (title !== null && typeof title !== 'string')) throw new Error('not a conversation')
        return { surface: foremanSurfaceSchema.parse(surface), last: { sessionId, title } }
    })

export type CoworkerDetailsRead = Partial<{ view: AgentView; boxes: Box[]; files: CoworkerFiles; apps: InstalledServiceView[]; routines: RoutineView[] }>

function parseCoworkerDetails(value: unknown): CoworkerDetailsRead {
    const { view, boxes, files, apps, routines } = fieldsOf(value)
    return {
        view: view === undefined ? undefined : agentViewSchema.parse(view),
        boxes: boxes === undefined ? undefined : boxSchema.array().parse(boxes),
        files: files === undefined ? undefined : coworkerFilesSchema.parse(files),
        apps: apps === undefined ? undefined : installedServiceSchema.array().parse(apps),
        routines: routines === undefined ? undefined : routineViewSchema.array().parse(routines),
    }
}

const coworkerDetailsKey = (workspaceId: number, agentId: string) => `details-${workspaceId}-${agentId}`

export function readCoworkerDetails(workspaceId: number, agentId: string): CoworkerDetailsRead {
    return read(coworkerDetailsKey(workspaceId, agentId), parseCoworkerDetails) ?? {}
}

export function loadCoworkerDetail<K extends keyof CoworkerDetailsRead>(workspaceId: number, agentId: string, part: K, fetch: () => Promise<NonNullable<CoworkerDetailsRead[K]>>): Promise<NonNullable<CoworkerDetailsRead[K]>> {
    const askedFor = generation
    return fetch().then(value => {
        if (askedFor === generation) write(coworkerDetailsKey(workspaceId, agentId), { ...readCoworkerDetails(workspaceId, agentId), [part]: value })
        return value
    })
}

const transcriptKey = (workspaceId: number, sessionId: string) => `transcript-${workspaceId}-${sessionId}`
const coworkerKey = (workspaceId: number, agentId: string) => `coworker-${workspaceId}-${agentId}`

export function readTranscript(workspaceId: number, sessionId: string): UIMessage[] | null {
    return read<UIMessage[]>(transcriptKey(workspaceId, sessionId))
}

export function saveTranscript(workspaceId: number, sessionId: string, messages: UIMessage[]) {
    write(transcriptKey(workspaceId, sessionId), messages.slice(-MESSAGE_LIMIT))
}

// One read per conversation at a time: the row touched on the home starts it, the page opening
// behind takes the same answer instead of asking again.
export function loadTranscript(workspaceId: number, sessionId: string, fetchMessages: () => Promise<UIMessage[]>): Promise<UIMessage[]> {
    const key = transcriptKey(workspaceId, sessionId)
    const pending = inFlight.get(key)
    if (pending) return pending
    const askedFor = generation
    const loading = fetchMessages()
        .then(messages => {
            if (askedFor === generation) saveTranscript(workspaceId, sessionId, messages)
            return messages
        })
        .finally(() => inFlight.delete(key))
    inFlight.set(key, loading)
    return loading
}

export function readCoworkerScreen(workspaceId: number, agentId: string): CoworkerScreen {
    return read<CoworkerScreen>(coworkerKey(workspaceId, agentId)) ?? { view: null, models: null, conversations: null }
}

export function saveCoworkerScreen(workspaceId: number, agentId: string, part: Partial<CoworkerScreen>) {
    write(coworkerKey(workspaceId, agentId), { ...readCoworkerScreen(workspaceId, agentId), ...part })
}

export function sameTranscript(a: UIMessage[], b: UIMessage[]): boolean {
    return a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
}

// Nothing the hub said stays on the phone once the person signs out.
export function clearLocalCache() {
    generation += 1
    memory.clear()
    inFlight.clear()
    try {
        const cache = folder()
        if (cache.exists) cache.delete()
    } catch {}
}
