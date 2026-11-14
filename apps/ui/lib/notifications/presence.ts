export const PRESENCE_HEARTBEAT_MS = 30_000
export const PRESENCE_TTL_MS = 90_000

export const PRESENCE_IDLE_MS = 5 * 60_000

export type PresenceRow = { user_id: string; last_seen_at: string }

export function isPresent(lastSeenAt: string | null | undefined, now: Date): boolean {
    if (!lastSeenAt) return false
    return now.getTime() - new Date(lastSeenAt).getTime() < PRESENCE_TTL_MS
}

export function splitByPresence<T extends { id: string }>(recipients: T[], rows: PresenceRow[], now: Date): { present: T[]; away: T[] } {
    const online = new Set(rows.filter(row => isPresent(row.last_seen_at, now)).map(row => row.user_id))
    return { present: recipients.filter(r => online.has(r.id)), away: recipients.filter(r => !online.has(r.id)) }
}

export function shouldBeat({ visible, lastInteractionAt, now }: { visible: boolean; lastInteractionAt: number; now: number }): boolean {
    return visible && now - lastInteractionAt < PRESENCE_IDLE_MS
}
