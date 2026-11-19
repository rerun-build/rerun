// A development build started with EXPO_PUBLIC_PERF=1 prints how long the measured moments took, in
// Metro's log: `[perf] chat open: 412 ms · 200 messages, kept`.
export const PERF_LOG = __DEV__ && process.env.EXPO_PUBLIC_PERF === '1'

const started = new Map<string, number>()

export function startTiming(...keys: string[]) {
    if (!PERF_LOG) return
    const now = performance.now()
    for (const key of keys) started.set(key, now)
}

// Once per start: the moment is printed the first time it is reached.
export function endTiming(key: string, detail?: string) {
    const at = started.get(key)
    if (at === undefined) return
    started.delete(key)
    console.log(`[perf] ${key}: ${Math.round(performance.now() - at)} ms${detail ? ` · ${detail}` : ''}`)
}
