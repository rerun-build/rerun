import 'server-only'

// A write that only says "still alive" (a key in use, a sandbox at work) goes out at most once per
// interval, remembered in this process only. Another process keeps its own memory, so the worst case
// is a few more writes, never fewer than one per interval.
const MAX_ENTRIES = 10_000

const lastStamps = new Map<string, number>()

export function shouldStamp(key: string, intervalMs: number, now = Date.now()): boolean {
    const last = lastStamps.get(key)
    if (last !== undefined && now - last < intervalMs) return false
    if (lastStamps.size >= MAX_ENTRIES) lastStamps.clear()
    lastStamps.set(key, now)
    return true
}

export function forgetStamps(): void {
    lastStamps.clear()
}
