export const PUSH_WINDOW_MS = 60 * 60_000
export const PUSH_SOURCE_LIMIT = 3
export const PUSH_USER_LIMIT = 20

export function pushAllowed({ sourceCount, userCount }: { sourceCount: number; userCount: number }): boolean {
    return sourceCount < PUSH_SOURCE_LIMIT && userCount < PUSH_USER_LIMIT
}

export function pushWindowStart(now: Date): Date {
    return new Date(now.getTime() - PUSH_WINDOW_MS)
}
