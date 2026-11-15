export type TeamCursor = {
    userId: string
    name: string
    avatarUrl: string | null
    color: string
    x: number
    y: number
}

export type TimedCursor = TeamCursor & { ts: number }

export type CursorPayload = { userId: string; x: number; y: number }

export type MemberLookup = (userId: string) => { name: string; photo?: string } | null | undefined

export const MAX_CURSORS = 50

export function colorFromId(id: string): string {
    let hash = 0
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
    return `hsl(${Math.abs(hash) % 360} 70% 55%)`
}

export function cursorFromPayload(payload: unknown, memberOf: MemberLookup): TeamCursor | null {
    if (!payload || typeof payload !== 'object') return null
    const { userId, x, y } = payload as Record<string, unknown>
    if (typeof userId !== 'string' || !userId) return null
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null
    const member = memberOf(userId)
    if (!member) return null
    return { userId, name: member.name, avatarUrl: member.photo ?? null, color: colorFromId(userId), x, y }
}

export function leavingUserId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const { userId } = payload as Record<string, unknown>
    return typeof userId === 'string' && userId ? userId : null
}

export function placeCursor(cursors: Map<string, TimedCursor>, cursor: TeamCursor, now: number): boolean {
    if (!cursors.has(cursor.userId) && cursors.size >= MAX_CURSORS) return false
    cursors.set(cursor.userId, { ...cursor, ts: now })
    return true
}
