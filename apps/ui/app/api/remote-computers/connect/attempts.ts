import { createHash } from 'node:crypto'

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20

const attempts = new Map<string, number[]>()

// A computer reconnects with a growing delay, so a token past this many tries a minute is a loop or
// someone guessing. Per instance of the app: enough to keep one of them from hammering the database.
export function allowConnectAttempt(token: string, now: number = Date.now()): boolean {
    const key = createHash('sha256').update(token).digest('hex')
    const recent = (attempts.get(key) ?? []).filter(at => now - at < WINDOW_MS)
    if (recent.length >= MAX_PER_WINDOW) {
        attempts.set(key, recent)
        return false
    }
    recent.push(now)
    attempts.set(key, recent)
    if (attempts.size > 10_000) for (const [stale, times] of attempts) if (times.every(at => now - at >= WINDOW_MS)) attempts.delete(stale)
    return true
}
