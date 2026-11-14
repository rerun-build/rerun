import { z } from 'zod'

const pendingKickoffSchema = z.object({
    agentId: z.string().min(1),
    kickoff: z.string().optional(),
    description: z.string().optional(),
})

export type PendingKickoff = z.infer<typeof pendingKickoffSchema>

const parkedSchema = z.record(z.string().min(1), pendingKickoffSchema.omit({ agentId: true }))

type Parked = z.infer<typeof parkedSchema>

const STORAGE_KEY = 'rerun:pending-kickoffs'
const LEGACY_STORAGE_KEY = 'rerun:pending-kickoff'

function readLegacy(): PendingKickoff | null {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    try {
        const parsed = pendingKickoffSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

function readParked(): Parked {
    const raw = localStorage.getItem(STORAGE_KEY)
    let parked: Parked = {}
    if (raw) {
        try {
            const parsed = parkedSchema.safeParse(JSON.parse(raw))
            if (parsed.success) parked = parsed.data
            else localStorage.removeItem(STORAGE_KEY)
        } catch {
            localStorage.removeItem(STORAGE_KEY)
        }
    }
    const legacy = readLegacy()
    if (!legacy) return parked
    const { agentId, ...entry } = legacy
    const migrated = { [agentId]: entry, ...parked }
    writeParked(migrated)
    return migrated
}

function writeParked(parked: Parked): void {
    if (Object.keys(parked).length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(parked))
}

export function savePendingKickoff(entry: PendingKickoff): void {
    try {
        const { agentId, ...rest } = pendingKickoffSchema.parse(entry)
        writeParked({ ...readParked(), [agentId]: rest })
    } catch {
    }
}

export function readPendingKickoffs(): PendingKickoff[] {
    try {
        return Object.entries(readParked()).map(([agentId, entry]) => ({ agentId, ...entry }))
    } catch {
        return []
    }
}

export function readPendingKickoff(agentId: string): PendingKickoff | null {
    return readPendingKickoffs().find(entry => entry.agentId === agentId) ?? null
}

export function clearPendingKickoff(agentId: string): void {
    try {
        writeParked(Object.fromEntries(Object.entries(readParked()).filter(([id]) => id !== agentId)))
    } catch {
    }
}
